#!/usr/bin/env node
/**
 * dumpassets — takes the assets of every script out of the archives.
 *
 * For each `.TOT` script: its own resources and those of its `.EXT`, plus the
 * texts of the language file that belongs to it. Sprites come out as indexed
 * PNGs, palettes as PNG swatches and as JSON with the DAC's own 6-bit
 * components, SND samples as WAVs through `PCMSample`, the texts as JSON.
 * The IMD videos of the edition are read too — their header, palette and
 * frame tables as JSON, their frames as PNGs.
 *
 * A sprite has no palette of its own; the script sets one at run time. Where
 * a script carries exactly one palette resource, that is the one its sprites
 * are written with and the manifest says so; otherwise the VGA default
 * palette is used and the picture is right in shape but not in colour.
 *
 * usage: node tools/dumpassets.mjs [--edition floppy|cd] [--script NAME]
 *                                  [--video NAME] [--frames first|all|N]
 *                                  [--out DIR] [--list] [--no-video]
 */
import '../app/svision/tools/nodeEnv.mjs';   // must come first: the import headers read window.srcVersion
import fs from 'node:fs';
import path from 'node:path';
import { readArchive, fileData, unpack } from './stklib.mjs';
import { ResourceSet, classifyResource, decodeSprite, readPalette, readSND, textItem } from './assetlib.mjs';
import { readIMD, decodeIMD } from './imdlib.mjs';
import { encodeIndexedPNG } from '../app/svision/tools/retro/png.mjs';

const { VGAPalette } = await import('../app/svision/js/platform/canvas2D/vga/vgaPalette.js');
const { PCMSample } = await import('../app/svision/js/audio/pcmSample.js');

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
const onlyScript = opt('script', null);
const onlyVideo = opt('video', null);
const framesOpt = opt('frames', 'first');
const listOnly = args.includes('--list');
const noVideo = args.includes('--no-video');

if (!EDITIONS.includes(edition)) {
  throw new Error(`unknown --edition ${edition}, expected ${EDITIONS.join(' or ')}`);
}
const srcDir = path.resolve(root, `assets/original/${edition}`);
const outDir = path.resolve(root, opt('out', `data/${edition}/assets`));

// ------------------------------------------------------------------ archives

/**
 * Every archive of the edition, with its file table read but its members
 * still packed — the CD edition is 113 MB and no tool needs all of it.
 */
const archives = fs.readdirSync(srcDir)
  .filter(f => ['.STK', '.ITK'].includes(path.extname(f).toUpperCase()))
  .sort()
  .map(name => {
    const buf = fs.readFileSync(path.join(srcDir, name));
    return { name, buf, files: readArchive(buf) };
  });

const index = new Map();
for (const archive of archives) {
  for (const file of archive.files) {
    // Later archives win, the way the engine's own archive stack works.
    index.set(file.name.toUpperCase(), { archive, file });
  }
}

const cache = new Map();
/** One member of any archive, unpacked. Null when the edition has no such file. */
function member(name) {
  const key = name.toUpperCase();
  if (cache.has(key)) return cache.get(key);
  const hit = index.get(key);
  const data = hit ? unpack(fileData(hit.archive.buf, hit.file), hit.file.compression).data : null;
  cache.set(key, data);
  return data;
}

const DEFAULT_PALETTE = VGAPalette.defaultPalette().bytes;
/** 6-bit components to the 0..255 a PNG's PLTE wants, the way the DAC scales. */
function paletteToRGB(components) {
  const rgb = Buffer.alloc(768);
  for (let i = 0; i < 768; i++) rgb[i] = VGAPalette.to8bit(components[i]);
  return rgb;
}

const write = (file, data) => {
  if (listOnly) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
};

const manifest = { tool: 'tools/dumpassets.mjs', edition, scripts: [], videos: [] };
const kinds = new Map();
const count = (kind) => kinds.set(kind, (kinds.get(kind) || 0) + 1);

// ------------------------------------------------------------------- scripts

