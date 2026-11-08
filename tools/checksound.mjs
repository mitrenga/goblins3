#!/usr/bin/env node
/**
 * checksound — does the game actually play what the engine asks for?
 *
 * Every other `check*` here stops at the engine. This one goes one step
 * further, into `app/`: it runs the **real** `AudioManager` the browser runs,
 * over a Web Audio API small enough to fit in this file, and reports what
 * would have come out of the speakers.
 *
 * It exists because of a bug it would have caught in a second. The sounds of
 * a screen mostly do not come from a script command: they come from the
 * **animation timeline** and from a goblin's state table. Both of those were
 * wired to a host callback that did nothing, so 144 sample slots loaded
 * perfectly and none of them ever played — and every number the tools printed
 * looked right, because they all counted *loading*. "Loaded" and "played" are
 * two different numbers and this tool prints the second one.
 *
 * Two halves, and each catches what the other cannot:
 *
 *   - **the engine**: run every script and collect what it asks to be played.
 *   - **the app**: hand those requests to the real `AudioManager` and check
 *     that a buffer of the right length, at the right rate, actually starts.
 *
 * It also holds the game to the one rule that keeps these recordings sounding
 * like themselves: **nothing may be resampled by the browser**. Every buffer
 * has to arrive at the context's own rate with a playback rate of 1, because
 * these samples are 5 to 11 kHz and whatever a browser does to get them up to
 * 48 is both out of our hands and different in every browser.
 *
 * usage: node tools/checksound.mjs [--edition floppy|cd] [--quiet]
 * exit code 0 = no differences, 1 = differences
 */
import '../app/svision/tools/nodeEnv.mjs';   // must come first: the import headers read window.srcVersion
import path from 'node:path';
import { openEdition, openScript, scriptNames } from './totlib.mjs';
import { archiveHost } from './hostlib.mjs';

// begin code

const args = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : fallback;
};
const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(here, '..');
const edition = opt('edition', 'floppy');
const quiet = args.includes('--quiet');

// ------------------------------------------------------------------------
// Just enough Web Audio for the handler to run, and to say what it did.
//
// Not a stand-in for a browser: a recorder. Every source that starts is
// written down with the buffer it was given and the rate it was given, which
// is exactly what a player would hear the difference between.
// ------------------------------------------------------------------------

const started = [];

class FakeParam {
  constructor(value) { this.value = value; }
}

class FakeBuffer {
  constructor(length, sampleRate) {
    this.length = length;
    this.sampleRate = sampleRate;
    this.channel = new Float32Array(length);
  }
  copyToChannel(source) { this.channel.set(source.subarray(0, this.channel.length)); }
  getChannelData() { return this.channel; }
}

class FakeNode {
  constructor() {
    this.gain = new FakeParam(1);
    this.playbackRate = new FakeParam(1);
    this.buffer = null;
    this.loop = false;
  }
  connect() {}
  disconnect() {}
  stop() {}
  start() {
    started.push({
      rate: this.playbackRate.value,
      loop: this.loop === true,
      length: this.buffer ? this.buffer.length : 0,
      sampleRate: this.buffer ? this.buffer.sampleRate : 0,
      peak: this.buffer ? peakOf(this.buffer.channel) : 0,
    });
  }
}

class FakeContext {
  constructor(options) {
    this.sampleRate = (options && options.sampleRate) || 44100;
    this.state = 'running';
    this.currentTime = 0;
    this.destination = { maxChannelCount: 2 };
  }
  createGain() { return new FakeNode(); }
  createBufferSource() { return new FakeNode(); }
  createBuffer(channels, length, sampleRate) { return new FakeBuffer(length, sampleRate); }
  resume() { return Promise.resolve(); }
  close() {}
}

window.AudioContext = FakeContext;
// The library reads a cookie for the volume; there is no document here.
globalThis.document = { cookie: '' };

const { AudioManager } = await import('../app/audioManager.js');

/** The loudest sample in a buffer — a silent one would be a fault. */
function peakOf(samples) {
  let peak = 0;
  for (const sample of samples) {
    const level = Math.abs(sample);
    if (level > peak) peak = level;
  }
  return peak;
}

// ------------------------------------------------------------------------
// The engine: what every script asks to be played.
// ------------------------------------------------------------------------

const archives = openEdition(root, edition);
const { Interpreter } = await import('../app/coktel/js/interpreter.js');
const { seededRandom } = await import('../app/coktel/js/walker.js');

const asked = [];
for (const name of scriptNames(archives)) {
  const script = openScript(archives, name);
  const host = archiveHost({ archives, script, waitLimit: 2000 });
  host.texts = () => script.set.texts;
  const vm = new Interpreter({
    data: script.data, host, version: 'v3', random: seededRandom(0xC0C7E1),
  });
  try {
    vm.run();
  } catch {
    // Where a script stops is `runtot`'s business, not this tool's.
  }
  for (const sound of host.sounds) asked.push({ script: name, ...sound });
}

