#!/usr/bin/env node
/**
 * runtot — runs the TOT scripts without a browser, and checks the run against
 * the reading.
 *
 * `checktot.mjs` proves the bytecode can be *read* consistently. This proves
 * something the reading cannot: that **executing** it — following real
 * conditions, real variables, real jumps — lands on the same commands the
 * disassembly says are there.
 *
 * The two arrive at each offset by completely different routes. The walk
 * follows the block structure; the run follows control flow, evaluates every
 * condition against a variable block it has been filling itself, and takes the
 * branch that comes out. If the evaluator computed a condition wrongly, or an
 * opcode wrote the wrong width into a variable, or the call stack lost its
 * place, the run ends up at an offset that is not the start of a command — and
 * that is reported here, per command, not as a vague "it crashed".
 *
 * ## The host
 *
 * The interpreter hands everything that is not control flow or a variable to a
 * host. This one **records and answers plainly**: it says which files the
 * archives hold, hands over their bytes, keeps a virtual clock that never
 * jumps, reports no key and no mouse, and writes down every effect. It does
 * not draw and does not play anything — that is G4 and G5.
 *
 * A run therefore ends where the script starts waiting for the player. That is
 * one of two places. Most scripts reach a **hotspot block** and stop there.
 * The rest spin in a loop asking for a key until one arrives — the original's
 * own idle loop — and a host that never reports a key would let them spin
 * forever, so after enough fruitless asks this one stops the run and says
 * `waiting`. Both are honest places to stop and the tool says which, per
 * script, along with how far it got.
 *
 * ## Repeatable, on purpose
 *
 * Nothing here reads the wall clock or `Math.random()`. `rand()` in a script
 * gets a seeded source and the clock is a counter, so two runs of the same
 * script produce the same trace byte for byte (R-009, `../METHODOLOGY.md`).
 *
 * That is what the **fingerprint** at the end is for. It is a hash of every
 * command the run executed, in order, with what each one wrote into the
 * variable block — so it changes if anything about the interpreter's behaviour
 * changes, and does not if nothing did. Keep the number; when it moves without
 * a reason, something moved. It is the cheap test of the two the methodology
 * names: `match*` asks "is it right?", this asks "is it still what it was?"
 * and costs a few seconds instead of a golden record.
 *
 * usage: node tools/runtot.mjs [--edition floppy|cd] [--script NAME]
 *                              [--steps N] [--wait N] [--seed N]
 *                              [--out DIR] [--quiet]
 * exit code 0 = no differences, 1 = differences
 */
import '../app/svision/tools/nodeEnv.mjs';   // must come first: the import headers read window.srcVersion
import fs from 'node:fs';
import path from 'node:path';
import { openEdition, openScript, scriptNames } from './totlib.mjs';
import { archiveHost, summariseWanted } from './hostlib.mjs';

const { ScriptWalker, seededRandom } = await import('../app/coktel/js/walker.js');
const { Interpreter, checkRunTable } = await import('../app/coktel/js/interpreter.js');

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
const maxSteps = Number(opt('steps', '200000'));
/** How many times a script may ask for a key before we call it an idle loop. */
const waitLimit = Number(opt('wait', '2000'));
const seed = Number(opt('seed', '0xC0C7E1'));
const outDir = opt('out', null);
const quiet = args.includes('--quiet');

// A name in the run table that no opcode table has would look like an opcode
// that is simply not implemented, so it is checked before anything runs.
const strays = checkRunTable('v3');
if (strays.length) throw new Error(`the interpreter implements opcodes no table has: ${strays.join(', ')}`);

const archives = openEdition(root, edition);
const names = scriptNames(archives)
  .filter((n) => !onlyScript || path.parse(n).name === onlyScript.toUpperCase().replace(/\.TOT$/, ''));
if (!names.length) throw new Error(`the ${edition} edition has no such script`);

/**
 * Every command the disassembly found, by offset.
 *
 * This is what the run is checked against. It is built by the walker, which
 * reaches the code by structure rather than by execution.
 */
function decodeByOffset(script) {
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
  return { byOffset, problems: result.problems.length };
}

let ranScripts = 0, steps = 0, differences = 0, unevaluated = 0, effects = 0;
let reached = 0, decodedTotal = 0;
/** The fingerprint of the whole run, built from the scripts' own. */
let total = 0x811C9DC5;

/**
 * FNV-1a over a string, folded into a 32-bit state.
 *
 * Any deterministic hash would do; this one is four lines, needs nothing, and
 * gives the same number in every JavaScript engine. It is a fingerprint, not a
 * checksum against tampering.
 */
function hash(state, text) {
  let h = state >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i) & 0xFF;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** A fingerprint as eight hex digits. */
const hex = (n) => (n >>> 0).toString(16).padStart(8, '0');
const reasons = new Map();
const wanted = new Map();

