#!/usr/bin/env node
/**
 * playtot — plays the game without a browser, with the player written down.
 *
 * `runtot` proves the interpreter walks the right bytes; `rendertot` proves
 * what one script draws. Neither can go past the first thing the original
 * waits for, because neither has a player. This one does: it drives the
 * interpreter **one frame at a time**, the way the game model in the browser
 * does, and feeds it a scripted mouse and keyboard.
 *
 * That is the test flight the methodology asks for (`../METHODOLOGY.md`),
 * and it is what makes the interactive half of the engine measurable:
 *
 *   - the hotspot blocks are entered and waited in, so their enter and leave
 *     scripts run — which is most of the game's bytecode and none of what
 *     `runtot` could reach
 *   - `loadTot` chains are followed, so the run is a **session** rather than
 *     one screen
 *   - everything is deterministic: a seeded `rand()`, a counted clock and a
 *     written-down player, so two flights give the same numbers and the
 *     fingerprint is a regression test with nothing else needed
 *
 * ## The flight plan
 *
 * A plan is a list of instructions read one per frame:
 *
 *     wait N          let N frames pass
 *     move X Y        put the pointer there (on the **screen**, so a scrolled
 *                     room moves under it, exactly as a real mouse does)
 *     click X Y [B]   move there and press button B (1 left, 2 right), then
 *                     let go on the next frame
 *     key NAME        press a key: escape, return, space, or one character
 *
 * With no `--plan`, a default is used that presses a key now and then —
 * enough to get through the title screens, which is what the intro waits for.
 *
 * usage: node tools/playtot.mjs [--edition floppy|cd] [--start NAME]
 *                               [--frames N] [--plan FILE] [--seed N]
 *                               [--language AMERICAN|BRITISH|FRENCH|…]
 *                               [--skip FROM=TO,...] [--shot DIR] [--verbose]
 * exit code 0 = the flight finished, 1 = it ended in an error
 */
import '../app/svision/tools/nodeEnv.mjs';   // must come first: the import headers read window.srcVersion
import fs from 'node:fs';
import path from 'node:path';
import { openEdition, openScript } from './totlib.mjs';
import { archiveHost } from './hostlib.mjs';
import { encodeIndexedPNG } from '../app/svision/tools/retro/png.mjs';

const { VGAPalette } = await import('../app/svision/js/platform/canvas2D/vga/vgaPalette.js');
const { Interpreter, LANGUAGE } = await import('../app/coktel/js/interpreter.js');
const { Surface } = await import('../app/coktel/js/surface.js');
const { seededRandom } = await import('../app/coktel/js/walker.js');

// begin code

const args = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : fallback;
};
const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(here, '..');
const edition = opt('edition', 'floppy');
const startTot = opt('start', 'INTRO');
const maxFrames = Number(opt('frames', '4000'));
const seed = Number(opt('seed', '0xC0C7E1'));
const shotDir = opt('shot', null);
/**
 * Which language the scripts are told they are in.
 *
 * It decides the text **and**, in Goblins 3, whether the copy protection
 * runs at all — see `LANGUAGE` in the interpreter. Named here so a flight
 * through the protection can still be flown.
 */
const language = LANGUAGE[String(opt('language', 'AMERICAN')).toUpperCase()];
if (language === undefined) {
  console.error(`unknown language; expected one of ${Object.keys(LANGUAGE).join(', ')}`);
  process.exit(2);
}
/** How many commands one frame may run before the flight calls it a hang. */
const STEPS_PER_FRAME = Number(opt('steps', '400000'));

/**
 * Scripts not to run, and what to run instead — `--skip DEMO=MENU`.
 *
 * The game in the browser does this: it shows the title screen at the boot
 * and then does not run `DEMO.TOT`, which is the same picture again. A flight
 * that wants to follow what a player actually sees has to be able to do the
 * same, or its numbers are about a game nobody plays.
 */
const skip = new Map((opt('skip', '') ? opt('skip').split(',') : [])
  .map((pair) => pair.split('=').map((half) => half.trim().toUpperCase()))
  .map(([from, to]) => [`${from.replace(/\.TOT$/, '')}.TOT`, `${to.replace(/\.TOT$/, '')}.TOT`]));
const verbose = args.includes('--verbose');

/** The DOS codes for the keys a plan may name. */
const KEYS = {
  escape: 0x011B, return: 0x1C0D, space: 0x3920, backspace: 0x0E08,
  up: 0x4800, down: 0x5000, left: 0x4B00, right: 0x4D00,
};

