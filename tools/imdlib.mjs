/**
 * imdlib — the tools' side of the IMD video container.
 *
 * The format itself is **not** here. It moved into `app/coktel/js/imd.js` at
 * G4, for the same reason the archive and the sprites did: the game plays
 * these videos in a browser, out of the original archives, and a decoder the
 * tools kept to themselves would make the tools' numbers say nothing about
 * the game (`../CLAUDE.md`).
 *
 * What is left here is the wrapper: `Buffer` in, `Buffer` out, because the
 * tools write files and the engine may not know what a `Buffer` is.
 *
 * @module tools/imdlib
 */
import '../app/svision/tools/nodeEnv.mjs';

const imd = await import('../app/coktel/js/imd.js');

// begin code

export const FEATURES = imd.FEATURES;

/** A `Uint8Array` as a `Buffer` over the same bytes — no copy. */
function asBuffer(array) {
  return Buffer.from(array.buffer, array.byteOffset, array.length);
}

/**
 * Reads everything in front of the first frame.
 *
 * @param {Buffer} buf the whole IMD
 * @returns {object} the header, the palette (6-bit components), the frame
 *   position and coordinate tables, and the sound properties
 */
export function readIMD(buf) {
  const out = imd.readIMD(buf);
  out.palette = asBuffer(out.palette);
  return out;
}

/**
 * Walks the frames, painting each one onto the surface the one before left.
 *
 * @param {Buffer} buf the whole IMD
 * @param {object} header from {@link readIMD}
 * @param {{until?: number}} [opts] stop after this many frames
 * @yields {{surface: Uint8Array, palette: Buffer, frame: number,
 *           paletteChanged: boolean, rect: object|null, sound: Buffer[]}}
 *   the surface is the same buffer painted further — copy it if every frame
 *   is wanted separately
 */
export function* decodeIMD(buf, header, opts = {}) {
  for (const frame of imd.decodeIMD(buf, header, opts)) {
    yield { ...frame, palette: asBuffer(frame.palette), sound: frame.sound.map(asBuffer) };
  }
}
