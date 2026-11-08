#!/usr/bin/env node
/**
 * renderscreen — paints a screen of the game through the VGA card's own model.
 *
 * Nothing here draws pixels itself: the bytes of a decoded sprite go into a
 * `VGAVideoRAM` of 320x200, the 6-bit components of a palette resource into a
 * `VGAPalette`, and the picture comes out of `VGAVideoRAM.paint()` — the same
 * two classes the game will run on in the browser (R-029). If the colours
 * here are right, they are right in the game.
 *
 * Three ways to say what to paint:
 *
 *   --file NAME [--palette-file N]  a sprite that is an archive member of its
 *                                   own — the Coktel logo the game opens with
 *                                   is `COKTEL.IMS` with `COKTEL.CLT`
 *   --script NAME [--resource ID]   one resource of one script, with that
 *                                   script's own palette
 *   --video NAME [--frame N]        one frame of an IMD, with the palette the
 *                                   video has reached by then
 *   --spec FILE                     a screen description in JSON: a palette, a
 *                                   background and any number of sprites at
 *                                   their places — what a `match*` run needs,
 *                                   because a screen of the game is more than
 *                                   one resource
 *
 * A spec looks like this:
 *
 *   {
 *     "name": "menu",
 *     "script": "MENU",
 *     "palette": 10,
 *     "background": 8,
 *     "layers": [ { "resource": 0, "x": 4, "y": 4, "transparent": 0 } ]
 *   }
 *
 * usage: node tools/renderscreen.mjs [--edition floppy|cd]
 *          (--file NAME | --script NAME [--resource ID] | --video NAME [--frame N]
 *           | --spec FILE)
 *          [--palette ID] [--palette-file NAME] [--width N] [--height N]
 *          [--x N] [--y N] [--scale N] [--out FILE] [--list]
 */
import '../app/svision/tools/nodeEnv.mjs';   // must come first: the import headers read window.srcVersion
import fs from 'node:fs';
import path from 'node:path';
import { readArchive, fileData, unpack } from './stklib.mjs';
import { ResourceSet, classifyResource, decodeSprite, readPalette } from './assetlib.mjs';
import { readIMD, decodeIMD } from './imdlib.mjs';
import { encodeRGBAPNG } from '../app/svision/tools/retro/png.mjs';

const { VGAPalette } = await import('../app/svision/js/platform/canvas2D/vga/vgaPalette.js');
const { VGAVideoRAM } = await import('../app/svision/js/platform/canvas2D/vga/vgaVideoRAM.js');

// begin code

const EDITIONS = ['floppy', 'cd'];

const args = process.argv.slice(2);
function opt(name, fallback = null) {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : fallback;
}
const num = (name, fallback) => {
  const v = opt(name, null);
  return v === null ? fallback : parseInt(v, 10);
};
const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(here, '..');

const spec = opt('spec', null) ? JSON.parse(fs.readFileSync(path.resolve(root, opt('spec')), 'utf8')) : {};
const edition = opt('edition', spec.edition || 'floppy');
if (!EDITIONS.includes(edition)) {
  throw new Error(`unknown --edition ${edition}, expected ${EDITIONS.join(' or ')}`);
}
const scriptName = opt('script', spec.script || null);
const fileName = opt('file', spec.file || null);
const videoName = opt('video', spec.video?.name || null);
const listOnly = args.includes('--list');
const scale = num('scale', 1);

const srcDir = path.resolve(root, `assets/original/${edition}`);

// ------------------------------------------------------------------ archives

const archives = fs.readdirSync(srcDir)
  .filter(f => ['.STK', '.ITK'].includes(path.extname(f).toUpperCase()))
  .sort()
  .map(name => {
    const buf = fs.readFileSync(path.join(srcDir, name));
    return { buf, files: readArchive(buf) };
  });

const index = new Map();
for (const archive of archives) {
  for (const file of archive.files) index.set(file.name.toUpperCase(), { archive, file });
}
function member(name) {
  const hit = index.get(name.toUpperCase());
  return hit ? unpack(fileData(hit.archive.buf, hit.file), hit.file.compression).data : null;
}

// -------------------------------------------------------------------- screen

const vram = new VGAVideoRAM();
const palette = new VGAPalette();
vram.fill(0);

/** A decoded sprite as a video memory of its own, so `blit` can place it. */
function spriteRAM(resource) {
  const { pixels } = decodeSprite(resource.data, resource.width, resource.height);
  return new VGAVideoRAM(pixels, resource.width, resource.height);
}

let what;

