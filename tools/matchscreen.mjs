#!/usr/bin/env node
/**
 * matchscreen — the acceptance check for G2 (`../MILNIKY.md`).
 *
 * Compares what `tools/renderscreen.mjs` painted with the golden record: a
 * screenshot taken from the original running in DOSBox. Both are 320x200
 * RGBA by the time they are compared, and the milestone is accepted when the
 * count of differing pixels is zero.
 *
 * The 6-bit components of the VGA DAC are scaled to 8 bits the same way here
 * and in DOSBox (`VGAPalette`, `(v << 2) | (v >> 4)`), so a screen that is
 * right matches byte for byte and there is no tolerance to set.
 *
 * Golden screenshots live in `sources/media/screens/<edition>/` and are
 * matched to the rendered ones by file name. **Without them nothing is
 * proved**, so an empty golden directory is an error (exit code 2), never a
 * pass.
 *
 * usage: node tools/matchscreen.mjs [--edition floppy|cd] [--golden DIR|FILE]
 *                                   [--screens DIR|FILE] [--diff DIR] [--quiet]
 * exit code 0 = no differences, 1 = differences, 2 = nothing to compare
 */
import '../app/svision/tools/nodeEnv.mjs';   // must come first: the import headers read window.srcVersion
import fs from 'node:fs';
import path from 'node:path';
import { decodePNG, encodeRGBAPNG } from '../app/svision/tools/retro/png.mjs';

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
const quiet = args.includes('--quiet');
if (!EDITIONS.includes(edition)) {
  throw new Error(`unknown --edition ${edition}, expected ${EDITIONS.join(' or ')}`);
}

const goldenPath = path.resolve(root, opt('golden', `sources/media/screens/${edition}`));
const screensPath = path.resolve(root, opt('screens', `data/${edition}/screens`));
const diffDir = path.resolve(root, opt('diff', `data/${edition}/screens/diff`));

/** The PNGs of a directory, or the single file itself. */
function pngs(at) {
  if (!fs.existsSync(at)) return [];
  if (fs.statSync(at).isFile()) return [at];
  return fs.readdirSync(at)
    .filter(f => f.toLowerCase().endsWith('.png'))
    .sort()
    .map(f => path.join(at, f));
}

const golden = pngs(goldenPath);
if (!golden.length) {
  console.log(`no golden screenshots in ${path.relative(root, goldenPath)}`);
  console.log('G2 cannot be accepted without them: take the screens in DOSBox from the');
  console.log('original, save them as 320x200 PNG named after the rendered screens, and');
  console.log('note where they came from in sources/README.md.');
  process.exit(2);
}

const screensIsFile = fs.existsSync(screensPath) && fs.statSync(screensPath).isFile();

let checked = 0, failed = 0, totalPixels = 0, totalDiff = 0;

for (const goldenFile of golden) {
  const name = path.basename(goldenFile);
  const renderedFile = screensIsFile ? screensPath : path.join(screensPath, name);

  if (!fs.existsSync(renderedFile)) {
    console.log(`  ${name.padEnd(24)} MISSING  ${path.relative(root, renderedFile)} — run tools/renderscreen.mjs`);
    failed++; checked++;
    continue;
  }

  const a = decodePNG(fs.readFileSync(goldenFile));
  const b = decodePNG(fs.readFileSync(renderedFile));
  checked++;

  if (a.width !== b.width || a.height !== b.height) {
    console.log(`  ${name.padEnd(24)} SIZE     golden ${a.width}x${a.height}, rendered ${b.width}x${b.height}`);
    failed++;
    continue;
  }

  // One pixel differs when any of its four bytes does; the diff image paints
  // the ones that match in grey and the ones that do not in red, which is
  // enough to see whether a screen is wrong everywhere or in one corner.
  const pixels = a.width * a.height;
  const diff = new Uint8Array(pixels * 4);
  let differing = 0;
  let firstAt = -1;
  for (let i = 0; i < pixels; i++) {
    const o = i * 4;
    const same = a.rgba[o] === b.rgba[o] && a.rgba[o + 1] === b.rgba[o + 1] &&
                 a.rgba[o + 2] === b.rgba[o + 2] && a.rgba[o + 3] === b.rgba[o + 3];
    if (same) {
      const grey = (a.rgba[o] * 3 + a.rgba[o + 1] * 6 + a.rgba[o + 2]) / 10 / 3 + 40;
      diff[o] = diff[o + 1] = diff[o + 2] = grey;
    } else {
      diff[o] = 255;
      if (firstAt < 0) firstAt = i;
      differing++;
    }
    diff[o + 3] = 255;
  }

  totalPixels += pixels;
  totalDiff += differing;

  if (differing) {
    fs.mkdirSync(diffDir, { recursive: true });
    const diffFile = path.join(diffDir, name);
    fs.writeFileSync(diffFile, encodeRGBAPNG(a.width, a.height, diff));
    console.log(`  ${name.padEnd(24)} ${String(differing).padStart(6)} of ${pixels} pixels differ, ` +
                `first at ${firstAt % a.width},${Math.floor(firstAt / a.width)} -> ${path.relative(root, diffFile)}`);
    failed++;
  } else if (!quiet) {
    console.log(`  ${name.padEnd(24)} ok       ${pixels} pixels`);
  }
}

console.log(`\n${checked} screens, ${totalPixels} pixels compared`);
if (failed) {
  console.log(`${failed} of ${checked} differ, ${totalDiff} pixels`);
  process.exit(1);
}
console.log('0 differences');