for (const name of names) {
  const script = openScript(archives, name);
  const { byOffset, problems } = decodeByOffset(script);
  if (problems) {
    console.log(`${script.name.padEnd(9)} SKIP  the disassembly has ${problems} problems — run tools/checktot.mjs`);
    differences += problems;
    continue;
  }

  // ------------------------------------------------------------ the host

  const trace = [];
  const mismatches = [];
  /** Every command offset the run reached, to say how much of it it exercised. */
  const visited = new Set();
  /** The running hash of this script's behaviour; see the note above. */
  let fingerprint = 0x811C9DC5;

  const host = archiveHost({
    archives, script, waitLimit,

    onCommand(vm, command) {
      // The check: the run's own offset has to be a command the walk found,
      // and the same one.
      const decoded = byOffset.get(command.offset);
      if (command.table === 'func') {
        if (!decoded) {
          mismatches.push(`${command.offset}: ran ${command.name}, the disassembly has no command there`);
        } else if (decoded.name !== command.name) {
          mismatches.push(`${command.offset}: ran ${command.name}, the disassembly says ${decoded.name}`);
        }
        visited.add(command.offset);
      }
      fingerprint = hash(fingerprint, `${command.offset}:${command.name}`);
      trace.push({ t: trace.length + 1, offset: command.offset, table: command.table, name: command.name });
    },

    onEffect(vm, effect) {
      effects++;
      if (effect.unevaluated) unevaluated++;
      const last = trace[trace.length - 1];
      if (last) {
        if (effect.values) last.values = effect.values.map(summarise);
        if (effect.unevaluated) last.unevaluated = true;
      }
      // Writes since the last command, so a trace shows what each one changed.
      const writes = vm.variables.takeWrites();
      for (const write of writes) fingerprint = hash(fingerprint, `=${write.offset}/${write.size}/${write.value}`);
      if (writes.length && last) last.writes = writes;
    },
  });

  // --------------------------------------------------------------- the run

  const vm = new Interpreter({
    data: script.data,
    host,
    version: 'v3',
    random: seededRandom(seed),
    maxSteps,
  });
  vm.variables.watch();

  const result = vm.run();
  ranScripts++;
  steps += result.steps;
  differences += mismatches.length;
  reasons.set(result.reason, (reasons.get(result.reason) ?? 0) + 1);
  for (const [op, n] of host.wanted) wanted.set(op, (wanted.get(op) ?? 0) + n);
  reached += visited.size;
  decodedTotal += byOffset.size;
  total = hash(total, `${script.name}:${hex(fingerprint)}`);

  if (!quiet) {
    console.log(`${script.name.padEnd(9)} ${String(result.steps).padStart(6)} steps` +
      `  stopped: ${result.reason.padEnd(10)}` +
      ` ${String(visited.size).padStart(5)}/${String(byOffset.size).padEnd(5)} reached` +
      `  ${hex(fingerprint)}` +
      (mismatches.length ? `  ${mismatches.length} DIFFER` : '') +
      (result.error ? `  ${result.error}` : '') +
      (vm.totToLoad ? `  -> ${vm.totToLoad}` : ''));
  }
  for (const mismatch of mismatches.slice(0, 10)) console.log(`  ${script.name}: ${mismatch}`);

  if (outDir) {
    const dir = path.resolve(root, outDir);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${script.name}.json`), JSON.stringify({
      tool: 'tools/runtot.mjs',
      script: script.name,
      edition,
      seed,
      stopped: result.reason,
      steps: result.steps,
      unevaluated: vm.unevaluated,
      reached: visited.size,
      decoded: byOffset.size,
      totToLoad: vm.totToLoad,
      strayWrites: vm.variables.strays,
      fingerprint: hex(fingerprint),
      trace,
    }, null, 1) + '\n');
  }
}

/** One operand value, small enough to sit in a trace line. */
function summarise(value) {
  if (value && typeof value === 'object' && 'offset' in value) return `&${value.offset}`;
  if (typeof value === 'string') return value.length > 40 ? value.slice(0, 40) + '…' : value;
  return value;
}

console.log(`\n${ranScripts} scripts run (${edition}), ${steps} commands executed,` +
  ` ${effects} handed to the host, ${unevaluated} of them with operands unevaluated`);
console.log(`${reached} of the ${decodedTotal} commands in those scripts were reached` +
  ` (${(100 * reached / decodedTotal).toFixed(1)}%) — the rest need a player`);
console.log(`stopped: ${[...reasons].map(([r, n]) => `${n}x ${r}`).join(', ')}`);
if (!quiet && wanted.size) {
  console.log(`most asked of the host: ${summariseWanted(wanted, 8)}`);
}

if (differences) {
  console.log(`${differences} differ`);
  process.exit(1);
}
console.log(`fingerprint ${hex(total)} (seed ${hex(seed)}, ${maxSteps} step bound, ${waitLimit} key limit)`);
console.log('0 differences between the run and the disassembly');
