#!/usr/bin/env node
/**
 * checkstk — the acceptance check for G1 (`../MILNIKY.md`).
 *
 * For every member of every archive: unpack it, pack it again with our own
 * packer, unpack that, and compare. The packed bytes are *not* compared with
 * the original's — Coktel's packer picked its strings its own way — but the
 * bytes that come back out have to be identical, both to what the archive
 * holds and to what `tools/dumpstk.mjs` wrote to `data/`.
 *
 * Three things are proved at once: the decoder reads the original streams,
 * the packer only produces streams the decoder reads back, and the files on
 * disk are what the archive holds.
 *
 * usage: node tools/checkstk.mjs [--edition floppy|cd] [--archive NAME]
 *                                [--out DIR] [--only-packed]
 *                                [--extended] [--chunked]
 * exit code 0 = no differences, 1 = differences
 */
import '../app/svision/tools/nodeEnv.mjs';   // must come first: the import headers read window.srcVersion
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { readArchive, fileData, unpack, pack, packChunks } from './stklib.mjs';

// begin code

const EDITIONS = ['floppy', 'cd'];

const args = process.argv.slice(2);
function opt(name, fallback = null) {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : fallback;
}
const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(here, '..');
const edition = opt('edition', 'floppy');
const only = opt('archive', null);
// Stored members carry no LZ stream of the original's; running them through
// our own packer still exercises the codec on real data, and that is worth
// the time on the floppy edition. `--only-packed` skips them.
const onlyPacked = args.includes('--only-packed');
// Round-trip through the extended (long-string) form as well. No Goblins 3
// stream uses it, so this is the only way its branch gets exercised.
const extended = args.includes('--extended');
// Round-trip through the chunked body (compression 2) instead of one stream.
// No Goblins 3 archive uses it either, so again this is the only exercise it
// gets — the chunk boundaries are ours, but the reader is the engine's.
const chunked = args.includes('--chunked');

if (!EDITIONS.includes(edition)) {
  throw new Error(`unknown --edition ${edition}, expected ${EDITIONS.join(' or ')}`);
}
const srcDir = path.resolve(root, `assets/original/${edition}`);
const outDir = path.resolve(root, opt('out', `data/${edition}/stk`));

const manifestFile = path.join(outDir, 'manifest.json');
const manifest = fs.existsSync(manifestFile)
  ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : null;
if (!manifest) {
  console.log(`no ${path.relative(root, manifestFile)} — the files on disk are not checked; ` +
              `run tools/dumpstk.mjs to include them`);
}
const dumped = new Map();
for (const a of manifest?.archives || []) {
  for (const f of a.files) dumped.set(`${a.name}/${f.name}`, f);
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

const archives = fs.readdirSync(srcDir)
  .filter(f => ['.STK', '.ITK'].includes(path.extname(f).toUpperCase()))
  .filter(f => !only || f.toUpperCase() === only.toUpperCase())
  .sort();

let checked = 0, skipped = 0, bad = 0;
let packedBytes = 0, plainBytes = 0;
const started = Date.now();

for (const archiveName of archives) {
  const buf = fs.readFileSync(path.join(srcDir, archiveName));
  const files = readArchive(buf);
  const dir = path.join(outDir, path.parse(archiveName).name);
  let archiveBad = 0;

  for (const file of files) {
    if (onlyPacked && file.compression === 0) { skipped++; continue; }

    const problems = [];
    const original = unpack(fileData(buf, file), file.compression).data;

    // unpack -> pack -> unpack, the round trip G1 is accepted on
    const again = chunked
      ? unpack(packChunks(original, { extended }), 2).data
      : unpack(pack(original, { extended }), 1).data;
    if (!again.equals(original)) {
      const at = again.length === original.length
        ? original.findIndex((b, i) => again[i] !== b) : -1;
      problems.push(again.length !== original.length
        ? `round trip gave ${again.length} bytes, expected ${original.length}`
        : `round trip differs at byte ${at}`);
    }

    // and what dumpstk wrote has to be the same bytes again
    const record = dumped.get(`${archiveName}/${file.name}`);
    if (record) {
      const digest = sha256(original);
      if (digest !== record.sha256) problems.push(`manifest sha256 ${record.sha256.slice(0, 16)}… != ${digest.slice(0, 16)}…`);
      const onDisk = path.join(dir, file.name);
      if (!fs.existsSync(onDisk)) problems.push(`missing ${path.relative(root, onDisk)}`);
      else if (!fs.readFileSync(onDisk).equals(original)) problems.push(`${path.relative(root, onDisk)} differs`);
    } else if (manifest) {
      problems.push('not in the manifest — rerun tools/dumpstk.mjs');
    }

    checked++;
    packedBytes += file.size;
    plainBytes += original.length;
    if (problems.length) {
      console.log(`  ${archiveName}/${file.name.padEnd(13)} FAIL  ${problems.join('; ')}`);
      bad++; archiveBad++;
    }
  }
  console.log(`${archiveName.padEnd(12)} ${String(files.length).padStart(4)} files` +
              (archiveBad ? `, ${archiveBad} differ` : ', 0 differences'));
}

const seconds = ((Date.now() - started) / 1000).toFixed(1);
console.log(`\n${checked} files round-tripped in ${archives.length} archives ` +
            `(${plainBytes} bytes, ${seconds}s)` +
            (skipped ? `, ${skipped} stored members skipped` : '') +
            (extended ? ', extended LZ form' : '') +
            (chunked ? ', chunked body' : ''));

if (bad) {
  console.log(`${bad} of ${checked} differ`);
  process.exit(1);
}
console.log(`0 differences`);