/**
 * The plan, with a default that only presses keys.
 *
 * The default cannot click anything useful, because where a thing is depends
 * on the screen; what it can do is get past every "press a key" the intro
 * puts up, which is already further than any tool here has been.
 */
const plan = opt('plan', null)
  ? readPlan(fs.readFileSync(path.resolve(root, opt('plan')), 'utf8'))
  : defaultPlan();

const archives = openEdition(root, edition);

/** How many yields the flight has driven — what `--frames` bounds. */
let frame = 0;

/**
 * The virtual clock, in milliseconds.
 *
 * Not `frame * something`: what the interpreter stopped for decides how much
 * time passed. A **frame boundary** is a whole frame at the rate the script
 * asked for; a turn of a **wait for the player** is ten milliseconds, because
 * waiting is not running. Getting this wrong is not a rounding error — it is
 * the difference between a sound finishing and being cut off by the next one.
 *
 * The game in the browser keeps the same two numbers, so a flight and a
 * player see the same game (`app/gameModel.js`).
 */
let clock = 0;
/** Frames a second until a script says otherwise. */
let frameRate = 12;
/** How long one turn of a wait for the player is. */
const WAIT_MS = 10;

const pointer = { x: 160, y: 100, buttons: 0 };
/**
 * Where the flight put the pointer on the screen.
 *
 * The engine asks for the pointer in the scene's coordinates and a scrolling
 * room slides under it, so the two are not the same number — and the game
 * model keeps the same pair for the same reason (`GameModel#pointerLocal`).
 */
const pointerLocal = { x: 160, y: 100 };
const keyQueue = [];

let fingerprint = 0x811C9DC5;
let totalSteps = 0;
let totalEffects = 0;
const wanted = new Map();
const visited = new Set();
/** Which scripts the flight got into at all, sub-scripts included. */
const entered = new Set();
/** Scripts a `totSub` asked for and the edition does not have. */
const missing = new Set();
/** Every host the flight built, so their sounds can be counted together. */
const hostsWithSound = [];
const chain = [];
let failure = null;

let name = `${startTot.replace(/\.TOT$/i, '').toUpperCase()}.TOT`;
let run = null;
let vm = null;
let planAt = 0;
let releaseAt = -1;

startScript(name);

while (frame < maxFrames && run && !failure) {
  // The player, one instruction a frame.
  if (releaseAt === frame) pointer.buttons = 0;
  if (planAt < plan.length) {
    const step = plan[planAt];
    if (step.wait > 0) step.wait--;
    else {
      planAt++;
      if (step.move) { pointerLocal.x = step.move[0]; pointerLocal.y = step.move[1]; }
      if (step.click) {
        pointerLocal.x = step.click[0];
        pointerLocal.y = step.click[1];
        pointer.buttons = step.click[2];
        releaseAt = frame + 2;
      }
      if (step.key) keyQueue.push(step.key);
    }
  }

  // The budget is per frame and is set before the step: a script that loops
  // without ever reaching a frame boundary never comes back, so there is no
  // "after the step" in which to notice.
  vm.maxSteps = vm.steps + STEPS_PER_FRAME;

  let stepResult;
  try {
    stepResult = run.next();
  } catch (error) {
    failure = `${vm.script ? name : '?'}: ${error.message}`;
    break;
  }
  frame++;
  if (!stepResult.done) {
    clock += stepResult.value && stepResult.value.reason === 'frame'
      ? 1000 / frameRate : WAIT_MS;
  }

  if (!stepResult.done) continue;

  const result = stepResult.value;
  chain.push({ name, reason: result.reason, steps: result.steps, frame });
  if (result.reason === 'error') { failure = `${name}: ${result.error}`; break; }

  const next = vm.totToLoad ? vm.totToLoad.toUpperCase() : null;
  if (!next) { run = null; break; }
  if (chain.length > 64) { failure = 'the loadTot chain passed 64 scripts'; break; }
  name = next;
  startScript(name);
}

report();

/**
 * Opens one script and builds the host that answers for **its** resources.
 *
 * A sub-script's sprites and texts are not the caller's, so every environment
 * needs its own host — and since a sub-script may open a sub-script of its
 * own, the host it is given knows how to do this again.
 *
 * @param {string} totName with or without the `.TOT`
 * @returns {?{data: Uint8Array, host: object, name: string}}
 */