const scripts = [...index.keys()].filter(n => n.endsWith('.TOT')).sort()
  .filter(n => !onlyScript || n.toUpperCase() === onlyScript.toUpperCase() ||
                              n.toUpperCase() === onlyScript.toUpperCase() + '.TOT');

for (const totName of scripts) {
  const base = path.parse(totName).name;
  const tot = member(totName);
  let set;
  try {
    set = new ResourceSet({
      name: base,
      tot,
      ext: member(base + '.EXT'),
      // The shared resources; which one a script wants is in its header.
      ex: null,
      im: null,
      texts: member(base + '.ANG'),
    });
  } catch (e) {
    console.log(`${base.padEnd(10)} SKIP  ${e.message}`);
    continue;
  }
  // Now that the header is read, the shared files it names can be fetched.
  // The EX file is named by its number straight, and simply may not exist.
  const exName = `COMMUN.EX${set.props.exFileNumber}`;
  set.ex = member(exName);
  // The IM file is number 1 when the number is 0 — unless `communHandling`
  // says there is none at all, which is the case for every Goblins 3 script.
  const hasIM = !(set.props.communHandling !== 0 && set.props.imFileNumber === 0);
  const imName = `COMMUN.IM${set.props.imFileNumber || 1}`;
  set.im = hasIM ? member(imName) : null;

  const entry = {
    name: base,
    version: `${set.props.versionMajor}.${set.props.versionMinor}`,
    variablesCount: set.props.variablesCount,
    exFile: set.ex ? exName : null,
    imFile: set.im ? imName : null,
    functions: set.props.functions,
    resources: [],
    texts: null,
  };

  // Everything the script can reach, its own first and then its EXT's.
  const all = [];
  for (let i = 0; i < (set.totTable?.itemsCount || 0); i++) {
    const r = set.totResource(i);
    if (r) all.push(r);
  }
  for (let i = 0; i < (set.extTable?.itemsCount || 0); i++) {
    const r = set.extResource(i);
    if (r) all.push(r);
  }

  const palettes = all.filter(r => classifyResource(r).kind === 'palette');
  const paletteSource = palettes.length ? palettes[0] : null;
  const components = paletteSource ? readPalette(paletteSource.data).components : DEFAULT_PALETTE;
  const plte = paletteToRGB(components);
  entry.spritePalette = paletteSource ? `resource ${paletteSource.id}` : 'VGA default';

  const dir = path.join(outDir, base);
  for (const resource of all) {
    const { kind, note } = classifyResource(resource);
    count(kind);
    const record = { id: resource.id, from: resource.from, kind, note,
                     width: resource.width, height: resource.height, bytes: resource.data.length };

    if (kind === 'sprite') {
      try {
        const { pixels, form } = decodeSprite(resource.data, resource.width, resource.height);
        record.form = form;
        record.file = `${base}/sprite-${resource.id}.png`;
        write(path.join(dir, `sprite-${resource.id}.png`),
              encodeIndexedPNG(resource.width, resource.height, pixels, plte));
      } catch (e) {
        record.kind = 'broken sprite';
        record.note = e.message;
      }
    } else if (kind === 'palette') {
      const { components: c } = readPalette(resource.data);
      record.file = `${base}/palette-${resource.id}.json`;
      write(path.join(dir, `palette-${resource.id}.json`),
            JSON.stringify({ bits: 6, components: c }, null, 1) + '\n');
      // A swatch, 16 x 16 registers at 8 pixels each, to look at.
      const swatch = new Uint8Array(16 * 16);
      for (let i = 0; i < 256; i++) swatch[i] = i;
      write(path.join(dir, `palette-${resource.id}.png`),
            encodeIndexedPNG(16, 16, swatch, paletteToRGB(c), { scale: 8 }));
    } else if (kind === 'sample') {
      const snd = readSND(resource.data);
      record.rate = snd.rate;
      record.samples = snd.samples.length;
      record.file = `${base}/sample-${resource.id}.wav`;
      // Signed, not unsigned — see `app/coktel/js/snd.js`.
      const sample = PCMSample.fromSigned8(snd.samples, snd.rate);
      write(path.join(dir, `sample-${resource.id}.wav`), Buffer.from(sample.toWAV(8)));
    }
    entry.resources.push(record);
  }

  if (set.texts) {
    const texts = [];
    for (let i = 0; i < set.texts.itemsCount; i++) {
      const item = textItem(set.texts, i);
      texts.push(item ? item.toString('latin1') : null);
    }
    entry.texts = { count: texts.length, file: `${base}/texts.json` };
    write(path.join(dir, 'texts.json'), JSON.stringify(texts, null, 1) + '\n');
  }

  manifest.scripts.push(entry);
  const byKind = entry.resources.reduce((m, r) => (m[r.kind] = (m[r.kind] || 0) + 1, m), {});
  console.log(`${base.padEnd(10)} v${entry.version}  ` +
              `${String(entry.resources.length).padStart(3)} resources  ` +
              `${Object.entries(byKind).map(([k, n]) => `${n} ${k}`).join(', ')}` +
              `${entry.texts ? `, ${entry.texts.count} texts` : ''}`);
}

