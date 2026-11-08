#!/usr/bin/env node
/**
 * checkassets — proves the dumped assets still hold the original's bytes.
 *
 * `tools/dumpassets.mjs` turns resources into PNGs, WAVs and JSON. This walks
 * the archives again, decodes every resource a second time, reads back what
 * was written and compares:
 *
 *   sprite   the PNG's pixels and its palette against the decoded resource
 *   palette  the JSON's 6-bit components against the resource's bytes
 *   sample   the WAV, read back through `PCMSample.fromWAV`, against the SND
 *   video    the first frame's PNG against the decoded frame
 *
 * That is not the milestone's acceptance — G2 is accepted by
 * `tools/matchscreen.mjs` against a screenshot of the original in DOSBox —
 * but it is the part of it that can be proved without one, and it keeps
 * working once the archives are gone from the machine.
 *
 * usage: node tools/checkassets.mjs [--edition floppy|cd] [--out DIR] [--quiet]
 * exit code 0 = no differences, 1 = differences
 */
import '../app/svision/tools/nodeEnv.mjs';   // must come first: the import headers read window.srcVersion
import fs from 'node:fs';
import path from 'node:path';
import { readArchive, fileData, unpack } from './stklib.mjs';
import { ResourceSet, decodeSprite, readPalette, readSND } from './assetlib.mjs';
import { readIMD, decodeIMD } from './imdlib.mjs';
import { decodePNG } from '../app/svision/tools/retro/png.mjs';

const { VGAPalette } = await import('../app/svision/js/platform/canvas2D/vga/vgaPalette.js');
const { PCMSample } = await import('../app/svision/js/audio/pcmSample.js');

// begin code

const args = process.argv.slice(2);
function opt(name, fallback = null) {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : fallback;
}
const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(here, '..');
const edition = opt('edition', 'floppy');
const quiet = args.includes('--quiet');
const srcDir = path.resolve(root, `assets/original/${edition}`);
const outDir = path.resolve(root, opt('out', `data/${edition}/assets`));

const manifestFile = path.join(outDir, 'manifest.json');
if (!fs.existsSync(manifestFile)) {
  throw new Error(`no ${path.relative(root, manifestFile)} — run tools/dumpassets.mjs first`);
}
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));

const archives = fs.readdirSync(srcDir)
  .filter(f => ['.STK', '.ITK'].includes(path.extname(f).toUpperCase()))
  .sort()
  .map(name => { const buf = fs.readFileSync(path.join(srcDir, name)); return { buf, files: readArchive(buf) }; });
const index = new Map();
for (const archive of archives) {
  for (const file of archive.files) index.set(file.name.toUpperCase(), { archive, file });
}
function member(name) {
  const hit = index.get(name.toUpperCase());
  return hit ? unpack(fileData(hit.archive.buf, hit.file), hit.file.compression).data : null;
}

/** 6-bit components as a PNG palette, the way dumpassets writes them. */
function paletteToRGB(components) {
  const rgb = Buffer.alloc(768);
  for (let i = 0; i < 768; i++) rgb[i] = VGAPalette.to8bit(components[i]);
  return rgb;
}

let checks = 0, differences = 0;
const fail = (what, why) => { differences++; console.log(`  ${what.padEnd(30)} ${why}`); };

// ------------------------------------------------------------------- scripts