function openEnvironment(totName) {
  const asked = `${totName.replace(/\.TOT$/i, '').toUpperCase()}.TOT`;
  const base = (skip.get(asked) ?? asked).replace(/\.TOT$/, '');
  let script;
  try {
    script = openScript(archives, base);
  } catch {
    return null;
  }

  const host = archiveHost({ archives, script, waitLimit: Number.MAX_SAFE_INTEGER });

  // Everything the flight has to answer for a player to exist.
  host.mouse = () => {
    const draw = vm?.draw;
    pointer.x = pointerLocal.x + (draw ? draw.scrollOffsetX : 0);
    pointer.y = pointerLocal.y + (draw ? draw.scrollOffsetY : 0);
    return pointer;
  };
  host.setMousePos = (x, y) => {
    const draw = vm?.draw;
    pointer.x = x;
    pointer.y = y;
    pointerLocal.x = x - (draw ? draw.scrollOffsetX : 0);
    pointerLocal.y = y - (draw ? draw.scrollOffsetY : 0);
  };
  // The scripts of this edition ask for 10, 12 or 15 — and they mean it.
  host.setFrameRate = (rate) => { if (rate > 0 && rate <= 100) frameRate = rate; };
  host.key = () => (keyQueue.length ? keyQueue.shift() : 0);
  host.now = () => Math.round(clock);
  host.texts = () => script.set.texts;
  host.loadSound = (unused, request) => request.slot;
  host.multSound = () => {};
  host.playImd = () => {};

  // The engine nests scripts itself; the host only has to find them.
  host.totSub = null;
  host.switchTotSub = null;
  host.openTot = (unused, name) => openEnvironment(name);
  host.missingTot = (unused, name) => missing.add(name.toUpperCase());

  const outerCommand = host.command;
  host.command = (v, command) => {
    outerCommand(v, command);
    totalSteps++;
    visited.add(`${base}:${command.offset}`);
    entered.add(base);
    fingerprint = hash(fingerprint, `${base}:${command.offset}:${command.name}`);
  };
  hostsWithSound.push(host);

  const outerEffect = host.effect;
  host.effect = (v, effect) => {
    outerEffect(v, effect);
    totalEffects++;
    if (effect.name) wanted.set(effect.name, (wanted.get(effect.name) ?? 0) + 1);
  };

  return { data: script.data, host, name: base };
}

/**
 * Loads a script and starts a run of it, suspended at its first yield.
 *
 * After the first one this **reuses the interpreter** (`loadTot`) rather than
 * making a new one. A `loadTot` in the original changes the script and leaves
 * the palette, the surfaces, the fonts and the variables alone; a fresh
 * interpreter throws all of that away, and the next screen comes up black.
 *
 * @param {string} totName
 */
function startScript(totName) {
  const opened = openEnvironment(totName);
  if (!opened) { failure = `the edition has no ${totName}`; return; }

  if (vm) {
    vm.setHost(opened.host);
    vm.loadTot(opened.data);
  } else {
    vm = new Interpreter({
      data: opened.data,
      host: opened.host,
      version: 'v3',
      random: seededRandom(seed),
      language,
      maxSteps: STEPS_PER_FRAME,
    });
  }
  // `--skip` may have chosen another script; the report has to say which one
  // is really running, or it names a script nobody is in.
  name = `${opened.name}.TOT`;
  run = vm.runGen();
  if (verbose) console.log(`  frame ${frame}: ${name}`);
}

/** The default plan: a key every twenty frames, forty times. */
function defaultPlan() {
  const steps = [];
  for (let i = 0; i < 40; i++) {
    steps.push({ wait: 20 });
    steps.push({ key: KEYS.return });
  }
  return steps;
}

/**
 * Reads a plan file.
 *
 * One instruction a line; `#` starts a comment.
 *
 * @param {string} text
 * @returns {object[]}
 */
function readPlan(text) {
  const steps = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    switch (parts[0]) {
      case 'wait': steps.push({ wait: Number(parts[1]) }); break;
      case 'move': steps.push({ move: [Number(parts[1]), Number(parts[2])] }); break;
      case 'click':
        steps.push({ click: [Number(parts[1]), Number(parts[2]), Number(parts[3] ?? 1)] });
        break;
      case 'key': {
        const key = parts[1].toLowerCase();
        steps.push({ key: KEYS[key] ?? (parts[1].length === 1 ? parts[1].charCodeAt(0) : 0) });
        break;
      }
      default: throw new Error(`unknown plan instruction "${parts[0]}"`);
    }
  }
  return steps;
}

