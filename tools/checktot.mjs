#!/usr/bin/env node
/**
 * checktot — proves the interpreter reads the scripts the way the original does.
 *
 * It walks the bytecode of every TOT in the edition with the real interpreter
 * from `app/coktel` and checks the one thing the data can settle on its own:
 *
 * > a block declares how many commands it holds and how many bytes it is;
 * > decoding that many commands has to land **exactly** on that end.
 *
 * Every opcode's operand shape is under that check, in every block of every
 * script. An opcode that reads one byte too few or too many does not produce a
 * plausible-looking listing here — it produces a block that does not close,
 * and usually a cascade of them. That is why the number this prints means
 * something without an emulator anywhere near it.
 *
 * With `--evaluate` it also runs every expression through the evaluator and
 * requires it to consume exactly the bytes reading it consumed. That is the
 * only check the evaluator gets without a running game — and a real one,
 * because it takes a different path through the same bytes for every operand
 * kind. It does not check the *values*; that needs a running game and comes
 * with G4.
 *
 * It is **not** the G3 acceptance: G3 is accepted by `tools/matchtot.mjs`
 * against a recorded run of the original, which is the only thing that can say
 * the interpreter also *computes* the right values. This says the interpreter
 * reads the right bytes, which is the half that can be proved today and the
 * half that goes on being true once the archives are off the machine.
 *
 * usage: node tools/checktot.mjs [--edition floppy|cd] [--script NAME]
 *                                [--evaluate] [--no-scan] [--quiet]
 * exit code 0 = no differences, 1 = differences
 */
import '../app/svision/tools/nodeEnv.mjs';   // must come first: the import headers read window.srcVersion
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
const onlyScript = opt('script', null);
const scanGaps = !args.includes('--no-scan');
const evaluate = args.includes('--evaluate');
const quiet = args.includes('--quiet');

const archives = openEdition(root, edition);
const names = scriptNames(archives)
  .filter((n) => !onlyScript || path.parse(n).name === onlyScript.toUpperCase().replace(/\.TOT$/, ''));

if (!names.length) throw new Error(`the ${edition} edition has no such script`);

let blocks = 0, commands = 0, differences = 0, covered = 0, total = 0;
let evaluated = 0, undecidable = 0;
const opcodes = new Map();

for (const name of names) {
  const script = openScript(archives, name);
  const walker = new ScriptWalker({
    data: script.data,
    version: 'v3',
    resources: script.resources,
    text: false,
    evaluate,
  });

  let result;
  try {
    result = walker.walkAll({ scanGaps });
  } catch (error) {
    // A throw here is a walk that could not even start — still a difference.
    console.log(`${script.name.padEnd(9)} FAILED  ${error.message}`);
    differences++;
    continue;
  }

  blocks += result.blocks;
  commands += result.commands;
  differences += result.problems.length;
  covered += result.coverage.bytes;
  total += result.coverage.total;
  for (const [op, n] of result.histogram) opcodes.set(op, (opcodes.get(op) ?? 0) + n);
  evaluated += result.evaluatorChecks.evaluated;
  undecidable += result.evaluatorChecks.undecidable;

  if (!quiet) {
    const percent = (100 * result.coverage.bytes / result.coverage.total).toFixed(1);
    console.log(`${script.name.padEnd(9)} ${String(result.blocks).padStart(5)} blocks` +
      ` ${String(result.commands).padStart(6)} commands` +
      ` ${String(result.problems.length).padStart(3)} differ  ${percent.padStart(5)}% covered`);
  }
  for (const problem of result.problems) {
    console.log(`  ${script.name} at ${problem.offset}: ${problem.message}`);
  }
}

const percent = total ? (100 * covered / total).toFixed(2) : '0.00';
console.log(`\n${blocks} blocks, ${commands} commands in ${names.length} scripts` +
  ` (${edition}), ${percent}% of ${total} bytes of bytecode walked`);
console.log(`${opcodes.size} distinct opcodes seen`);
if (evaluate) {
  console.log(`${evaluated} expressions also evaluated` +
    (undecidable ? `, ${undecidable} undecidable (they divide by a variable, and the block is zeroed)` : ''));
} else {
  console.log('(add --evaluate to cross-check the expression evaluator as well)');
}

if (differences) {
  console.log(`${differences} differ`);
  process.exit(1);
}
console.log('0 differences');
if (!quiet) {
  console.log('(this is not the G3 acceptance — that is tools/matchtot.mjs against a recorded run)');
}