if (fileName) {
  // A sprite the archive holds as a file of its own, with a palette that is
  // also a file of its own: that is how the game paints its first screen,
  // before a single script has run (`sources/reference/gob/init.cpp`).
  const data = member(fileName);
  if (!data) throw new Error(`no file ${fileName} in the ${edition} edition`);

  const paletteFile = opt('palette-file', spec.paletteFile || null);
  if (paletteFile) {
    const paletteData = member(paletteFile);
    if (!paletteData) throw new Error(`no file ${paletteFile} in the ${edition} edition`);
    palette.load(readPalette(paletteData).components);
  } else {
    palette.load(VGAPalette.defaultPalette().bytes);
  }

  const width = num('width', spec.width ?? VGAVideoRAM.WIDTH);
  const height = num('height', spec.height ?? VGAVideoRAM.HEIGHT);
  vram.blit(spriteRAM({ data, width, height }), num('x', spec.x ?? 0), num('y', spec.y ?? 0));
  what = `${fileName} (${width}x${height})` + (paletteFile ? `, palette ${paletteFile}` : ', VGA default palette');

} else if (videoName) {
  const buf = member(videoName.toUpperCase().endsWith('.IMD') ? videoName : videoName + '.IMD');
  if (!buf) throw new Error(`no video ${videoName} in the ${edition} edition`);
  const imd = readIMD(buf);
  const wanted = num('frame', spec.video?.frame ?? 0);
  if (wanted >= imd.frameCount) throw new Error(`frame ${wanted} of ${imd.frameCount}`);

  let last = null;
  for (const frame of decodeIMD(buf, imd, { until: wanted + 1 })) last = frame;

  palette.load(last.palette);
  const picture = new VGAVideoRAM(Buffer.from(last.surface), imd.width, imd.height);
  vram.blit(picture, num('x', spec.video?.x ?? imd.defaultX), num('y', spec.video?.y ?? imd.defaultY));
  what = `${videoName} frame ${wanted} (${imd.width}x${imd.height} at ${imd.defaultX},${imd.defaultY})`;

} else if (scriptName) {
  const base = path.parse(scriptName).name.toUpperCase();
  const tot = member(base + '.TOT');
  if (!tot) throw new Error(`no script ${base}.TOT in the ${edition} edition`);

  const set = new ResourceSet({ name: base, tot, ext: member(base + '.EXT'), texts: member(base + '.ANG') });
  set.ex = member(`COMMUN.EX${set.props.exFileNumber}`);

  const all = [];
  for (let i = 0; i < (set.totTable?.itemsCount || 0); i++) { const r = set.totResource(i); if (r) all.push(r); }
  for (let i = 0; i < (set.extTable?.itemsCount || 0); i++) { const r = set.extResource(i); if (r) all.push(r); }
  const kindOf = new Map(all.map(r => [r.id, classifyResource(r).kind]));

  if (listOnly) {
    for (const r of all) {
      const { kind, note } = classifyResource(r);
      console.log(`  ${String(r.id).padStart(5)} ${r.from.padEnd(4)} ${kind.padEnd(8)} ${note}`);
    }
    process.exit(0);
  }

  // The palette: the one asked for, the spec's, or the script's only one.
  const palettes = all.filter(r => kindOf.get(r.id) === 'palette');
  const paletteId = num('palette', spec.palette ?? (palettes.length ? palettes[0].id : null));
  if (paletteId !== null && paletteId !== undefined) {
    const resource = set.resource(paletteId);
    if (!resource) throw new Error(`no resource ${paletteId} in ${base}`);
    palette.load(readPalette(resource.data).components);
  } else {
    palette.load(VGAPalette.defaultPalette().bytes);
  }

  // The background: the one asked for, the spec's, or the largest sprite.
  const sprites = all.filter(r => kindOf.get(r.id) === 'sprite');
  const backgroundId = num('resource', spec.background ??
    (sprites.length ? sprites.reduce((a, b) => (a.width * a.height >= b.width * b.height ? a : b)).id : null));
  if (backgroundId === null || backgroundId === undefined) {
    throw new Error(`${base} has no sprite to render — try --list`);
  }
  const background = set.resource(backgroundId);
  if (!background) throw new Error(`no resource ${backgroundId} in ${base}`);
  vram.blit(spriteRAM(background), num('x', 0), num('y', 0));

  for (const layer of spec.layers || []) {
    const resource = set.resource(layer.resource);
    if (!resource) throw new Error(`no resource ${layer.resource} in ${base}`);
    vram.blit(spriteRAM(resource), layer.x || 0, layer.y || 0,
              { transparent: layer.transparent === undefined ? -1 : layer.transparent });
  }

  what = `${base} resource ${backgroundId} (${background.width}x${background.height})` +
         `, palette ${paletteId ?? 'VGA default'}` +
         ((spec.layers || []).length ? `, ${spec.layers.length} layers` : '');

} else {
  throw new Error('nothing to render — give --file, --script, --video or --spec');
}

const rgba = new Uint8Array(VGAVideoRAM.BYTES * 4);
vram.paint(rgba, palette);

const name = spec.name ||
  (fileName ? path.parse(fileName).name :
   videoName ? `${videoName}-${num('frame', 0)}` : path.parse(scriptName).name);
const out = path.resolve(root, opt('out', `data/${edition}/screens/${name}.png`));
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, encodeRGBAPNG(VGAVideoRAM.WIDTH, VGAVideoRAM.HEIGHT, rgba, scale));

console.log(`${what}`);
console.log(`320x200${scale > 1 ? ` x${scale}` : ''} -> ${path.relative(root, out)}`);
