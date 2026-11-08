#!/usr/bin/env node
/**
 * checkadl — plays the edition's AdLib music, without a speaker.
 *
 * The music is a stream of commands with delays, driving a chip through its
 * registers. Two things can be checked without anything to compare against,
 * and this checks both:
 *
 *   - the **stream closes**: every command is one the driver knows, its
 *     operands are read to the byte, and the song ends at the end marker
 *     rather than by running off the end of the file. That is the same kind
 *     of proof as `checktot`'s "every block ends where it says" — the format
 *     is self-bounding, so a driver that mis-reads one command is caught by
 *     the next.
 *   - the chip **makes a sound**: the register writes are fed to svision's
 *     OPL2 and a few seconds are rendered. Silence would mean the writes are
 *     syntactically fine and musically meaningless, which parsing alone can
 *     never catch.
 *
 * What it does **not** prove is that it is the right tune. That needs a
 * recording of the original (`sources/media/README.md`).
 *
 * usage: node tools/checkadl.mjs [--edition floppy|cd] [--seconds N] [--quiet]
 * exit code 0 = no differences, 1 = differences
 */
import '../app/svision/tools/nodeEnv.mjs';   // must come first: the import headers read window.srcVersion
import path from 'node:path';
import { openEdition } from './totlib.mjs';

const { ADLPlayer } = await import('../app/coktel/js/adl.js');
const { OPL2 } = await import('../app/svision/js/audio/chip/opl2.js');

// begin code

const args = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : fallback;
};
const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(here, '..');
const edition = opt('edition', 'floppy');
const seconds = Number(opt('seconds', '4'));
const quiet = args.includes('--quiet');

const archives = openEdition(root, edition);

/** The highest register an OPL2 has; anything above it is a fault. */
const MAX_REGISTER = 0xF5;

let differences = 0;
let songs = 0;
let totalWrites = 0;

for (const name of archives.names.filter((n) => n.toUpperCase().endsWith('.ADL')).sort()) {
  const data = archives.member(name);
  if (!data) continue;
  songs++;

  const faults = [];
  let writes = 0;
  const chip = new OPL2();

  const player = new ADLPlayer({
    write(register, value) {
      writes++;
      if (register < 0 || register > MAX_REGISTER) faults.push(`register 0x${register.toString(16)}`);
      if (value < 0 || value > 255) faults.push(`value ${value} into 0x${register.toString(16)}`);
      chip.write(register, value);
    },
  });

  if (!player.load(new Uint8Array(data))) {
    console.log(`${name.padEnd(12)} is not an ADL`);
    differences++;
    continue;
  }

  const timbres = player.timbres.length;
  const songSize = player.songData.length;

  // Play it through, and stop it if it will not end — a song that never
  // reaches its end marker has lost the thread and is a fault, not a loop.
  player.start(0);
  const bound = 300000;
  let ms = 0;
  while (player.playing && ms < bound) { player.tick(); ms++; }
  if (ms >= bound) faults.push(`did not end within ${bound / 1000} s`);

  // The stream has to have been read to its end, give or take the delay the
  // end marker carries.
  if (player.playPos > songSize) {
    faults.push(`read ${player.playPos} of ${songSize} bytes`);
  }

  // And now: does it actually make a noise? Render from the start.
  player.start(0);
  const rate = Math.round(OPL2.SAMPLE_RATE);
  const block = new Float32Array(Math.round(rate / 1000));
  let peak = 0;
  let nonZero = 0;
  for (let i = 0; i < seconds * 1000 && player.playing; i++) {
    player.tick();
    chip.render(block, block.length);
    for (const sample of block) {
      const level = Math.abs(sample);
      if (level > peak) peak = level;
      if (level > 0.0001) nonZero++;
    }
  }
  if (peak === 0) faults.push('rendered silence');

  totalWrites += writes;
  if (!quiet) {
    console.log(`${name.padEnd(12)} ${String(data.length).padStart(6)} B` +
      ` ${String(timbres).padStart(3)} timbres` +
      ` ${String(writes).padStart(6)} writes` +
      ` ${(ms / 1000).toFixed(1).padStart(6)} s` +
      `  peak ${peak.toFixed(3)}` +
      (faults.length ? `  ${faults.join('; ')}` : ''));
  }
  differences += faults.length;
}

console.log(`\n${songs} pieces of AdLib music (${edition}), ${totalWrites} register writes,` +
  ` ${seconds} s of each rendered through the OPL2`);
if (differences) {
  console.log(`${differences} differ`);
  process.exit(1);
}
console.log('0 differences');
console.log('(this is not an acceptance — that needs a recording of the original)');
