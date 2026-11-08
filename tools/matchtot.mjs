#!/usr/bin/env node
/**
 * matchtot — the acceptance check for G3 (`../MILNIKY.md`).
 *
 * Compares what our interpreter makes of a script against a **recorded run of
 * the original's scripts through the reference engine**: ScummVM's own opcode
 * log. With `--debugflags=funcop` at level 1 it prints one line per command it
 * executes, and each line carries the script, the offset and the opcode:
 *
 *     intro.tot:00000919: opcodeFunc 0.3 [0x0.0x3] (o1_loadCursor)
 *
 * The offset is the position **after** the command byte, because the engine
 * logs it having already read it; this lines the two up. For every logged
 * line, the command our walk decoded at that offset has to be the same
 * opcode. The milestone is accepted when the count of differing lines is zero
 * over a stated number of checks.
 *
 * ## Why this is worth having on top of `checktot`
 *
 * `checktot` proves the decoding is self-consistent — every block closes. It
 * cannot prove the decoding is *the same one the engine does*: a systematic
 * misreading that happened to stay in step would pass. This compares against
 * an engine that plays the game, at the offsets that engine actually reached,
 * so agreement is evidence about the reading itself.
 *
 * It does not yet check the values. A trace of the variables belongs with a
 * running interpreter and comes with G4; the log format above is the part of
 * the golden record that exists at G3.
 *
 * ## Without a golden record nothing is proved
 *
 * An empty trace directory is an **error** (exit code 2), never a pass. See
 * `sources/media/README.md` for how the log is made.
 *
 * usage: node tools/matchtot.mjs [--edition floppy|cd] [--golden DIR|FILE]
 *                                [--quiet]
 * exit code 0 = no differences, 1 = differences, 2 = nothing to compare
 */
import '../app/svision/tools/nodeEnv.mjs';   // must come first: the import headers read window.srcVersion
import fs from 'node:fs';
import path from 'node:path';
import { openEdition, openScript, scriptNames } from './totlib.mjs';

const { ScriptWalker } = await import('../app/coktel/js/walker.js');

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
const goldenPath = path.resolve(root, opt('golden', `sources/media/traces/${edition}`));

/** The log files of a directory, or the single file itself. */
function logs(at) {
  if (!fs.existsSync(at)) return [];
  if (fs.statSync(at).isFile()) return [at];
  return fs.readdirSync(at)
    .filter((f) => /\.(log|txt)$/i.test(f))
    .sort()
    .map((f) => path.join(at, f));
}

const golden = logs(goldenPath);
if (!golden.length) {
  console.error(`no golden record in ${path.relative(root, goldenPath)} — nothing to compare against.`);
  console.error('G3 is not accepted until a ScummVM opcode log is recorded there;');
  console.error('see sources/media/README.md. Meanwhile tools/checktot.mjs proves what it can.');
  process.exit(2);
}

/**
 * One logged command.
 *
 * `offset` is turned back into the command's own offset: the engine logs the
 * position after reading the command byte, so it is one past where we say the
 * command starts.
 */
const LINE = /^(\S+\.tot):(\d+):\s*opcodeFunc\s+(\d+)\.(\d+)\s*\[[^\]]*\]\s*(?:\(([^)]*)\))?/i;

function readGolden(file) {
  const entries = [];
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = LINE.exec(line.trim());
    if (!m) continue;
    entries.push({
      script: path.parse(m[1]).name.toUpperCase(),
      offset: Number(m[2]) - 1,
      family: Number(m[3]),
      opcode: Number(m[4]),
      // ScummVM leaves the name out when it is built to save memory.
      name: (m[5] ?? '').trim(),
      source: `${path.basename(file)}:${line.trim().slice(0, 60)}`,
    });
  }
  return entries;
}

const entries = golden.flatMap(readGolden);
if (!entries.length) {
  console.error(`${golden.length} file(s) in ${path.relative(root, goldenPath)} but no "opcodeFunc" lines in them.`);
  console.error('The log has to be made with --debugflags=funcop at debug level 1.');
  process.exit(2);
}

// --------------------------------------------------------- our own decode

const archives = openEdition(root, edition);
const available = new Set(scriptNames(archives).map((n) => path.parse(n).name.toUpperCase()));
const decoded = new Map();

function decode(name) {
  if (decoded.has(name)) return decoded.get(name);
  if (!available.has(name)) { decoded.set(name, null); return null; }
  const script = openScript(archives, name);
  const walker = new ScriptWalker({
    data: script.data, version: 'v3', resources: script.resources, text: false,
  });
  const result = walker.walkAll();
  const byOffset = new Map();
  const visitBlock = (block) => {
    if (!block || block.error) return;
    for (const command of block.commands) visitCommand(command);
    for (const spot of block.hotspots ?? []) { visitBlock(spot.enter); visitBlock(spot.leave); }
  };
  const visitCommand = (command) => {
    byOffset.set(command.offset, command);
    for (const block of command.blocks) visitBlock(block);
  };
  for (const r of result.roots) visitBlock(r);
  decoded.set(name, byOffset);
  return byOffset;
}

// ------------------------------------------------------------- compare

let checks = 0, differences = 0, missing = 0;
const perScript = new Map();

for (const entry of entries) {
  const byOffset = decode(entry.script);
  if (!byOffset) {
    // A log from another edition, or a script this edition does not have.
    missing++;
    continue;
  }
  checks++;
  const stat = perScript.get(entry.script) ?? { checks: 0, differ: 0 };
  stat.checks++;

  const command = byOffset.get(entry.offset);
  let problem = null;
  if (!command) {
    problem = `nothing decoded at ${entry.offset}`;
  } else {
    const family = command.index >> 4, opcode = command.index & 0x0F;
    if (family !== entry.family || opcode !== entry.opcode) {
      problem = `we decoded ${family}.${opcode} (${command.name}), the log says ${entry.family}.${entry.opcode}`;
    } else if (entry.name && command.name !== entry.name) {
      problem = `we call it ${command.name}, the log calls it ${entry.name}`;
    }
  }

  if (problem) {
    differences++;
    stat.differ++;
    if (differences <= 40) console.log(`  ${entry.script} at ${entry.offset}: ${problem}`);
  }
  perScript.set(entry.script, stat);
}

if (!quiet) {
  for (const [name, stat] of [...perScript].sort()) {
    console.log(`  ${name.padEnd(9)} ${String(stat.checks).padStart(7)} checks` +
      (stat.differ ? `  ${stat.differ} differ` : '  ok'));
  }
}

console.log(`\n${checks} commands compared in ${perScript.size} scripts (${edition})` +
  ` against ${golden.length} log file(s)`);
if (missing) console.log(`${missing} logged lines name a script this edition does not have — skipped`);
if (differences) {
  console.log(`${differences} differ`);
  process.exit(1);
}
console.log('0 differences');
