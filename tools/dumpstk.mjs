#!/usr/bin/env node
/**
 * dumpstk — takes the Goblins 3 STK/ITK archives apart.
 *
 * Every archive of the chosen edition is read, every member unpacked and
 * written out under `data/<edition>/stk/<ARCHIVE>/<NAME>`, and a manifest
 * records where each one came from, how it was packed and what it is. That
 * manifest is what `tools/checkstk.mjs` checks the round trip against.
 *
 * The edition decides the data (`../MILNIKY.md`): `floppy` is the DOS v1.00
 * release and the only one being worked on, `cd` is the v1.02 release kept
 * on disk for the later comparison.
 *
 * usage: node tools/dumpstk.mjs [--edition floppy|cd] [--archive NAME]
 *                               [--out DIR] [--list]
 */
import '../app/svision/tools/nodeEnv.mjs';   // must come first: the import headers read window.srcVersion
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { readArchive, fileData, unpack, classify } from './stklib.mjs';

// begin code

const EDITIONS = ['floppy', 'cd'];
/** Archives are found by extension; `.LTK` is not one (see `../NOTES.md`). */
const ARCHIVE_EXT = ['.STK', '.ITK'];

const args = process.argv.slice(2);
function opt(name, fallback = null) {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : fallback;
}
const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(here, '..');
const edition = opt('edition', 'floppy');
const listOnly = args.includes('--list');
const only = opt('archive', null);

if (!EDITIONS.includes(edition)) {
  throw new Error(`unknown --edition ${edition}, expected ${EDITIONS.join(' or ')}`);
}
const srcDir = path.resolve(root, `assets/original/${edition}`);
const outDir = path.resolve(root, opt('out', `data/${edition}/stk`));
if (!fs.existsSync(srcDir)) {
  throw new Error(`no ${path.relative(root, srcDir)} — see assets/original/README.md`);
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

const archives = fs.readdirSync(srcDir)
  .filter(f => ARCHIVE_EXT.includes(path.extname(f).toUpperCase()))
  .filter(f => !only || f.toUpperCase() === only.toUpperCase())
  .sort();

if (!archives.length) {
  throw new Error(`no ${ARCHIVE_EXT.join('/')} archive in ${path.relative(root, srcDir)}`);
}

const manifest = {
  tool: 'tools/dumpstk.mjs',
  edition,
  archives: [],
};
const types = new Map();
const compressions = new Map();
let totalFiles = 0, totalPacked = 0, totalPlain = 0, extendedCount = 0;

for (const archiveName of archives) {
  const archiveFile = path.join(srcDir, archiveName);
  const buf = fs.readFileSync(archiveFile);
  const files = readArchive(buf);

  console.log(`${archiveName.padEnd(12)} ${String(files.length).padStart(4)} files, ${buf.length} bytes`);

  const entry = {
    name: archiveName,
    file: path.relative(root, archiveFile),
    bytes: buf.length,
    sha256: sha256(buf),
    fileCount: files.length,
    files: [],
  };

  const target = path.join(outDir, path.parse(archiveName).name);
  if (!listOnly) fs.mkdirSync(target, { recursive: true });

  for (const file of files) {
    const body = fileData(buf, file);
    const { data, extended, chunks } = unpack(body, file.compression);
    const { ext, type, header } = classify(file.name, data);

    types.set(type, (types.get(type) || 0) + 1);
    compressions.set(file.compression, (compressions.get(file.compression) || 0) + 1);
    totalFiles++;
    totalPacked += file.size;
    totalPlain += data.length;
    if (extended) extendedCount++;

    if (!listOnly) fs.writeFileSync(path.join(target, file.name), data);
    if (listOnly) {
      console.log(`  ${file.name.padEnd(13)} ${type.padEnd(12)} ` +
                  `${String(file.size).padStart(8)} -> ${String(data.length).padStart(8)}` +
                  `${file.compression ? '' : '  stored'}${header ? '  ' + header : ''}`);
    }

    entry.files.push({
      name: file.name, ext, type, header,
      offset: file.offset,
      packedBytes: file.size,
      bytes: data.length,
      compression: file.compression,
      chunks,
      extendedLZ: extended,
      sha256: sha256(data),
    });
  }
  manifest.archives.push(entry);
}

manifest.summary = {
  archives: archives.length,
  files: totalFiles,
  packedBytes: totalPacked,
  bytes: totalPlain,
  types: Object.fromEntries([...types].sort()),
  compression: Object.fromEntries([...compressions].sort()),
  extendedLZ: extendedCount,
};

if (!listOnly) {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
}

console.log(`\n${totalFiles} files in ${archives.length} archives, ` +
            `${totalPacked} packed -> ${totalPlain} bytes`);
console.log(`types        ${[...types].sort().map(([t, n]) => `${t} ${n}`).join(', ')}`);
console.log(`compression  ${[...compressions].sort().map(([c, n]) => `${c} ${n}`).join(', ')}` +
            `  (extended LZ form in ${extendedCount})`);
if (!listOnly) console.log(`manifest     ${path.relative(root, path.join(outDir, 'manifest.json'))}`);