/** Writes the last screen out, when one was asked for. */
function shoot() {
  if (!shotDir || !vm) return null;
  const draw = vm.draw;
  draw.forceBlit();
  const screen = new Surface(draw.screenWidth, draw.screenHeight);
  draw.composeScreen(screen);

  // The DAC's six-bit components as the 0..255 a PNG's palette wants — the
  // same scaling the screen uses, so a shot and a screenshot compare exactly.
  const rgb = Buffer.alloc(768);
  for (let i = 0; i < 768; i++) rgb[i] = VGAPalette.to8bit(draw.palette[i]);

  const dir = path.resolve(root, shotDir);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'flight.png');
  fs.writeFileSync(file, encodeIndexedPNG(screen.width, screen.height,
    Buffer.from(screen.pixels), rgb));
  return path.relative(root, file);
}

/**
 * What the screen holds at the end, in one line.
 *
 * A black picture has two quite different causes and the shot cannot tell
 * them apart: nothing was drawn, or plenty was drawn and the palette is all
 * zeroes. So both are reported.
 *
 * @param {object} vm
 * @returns {string}
 */
function describeScreen(vm) {
  const draw = vm.draw;
  draw.forceBlit();
  const screen = new Surface(draw.screenWidth, draw.screenHeight);
  draw.composeScreen(screen);

  let painted = 0;
  for (const pixel of screen.pixels) if (pixel !== 0) painted++;
  let live = 0;
  for (let i = 0; i < 256; i++) {
    if (draw.palette[i * 3] || draw.palette[i * 3 + 1] || draw.palette[i * 3 + 2]) live++;
  }

  return `screen ${draw.width}x${draw.height} at +${draw.scrollOffsetX},${draw.scrollOffsetY}` +
    (draw.splitHeight ? ` (split ${draw.splitHeight})` : '') +
    `, ${(100 * painted / screen.pixels.length).toFixed(1)}% of the window painted` +
    `, ${live} palette registers not black`;
}

/** FNV-1a over the run, so a flight is one number (`../METHODOLOGY.md`). */
function hash(state, text) {
  let out = state;
  for (let i = 0; i < text.length; i++) {
    out ^= text.charCodeAt(i);
    out = Math.imul(out, 0x01000193) >>> 0;
  }
  return out >>> 0;
}

function hex(value) {
  return (value >>> 0).toString(16).padStart(8, '0');
}

function report() {
  console.log(`${chain.length + (run ? 1 : 0)} scripts, ${frame} frames ` +
    `(${(clock / 1000).toFixed(1)} s of game time, ${edition}), ` +
    `${totalSteps} commands executed, ${totalEffects} handed to the host`);
  for (const entry of chain) {
    console.log(`  ${entry.name.padEnd(12)} ${String(entry.steps).padStart(8)} steps` +
      `  ended at frame ${entry.frame}: ${entry.reason}`);
  }
  if (run) console.log(`  ${name.padEnd(12)} still running when the flight ran out of frames`);
  console.log(`${visited.size} distinct commands reached in ${entered.size} scripts` +
  ` (${[...entered].sort().join(', ')})`);
if (missing.size) console.log(`asked for and not found: ${[...missing].sort().join(', ')}`);
  if (wanted.size) {
  const played = hostsWithSound.flatMap((host) => host.sounds);
  if (played.length) {
    const byKind = new Map();
    for (const sound of played) byKind.set(sound.kind, (byKind.get(sound.kind) ?? 0) + 1);
    console.log(`sound: ${[...byKind].map(([k, n]) => `${n} ${k}`).join(', ')}` +
      ' (nothing comes out — a flight has no audio device)');
  }

    const top = [...wanted].sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([n, c]) => `${n} ${c}x`).join(', ');
    console.log(`still handed to the host: ${top}`);
  }
  if (vm) console.log(describeScreen(vm));
  const shot = shoot();
  if (shot) console.log(`last screen -> ${shot}`);

  if (failure) {
    console.log(`the flight ended in an error: ${failure}`);
    process.exit(1);
  }
  console.log(`fingerprint ${hex(fingerprint)} (seed ${hex(seed)}, ${maxFrames} frame bound)`);
}
