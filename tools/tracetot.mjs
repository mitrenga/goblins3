#!/usr/bin/env node
/**
 * tracetot — writes down what the interpreter makes of each TOT script.
 *
 * For every script of the edition it walks the bytecode with the real
 * interpreter from `app/coktel` and writes two files:
 *
 *   `<NAME>.txt`   a listing — one line per command, nested by block, with the
 *                  offset in front so a line here and a line of a ScummVM
 *                  debug log sit at the same number
 *   `<NAME>.json`  the same walk as data: the header, the entry points, and a
 *                  flat `steps` array of `{offset, family, opcode, name}` in
 *                  offset order
 *
 * `steps` is the record `tools/matchtot.mjs` compares. It is keyed by offset
 * rather than by time on purpose: a static walk has no time, but every line
 * a running engine logs carries the offset it was at, so the two can be lined
 * up without running anything here.
 *
 * ## What this is not, yet
 *
 * The milestone's other half is a trace of a script *running* — the values
 * variables take, in the order the engine assigns them. That needs the rest of
 * the interpreter (drawing, hotspots, input), which is G4, and it will be
 * written here next to `steps` when it exists. The check that can be made
 * today is `tools/checktot.mjs`; the check that needs the original is
 * `tools/matchtot.mjs`.
 *
 * usage: node tools/tracetot.mjs [--edition floppy|cd] [--script NAME]
 *                                [--out DIR] [--print] [--no-scan]
 */
import '../app/svision/tools/nodeEnv.mjs';   // must come first: the import headers read window.srcVersion
import fs from 'node:fs';
import path from 'node:path';
import { openEdition, openScript, scriptNames } from './totlib.mjs';

const { ScriptWalker, formatListing } = await import('../app/coktel/js/walker.js');

// begin code

const args = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : fallback;
};
const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(here, '..');
const edition = opt('edition', 'floppy');
const onlyScript = opt('script', null);
const scanGaps = !args.includes('--no-scan');
const toStdout = args.includes('--print');
const outDir = path.resolve(root, opt('out', `data/${edition}/tot`));

const archives = openEdition(root, edition);
const names = scriptNames(archives)
  .filter((n) => !onlyScript || path.parse(n).name === onlyScript.toUpperCase().replace(/\.TOT$/, ''));
if (!names.length) throw new Error(`the ${edition} edition has no such script`);

/**
 * Flattens a walk into one entry per decoded command, in offset order.
 *
 * The listing keeps the tree because that is how a person reads it; the record
 * is flat because that is how a log from a running engine arrives.
 */
function steps(result) {
  const out = [];
  const visitBlock = (block) => {
    if (!block || block.error) return;
    for (const command of block.commands) visitCommand(command);
    for (const spot of block.hotspots ?? []) {
      visitBlock(spot.enter);
      visitBlock(spot.leave);
    }
  };
  const visitCommand = (command) => {
    out.push({
      offset: command.offset,
      // The two numbers a running engine logs: the family and the opcode.
      family: command.index >> 4,
      opcode: command.index & 0x0F,
      name: command.name,
      ...(command.draw ? { draw: command.draw.index, drawName: command.draw.name } : {}),
      ...(command.gob ? { gob: command.gob.index, gobName: command.gob.name } : {}),
      length: command.length,
    });
    for (const block of command.blocks) visitBlock(block);
  };
  for (const root_ of result.roots) visitBlock(root_);
  out.sort((a, b) => a.offset - b.offset);
  return out;
}

const manifest = { tool: 'tools/tracetot.mjs', edition, scripts: [] };
let blocks = 0, commands = 0, problems = 0;

for (const name of names) {
  const script = openScript(archives, name);
  const walker = new ScriptWalker({
    data: script.data,
    version: 'v3',
    resources: script.resources,
  });
  const result = walker.walkAll({ scanGaps });

  const listing = formatListing(result);
  const record = {
    script: script.name,
    edition,
    version: `${script.set.props.versionMajor}.${script.set.props.versionMinor}`,
    variablesCount: script.set.props.variablesCount,
    animDataSize: script.set.props.animDataSize,
    scriptEnd: script.set.props.scriptEnd,
    entryPoints: walker.entryPoints(),
    coverage: result.coverage,
    problems: result.problems,
    opcodes: Object.fromEntries([...result.histogram].sort((a, b) => b[1] - a[1])),
    steps: steps(result),
  };

  if (toStdout) {
    console.log(`\n===== ${script.name} =====`);
    console.log(listing);
  } else {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, `${script.name}.txt`), listing + '\n');
    fs.writeFileSync(path.join(outDir, `${script.name}.json`), JSON.stringify(record, null, 1) + '\n');
  }

  blocks += result.blocks;
  commands += result.commands;
  problems += result.problems.length;
  manifest.scripts.push({
    name: script.name,
    blocks: result.blocks,
    commands: result.commands,
    steps: record.steps.length,
    covered: result.coverage.bytes,
    total: result.coverage.total,
    problems: result.problems.length,
  });
  console.log(`${script.name.padEnd(9)} ${String(result.blocks).padStart(5)} blocks` +
    ` ${String(result.commands).padStart(6)} commands` +
    ` ${String(record.steps.length).padStart(6)} steps` +
    (result.problems.length ? `  ${result.problems.length} PROBLEMS` : ''));
}

if (!toStdout) {
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
}
console.log(`\n${names.length} scripts, ${blocks} blocks, ${commands} commands` +
  (toStdout ? '' : ` -> ${path.relative(root, outDir)}`));
if (problems) {
  console.log(`${problems} blocks did not close — run tools/checktot.mjs`);
  process.exit(1);
}
