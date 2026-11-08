#!/usr/bin/env node
/**
 * rendertot — runs a script and photographs the screen it drew.
 *
 * `runtot.mjs` runs the scripts and checks where the run lands.
 * This runs them for the **picture**: the drawing engine in `app/coktel` is
 * given the archives' sprites, palettes and fonts, the script is let go until
 * it waits for the player, and what the screen holds at that moment is
 * written out as a PNG.
 *
 * That makes the drawing side measurable the same way the rest is. A PNG here
 * and a screenshot of the original in DOSBox are both 320x200 indexed
 * pictures, and `tools/matchscreen.mjs` compares them pixel for pixel — the
 * six-bit components of the VGA DAC are scaled to eight the same way in both
 * (`VGAPalette`), so a screen that is right matches exactly and there is no
 * tolerance to set.
 *
 * ## What it can and cannot draw yet
 *
 * It draws what the **scripts** draw: sprites, filled rectangles, lines,
 * text through the game's own fonts, the palette they load. It does not draw
 * what the engine animates on its own — the cursor, `mult` animations,
 * scenery layers and videos — because those are separate machinery and are
 * still handed to the host untouched. The tool says how many commands went
 * that way, so the picture is never presented as more finished than it is.
 *
 * usage: node tools/rendertot.mjs [--edition floppy|cd] [--script NAME]
 *                                 [--steps N] [--wait N] [--seed N]
 *                                 [--out DIR] [--quiet]
 */
import '../app/svision/tools/nodeEnv.mjs';   // must come first: the import headers read window.srcVersion
import fs from 'node:fs';
import path from 'node:path';
import { openEdition, openScript, scriptNames } from './totlib.mjs';
import { archiveHost, summariseWanted } from './hostlib.mjs';
import { encodeIndexedPNG } from '../app/svision/tools/retro/png.mjs';

const { VGAPalette } = await import('../app/svision/js/platform/canvas2D/vga/vgaPalette.js');
const { Interpreter } = await import('../app/coktel/js/interpreter.js');
const { Surface } = await import('../app/coktel/js/surface.js');
const { seededRandom } = await import('../app/coktel/js/walker.js');

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
const waitLimit = Number(opt('wait', '2000'));
const seed = Number(opt('seed', '0xC0C7E1'));
const quiet = args.includes('--quiet');
const outDir = path.resolve(root, opt('out', `data/${edition}/screens/scripts`));

const archives = openEdition(root, edition);
const names = scriptNames(archives)
  .filter((n) => !onlyScript || path.parse(n).name === onlyScript.toUpperCase().replace(/\.TOT$/, ''));
if (!names.length) throw new Error(`the ${edition} edition has no such script`);

/** The DAC's six-bit components as the 0..255 a PNG's palette wants. */
function paletteToRGB(components) {
  const rgb = Buffer.alloc(768);
  for (let i = 0; i < 768; i++) rgb[i] = VGAPalette.to8bit(components[i]);
  return rgb;
}

fs.mkdirSync(outDir, { recursive: true });
const manifest = { tool: 'tools/rendertot.mjs', edition, seed, screens: [] };
let drawn = 0, handed = 0;

for (const name of names) {
  const script = openScript(archives, name);

  const host = archiveHost({ archives, script, waitLimit });

  const vm = new Interpreter({
    data: script.data, host, version: 'v3', random: seededRandom(seed), maxSteps,
  });
  const result = vm.run();

  // The engine pushes a frame to the front surface at every `keyFunc`; a
  // script that stopped before one has its picture only on the back, so the
  // last frame is forced out before the photograph is taken.
  vm.draw.forceBlit();
  const screen = new Surface(vm.draw.screenWidth, vm.draw.screenHeight);
  vm.draw.composeScreen(screen);

  const file = path.join(outDir, `${script.name}.png`);
  fs.writeFileSync(file, encodeIndexedPNG(screen.width, screen.height,
    Buffer.from(screen.pixels), paletteToRGB(vm.draw.palette)));

  // How much of the picture is not the background — a screen that stayed
  // blank says the script never got as far as drawing anything.
  let painted = 0;
  for (const pixel of screen.pixels) if (pixel !== 0) painted++;
  const coverage = (100 * painted / screen.pixels.length).toFixed(1);

  drawn += vm.draw.operations;
  handed += [...host.wanted.values()].reduce((a, b) => a + b, 0);

  manifest.screens.push({
    name: script.name,
    stopped: result.reason,
    steps: result.steps,
    drawOperations: vm.draw.operations,
    surface: `${vm.draw.width}x${vm.draw.height}`,
    split: vm.draw.splitHeight,
    painted: Number(coverage),
    handedToHost: Object.fromEntries([...host.wanted].sort((a, b) => b[1] - a[1]).slice(0, 6)),
  });

  if (!quiet) {
    console.log(`${script.name.padEnd(9)} ${String(vm.draw.operations).padStart(6)} draw ops` +
      `  surface ${`${vm.draw.width}x${vm.draw.height}`.padEnd(8)}` +
      ` ${coverage.padStart(5)}% painted  stopped: ${result.reason}` +
      (result.error ? `  ${result.error}` : '') +
      (host.wanted.size ? `\n           host: ${summariseWanted(host.wanted)}` : ''));
  }
}

fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
console.log(`\n${names.length} screens -> ${path.relative(root, outDir)}`);
console.log(`${drawn} drawing operations done, ${handed} commands handed to the host untouched`);
console.log('(compare with the original: tools/matchscreen.mjs, once there are screenshots)');