// -------------------------------------------------------------------- videos

const videos = noVideo ? [] : [...index.keys()].filter(n => n.endsWith('.IMD')).sort()
  .filter(n => !onlyVideo || n.toUpperCase() === onlyVideo.toUpperCase() ||
                             n.toUpperCase() === onlyVideo.toUpperCase() + '.IMD');

for (const name of videos) {
  const base = path.parse(name).name;
  const buf = member(name);
  let imd;
  try {
    imd = readIMD(buf);
  } catch (e) {
    console.log(`${base.padEnd(10)} SKIP  ${e.message}`);
    continue;
  }

  const wanted = framesOpt === 'all' ? imd.frameCount
    : framesOpt === 'first' ? 1
    : Math.max(1, Math.min(parseInt(framesOpt, 10) || 1, imd.frameCount));

  const dir = path.join(outDir, 'video', base);
  let written = 0;
  for (const frame of decodeIMD(buf, imd, { until: wanted })) {
    write(path.join(dir, `frame-${String(frame.frame).padStart(4, '0')}.png`),
          encodeIndexedPNG(imd.width, imd.height, frame.surface, paletteToRGB(frame.palette)));
    written++;
  }

  const record = {
    name: base, version: imd.version, features: imd.features, flags: imd.flags,
    frameCount: imd.frameCount, width: imd.width, height: imd.height,
    defaultX: imd.defaultX, defaultY: imd.defaultY,
    std: imd.std, hasFrameCoords: !!imd.frameCoords, hasFramePos: !!imd.framePos,
    sound: imd.sound,
    // The engine seeks straight to firstFramePos, so whatever lies between
    // the fields it reads and that position is data it never looks at.
    unreadHeaderBytes: imd.firstFramePos - imd.headerEnd,
    palette: Array.from(imd.palette),
    framesWritten: written,
    dir: `video/${base}`,
  };
  write(path.join(dir, 'video.json'), JSON.stringify({ ...record, palette: undefined }, null, 1) + '\n');
  manifest.videos.push({ ...record, palette: undefined });
  count('video');
  console.log(`${base.padEnd(10)} IMD v${imd.version}  ${imd.width}x${imd.height}  ` +
              `${imd.frameCount} frames, ${written} written` +
              `${imd.sound ? `, sound ${imd.sound.rate} Hz` : ''}`);
}

manifest.summary = {
  scripts: manifest.scripts.length,
  videos: manifest.videos.length,
  kinds: Object.fromEntries([...kinds].sort()),
};
write(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

console.log(`\n${manifest.scripts.length} scripts, ${manifest.videos.length} videos`);
console.log(`resources    ${[...kinds].sort().map(([k, n]) => `${k} ${n}`).join(', ')}`);
if (!listOnly) console.log(`manifest     ${path.relative(root, path.join(outDir, 'manifest.json'))}`);