for (const entry of manifest.scripts) {
  const set = new ResourceSet({
    name: entry.name,
    tot: member(entry.name + '.TOT'),
    ext: member(entry.name + '.EXT'),
    texts: member(entry.name + '.ANG'),
  });
  set.ex = entry.exFile ? member(entry.exFile) : null;
  set.im = entry.imFile ? member(entry.imFile) : null;

  const paletteRecord = entry.resources.find(r => r.kind === 'palette' &&
    `resource ${r.id}` === entry.spritePalette);
  const spriteComponents = paletteRecord
    ? readPalette(set.resource(paletteRecord.id).data).components
    : VGAPalette.defaultPalette().bytes;
  const spritePLTE = paletteToRGB(spriteComponents);

  for (const record of entry.resources) {
    if (!record.file) continue;
    const file = path.join(outDir, record.file);
    const where = `${entry.name}/${record.id}`;
    if (!fs.existsSync(file)) { checks++; fail(where, `missing ${record.file}`); continue; }

    const resource = set.resource(record.id);
    if (!resource) { checks++; fail(where, 'the archive no longer has this resource'); continue; }

    if (record.kind === 'sprite') {
      checks++;
      const { pixels } = decodeSprite(resource.data, resource.width, resource.height);
      const png = decodePNG(fs.readFileSync(file));
      if (png.width !== resource.width || png.height !== resource.height) {
        fail(where, `PNG is ${png.width}x${png.height}, resource ${resource.width}x${resource.height}`);
      } else {
        // The PNG is indexed, so the pixel bytes come back through its PLTE;
        // comparing the RGBA proves pixels and palette together.
        let bad = -1;
        for (let i = 0; i < pixels.length && bad < 0; i++) {
          const c = pixels[i] * 3, o = i * 4;
          if (png.rgba[o] !== spritePLTE[c] || png.rgba[o + 1] !== spritePLTE[c + 1] ||
              png.rgba[o + 2] !== spritePLTE[c + 2]) bad = i;
        }
        if (bad >= 0) fail(where, `pixel ${bad % resource.width},${Math.floor(bad / resource.width)} differs`);
      }

    } else if (record.kind === 'palette') {
      checks++;
      const { components } = readPalette(resource.data);
      const json = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (json.bits !== 6) fail(where, `JSON says ${json.bits} bits, expected 6`);
      else if (json.components.length !== 768) fail(where, `${json.components.length} components, expected 768`);
      else {
        const bad = components.findIndex((v, i) => v !== json.components[i]);
        if (bad >= 0) fail(where, `component ${bad} is ${json.components[bad]}, expected ${components[bad]}`);
      }

    } else if (record.kind === 'sample') {
      checks++;
      const snd = readSND(resource.data);
      const back = PCMSample.fromWAV(new Uint8Array(fs.readFileSync(file)));
      // Signed, not unsigned — see `app/coktel/js/snd.js`.
      const expected = PCMSample.fromSigned8(snd.samples, snd.rate);
      if (back.sampleRate !== expected.sampleRate) {
        fail(where, `WAV is ${back.sampleRate} Hz, SND ${expected.sampleRate} Hz`);
      } else if (back.samples.length !== expected.samples.length) {
        fail(where, `WAV holds ${back.samples.length} samples, SND ${expected.samples.length}`);
      } else {
        const bad = expected.samples.findIndex((v, i) => v !== back.samples[i]);
        if (bad >= 0) fail(where, `sample ${bad} differs`);
      }
    }
  }
}

// -------------------------------------------------------------------- videos

for (const record of manifest.videos) {
  checks++;
  const where = `video/${record.name}`;
  const buf = member(record.name + '.IMD');
  if (!buf) { fail(where, 'the archive no longer has this video'); continue; }

  const imd = readIMD(buf);
  if (imd.frameCount !== record.frameCount) {
    fail(where, `${imd.frameCount} frames, manifest says ${record.frameCount}`);
    continue;
  }
  let frame = null;
  for (const f of decodeIMD(buf, imd, { until: 1 })) frame = f;

  const file = path.join(outDir, 'video', record.name, 'frame-0000.png');
  if (!fs.existsSync(file)) { fail(where, `missing ${path.relative(root, file)}`); continue; }

  const png = decodePNG(fs.readFileSync(file));
  const plte = paletteToRGB(frame.palette);
  let bad = -1;
  for (let i = 0; i < frame.surface.length && bad < 0; i++) {
    const c = frame.surface[i] * 3, o = i * 4;
    if (png.rgba[o] !== plte[c] || png.rgba[o + 1] !== plte[c + 1] || png.rgba[o + 2] !== plte[c + 2]) bad = i;
  }
  if (bad >= 0) fail(where, `frame 0 pixel ${bad % imd.width},${Math.floor(bad / imd.width)} differs`);
}

console.log(`\n${checks} assets checked in ${manifest.scripts.length} scripts and ${manifest.videos.length} videos`);
if (differences) {
  console.log(`${differences} differ`);
  process.exit(1);
}
console.log('0 differences');
if (!quiet) {
  console.log('(this is not the G2 acceptance — that is tools/matchscreen.mjs against DOSBox)');
}
