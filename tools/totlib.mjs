/**
 * totlib — the glue between the archives of Goblins 3 and the shared
 * interpreter in `app/coktel`.
 *
 * The interpreter knows nothing about STK archives, editions or file names:
 * it takes the bytes of a TOT and, where an opcode needs one, a resource. This
 * turns an edition on disk into exactly that, so `tracetot`, `matchtot` and
 * `checktot` all open the archives the same way.
 *
 * It is deliberately thin. Anything that is about the *interpreter* belongs in
 * `app/coktel`, where the other two Gobliiins projects get it too (R-030);
 * anything about the *archives* is already in `stklib.mjs` and `assetlib.mjs`.
 *
 * @module tools/totlib
 */
import fs from 'node:fs';
import path from 'node:path';
import { readArchive, fileData, unpack } from './stklib.mjs';
import { ResourceSet } from './assetlib.mjs';

// begin code

export const EDITIONS = ['floppy', 'cd'];

/**
 * Opens every archive of an edition and indexes their members.
 *
 * Members stay packed until asked for — the CD edition is 113 MB and no tool
 * here needs all of it at once.
 *
 * @param {string} root the project root
 * @param {string} edition `floppy` or `cd`
 * @returns {{member: (name: string) => (Buffer|null), names: string[]}}
 */
export function openEdition(root, edition) {
  if (!EDITIONS.includes(edition)) {
    throw new Error(`unknown edition "${edition}", expected ${EDITIONS.join(' or ')}`);
  }
  const srcDir = path.resolve(root, `assets/original/${edition}`);
  if (!fs.existsSync(srcDir)) {
    throw new Error(`no ${path.relative(root, srcDir)} — the original archives are not on this machine`);
  }

  const index = new Map();
  for (const name of fs.readdirSync(srcDir).sort()) {
    if (!['.STK', '.ITK'].includes(path.extname(name).toUpperCase())) continue;
    const buf = fs.readFileSync(path.join(srcDir, name));
    // Later archives win, the way the engine's own archive stack works.
    for (const file of readArchive(buf)) index.set(file.name.toUpperCase(), { buf, file });
  }

  const cache = new Map();
  const member = (name) => {
    const key = name.toUpperCase();
    if (cache.has(key)) return cache.get(key);
    const hit = index.get(key);
    const data = hit ? unpack(fileData(hit.buf, hit.file), hit.file.compression).data : null;
    cache.set(key, data);
    return data;
  };

  return { member, names: [...index.keys()].sort() };
}

/** The names of every script in the edition, `.TOT` included, sorted. */
export function scriptNames(edition) {
  return edition.names.filter((n) => n.endsWith('.TOT'));
}

/**
 * One script, with everything the walker may ask of it.
 *
 * @param {{member: Function}} edition from {@link openEdition}
 * @param {string} totName with or without the `.TOT`
 * @returns {{name: string, data: Buffer, resources: (id: number) => (Uint8Array|null),
 *            set: ResourceSet}}
 */
export function openScript(edition, totName) {
  const base = path.parse(totName).name.toUpperCase();
  const tot = edition.member(base + '.TOT');
  if (!tot) throw new Error(`the edition has no ${base}.TOT`);

  const set = new ResourceSet({
    name: base,
    tot,
    ext: edition.member(base + '.EXT'),
    ex: null,
    im: null,
    texts: edition.member(base + '.ANG'),
  });
  // The shared files the header names can only be fetched once it is read.
  set.ex = edition.member(`COMMUN.EX${set.props.exFileNumber}`);
  // Goblins 3 has no IM file at all: every script pairs `communHandling` 2
  // with `imFileNumber` 0, which is the combination the engine skips.
  const hasIM = !(set.props.communHandling !== 0 && set.props.imFileNumber === 0);
  set.im = hasIM ? edition.member(`COMMUN.IM${set.props.imFileNumber || 1}`) : null;

  return {
    name: base,
    data: tot,
    set,
    resources: (id) => set.resource(id)?.data ?? null,
  };
}