// ------------------------------------------------------------------------
// The app: hand them over and see what starts.
// ------------------------------------------------------------------------

// The model the manager sends its orders through: the library answers audio
// events itself, so the smallest honest stand-in is one that forwards them.
const model = {
  sendEvent(priority, event) {
    if (event.id === 'openAudioBus') app.audioManager.openBus(event.bus, event.options);
    else if (event.id === 'playSound') app.audioManager.playSound(event.bus, event.sound, event.options);
  },
};
const app = { model };
const manager = new AudioManager(app);
app.audioManager = manager;
manager.openBuses(model);

const faults = [];
if (!('sfx' in manager.buses)) faults.push('the sfx bus did not open');
if (!('speaker' in manager.buses)) faults.push('the speaker bus did not open');

const counts = new Map();
let pitched = 0;
for (const request of asked) {
  counts.set(request.kind, (counts.get(request.kind) ?? 0) + 1);
  switch (request.kind) {
    case 'sample':
      if (request.rate !== request.own) pitched++;
      manager.playSample({
        slot: request.slot, samples: sampleBytesFor(request), own: request.own,
        rate: request.rate, repeat: request.repeat,
      });
      break;
    case 'stop': manager.stopSample(); break;
    case 'music': manager.playMusic({ data: new Uint8Array(4), repeat: request.repeat }); break;
    case 'stopMusic': manager.stopMusic(); break;
    case 'speaker': manager.speakerOn({ frequency: request.frequency, length: 5 }); break;
    default: break;
  }
}

/**
 * The bytes for one request.
 *
 * `hostlib` keeps the **length** of each sample rather than the bytes, so
 * that a run of every script does not hold the edition's audio in memory.
 * What this tool checks is that a buffer of that length at that rate reaches
 * the bus, so a buffer of that length is what it hands over — with something
 * in it, because a silent one would hide the very fault being looked for.
 */
function sampleBytesFor(request) {
  const bytes = new Uint8Array(Math.max(request.length, 1));
  for (let i = 0; i < bytes.length; i++) bytes[i] = 128 + Math.round(60 * Math.sin(i / 8));
  return bytes;
}

// ------------------------------------------------------------------------
// What came out.
// ------------------------------------------------------------------------

const samplesAsked = counts.get('sample') ?? 0;
const speakersAsked = counts.get('speaker') ?? 0;
const playedSamples = started.filter((s) => s.sampleRate !== 11025 || s.length > 200);
const playedBeeps = started.length - playedSamples.length;

if (samplesAsked === 0) faults.push('the engine asked for no samples at all');
if (playedSamples.length < samplesAsked) {
  faults.push(`${samplesAsked} samples asked for, ${playedSamples.length} reached the bus`);
}
if (speakersAsked > 0 && playedBeeps === 0) faults.push('no beep reached the speaker bus');

const busRate = manager.busRate();
let resampled = 0;
for (const start of started) {
  if (start.length === 0) faults.push('a source started with no buffer');
  if (start.peak === 0) faults.push('a source started with a silent buffer');
  // The rule: the browser must have nothing left to do.
  if (start.sampleRate !== busRate || Math.abs(start.rate - 1) > 1e-9) resampled++;
}

// And the other rule the ear catches before any tool does: a sound plays as
// many times as the engine asked, and 0 and 1 both mean once.
const looped = started.filter((s) => s.loop).length;
const asksToLoop = asked.filter((s) => s.kind === 'sample' && s.repeat === -1).length;
if (looped !== asksToLoop) {
  faults.push(`${asksToLoop} sounds ask to loop, ${looped} were set to loop`);
}
if (resampled > 0) {
  faults.push(`${resampled} of ${started.length} playings would be resampled by the browser` +
    ` (a buffer not at ${busRate} Hz, or a playback rate other than 1)`);
}

if (!quiet) {
  console.log(`the engine asked for:`);
  for (const [kind, count] of [...counts].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(5)}x ${kind}`);
  }
  console.log(`of the samples, ${pitched} are asked for at a pitch other than` +
    ` the recording's — the pitch is folded into the DAC's hold, so those are` +
    ` streams of their own`);
  console.log(`\nwhat reached the audio bus:`);
  console.log(`  ${playedSamples.length} samples, ${playedBeeps} beeps`);
  const distinctBuffers = new Set(started.map((s) => `${s.length}@${s.sampleRate}`)).size;
  console.log(`  ${distinctBuffers} distinct buffers for ${started.length} playings`);
  console.log(`  all of them at ${manager.busRate()} Hz, played at rate 1 —` +
    ` nothing for the browser to resample`);
}

console.log(`\n${asked.length} sounds over ${scriptNames(archives).length} scripts (${edition}),` +
  ` through the game's own AudioManager`);
if (faults.length) {
  for (const fault of faults) console.log(`  ${fault}`);
  console.log(`${faults.length} differ`);
  process.exit(1);
}
console.log('0 differences');
console.log('(this is not an acceptance — it proves the sounds reach the bus, not that they are the right ones)');
