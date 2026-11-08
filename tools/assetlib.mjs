/**
 * assetlib — what sits inside a TOT script: resources, sprites, palettes,
 * samples and texts.
 *
 * Shared by `tools/dumpassets.mjs`, `tools/renderscreen.mjs` and
 * `tools/matchscreen.mjs`. Pure Node, no DOM, no state.
 *
 * A screen of the game is one `.TOT` script plus the files around it:
 *
 *   `<NAME>.TOT`   the script, its own resource table and (sometimes) texts
 *   `<NAME>.EXT`   the resources too big to live in the script
 *   `COMMUN.EX<n>` the resources every script shares
 *   `COMMUN.IM<n>` images shared the same way (Goblins 3 has none, see below)
 *   `<NAME>.ANG`   the texts, in the language the file's extension names
 *
 * A script asks for a resource by number: below 30000 it is its own, from
 * 30000 up it is the EXT one, counted from 30000. That numbering is the
 * engine's (`sources/reference/gob/resources.cpp`), read and rewritten here.
 *
 * ## What is *not* here
 *
 * Scenery (the layered backgrounds) and Mult (the animated scenes) are not
 * self-describing files in Goblins 3. `Scenery::loadStatic` reads the layer
 * table out of a resource but takes the picture list, the sizes and the
 * sprite numbers **out of the script stream** it is being called from, so
 * neither can be dumped without running the script. They belong to G3, with
 * the interpreter; standalone `.ANI` / `.MUL` files are a later engine
 * (v4 and up) and Goblins 3 has none.
 */
import { unpack } from './stklib.mjs';

const { decodeSprite: decodeSpriteRaw, decodeRLE16: decodeRLE16Raw } =
  await import('../app/coktel/js/sprite.js');
const engineResources = await import('../app/coktel/js/resources.js');
const { TOTScript } = await import('../app/coktel/js/totScript.js');
const snd_ = await import('../app/coktel/js/snd.js');

// begin code

/** The fixed header every TOT starts with. */
export const TOT_HEADER_SIZE = 128;
/** Resource numbers from here up mean the EXT file, counted from here. */
export const EXT_RESOURCE_BASE = 30000;

/**
 * Reads the 128-byte header of a TOT script.
 *
 * `scriptEnd` is not a field — the engine works it out as the first of the
 * two tables, which is where the bytecode has to stop.
 *
 * @param {Buffer} buf the whole TOT
 * @returns {object} the header fields plus `scriptEnd`, `textsSize`,
 *   `resourcesSize`
 */
export function readTOTProperties(buf) {
  return new TOTScript(buf).properties;
}

/**
 * Reads the resource table the TOT carries itself.
 *
 * A negative offset means the resource is not in the TOT at all but in the
 * `COMMUN.IM<n>` file, and what the field holds is its index there.
 *
 * @param {Buffer} buf the whole TOT
 * @param {object} props from {@link readTOTProperties}
 * @returns {{items: object[], dataOffset: number}|null} null when the script
 *   has no resources of its own
 */
export function readTOTResourceTable(buf, props) {
  return engineResources.readTOTResourceTable(buf, props);
}

/**
 * Reads the resource table at the head of an `.EXT` / `.EX<n>` file.
 *
 * Two oddities of the format, both the engine's: the top bit of `width`
 * says the resource is LZ-packed, and because `size` is only 16 bits the
 * bits below it carry the size's high bits — or, when `height` is zero,
 * `width` *is* the high half of the size.
 *
 * @param {Buffer} buf the whole EXT file
 * @returns {{itemsCount: number, items: object[]}}
 */
export function readEXTResourceTable(buf) {
  return engineResources.readEXTResourceTable(buf);
}

/**
 * Reads the text table — either the one inside the TOT, or the separate
 * language file the TOT points at by having `textsOffset == 0`.
 *
 * @param {Buffer} data the table's bytes
 * @returns {{itemsCount: number, items: {offset: number, size: number}[], data: Buffer}}
 */
export function readTextTable(data) {
  return engineResources.readTextTable(data);
}

/**
 * The bytes of one text item, or null when the slot is empty.
 *
 * @param {object} table from {@link readTextTable}
 * @param {number} id which item
 * @returns {Buffer|null}
 */
export function textItem(table, id) {
  const out = engineResources.textItem(table, id);
  return out ? Buffer.from(out.buffer, out.byteOffset, out.length) : null;
}

/**
 * Everything one script can reach: its own resources, its EXT, the shared
 * `COMMUN.EX<n>` and `COMMUN.IM<n>`, and its texts.
 *
 * Built by the caller out of buffers it has already unpacked from the
 * archives, so that this stays free of any file system.
 */
export class ResourceSet extends engineResources.ResourceSet {

  /**
   * One resource, with its bytes as a Buffer.
   *
   * The engine hands back a `Uint8Array`; the tools here read with a Buffer's
   * own accessors, so it is wrapped over the same memory rather than copied.
   */
  resource(id) {
    const out = super.resource(id);
    if (!out) return null;
    return { ...out, data: Buffer.from(out.data.buffer, out.data.byteOffset, out.data.length) };
  }

}

/**
 * The sprite decoders, which live with the engine.
 *
 * Both formats are `app/coktel/js/sprite.js` (R-030): what a sprite looks
 * like inside is the interpreter's business, shared by all three parts, and
 * only *finding* the resource is this file's. They are re-exported here so
 * the tools that were written against them keep reading the same.
 *
 * They return a `Uint8Array`; the callers here want a Buffer's accessors, so
 * the result is wrapped over the same memory rather than copied.
 */
export function decodeSprite(data, width, height) {
  const out = decodeSpriteRaw(data, width, height);
  return { pixels: asBuffer(out.pixels), form: out.form };
}

/** The 16-colour run-length form, as a Buffer. See {@link decodeSprite}. */
export function decodeRLE16(data, width, height) {
  const out = decodeRLE16Raw(data, width, height);
  return { pixels: asBuffer(out.pixels), form: out.form };
}

/** A Uint8Array as a Buffer over the same bytes. */
function asBuffer(array) {
  return Buffer.from(array.buffer, array.byteOffset, array.length);
}

/** A resource is a palette when it is exactly 256 registers of 6-bit r, g, b. */
export const PALETTE_BYTES = 768;

/**
 * Reads a palette resource.
 *
 * The components are the DAC's own 0..63, which is what the JSON keeps; the
 * 0..255 a screenshot holds is what `VGAPalette` makes of them.
 *
 * @param {Buffer} data 768 bytes
 * @returns {{components: number[], overRange: number}} `overRange` counts
 *   components above 63, which a palette should not have
 */
export function readPalette(data) {
  if (data.length !== PALETTE_BYTES) throw new Error(`palette is ${data.length} bytes, expected ${PALETTE_BYTES}`);
  const components = Array.from(data);
  return { components, overRange: components.filter(v => v > 63).length };
}

/**
 * Reads a SND sample.
 *
 * The format itself moved into `app/coktel/js/snd.js` at G5, for the same
 * reason the archive and the sprites did: the game plays these in a browser,
 * out of the original archives. What is left here is the `Buffer` wrapper.
 *
 * Six bytes of header: the length in the low 24 bits of a big-endian `u32`
 * whose top byte is a flag, then the frequency, also big-endian, which the
 * engine floors at 4700 Hz. The samples themselves are unsigned 8-bit.
 *
 * @param {Buffer} data the resource
 * @returns {{rate: number, flag: number, samples: Buffer, declaredSize: number}}
 */
export function readSND(data) {
  const snd = snd_.readSND(data);
  return { ...snd, samples: asBuffer(snd.samples) };
}

/** True when the bytes look like a SND: the length field matches what is there. */
export function looksLikeSND(data) {
  return snd_.looksLikeSND(data);
}

/**
 * Names what a resource is, from the table entry and then the bytes.
 *
 * The script is what really decides; these are the signals that hold without
 * it, and anything they do not cover is reported as `unknown` rather than
 * guessed at.
 *
 * @param {{data: Buffer, width: number, height: number}} resource
 * @returns {{kind: string, note: string|null}}
 */
export function classifyResource(resource) {
  const { data, width, height } = resource;

  if (width > 0 && height > 0) {
    if (data[0] === 1 && data[1] === 2) {
      const form = data[2] === 2 ? 'plain' : data[2] === 1 ? 'packed' : `form ${data[2]}`;
      return { kind: 'sprite', note: `${width}x${height}, ${form}` };
    }
    // No 256-colour header: the older 16-colour run-length form, which has
    // no header at all and is recognised by decoding cleanly.
    try {
      decodeRLE16(data, width, height);
      return { kind: 'sprite', note: `${width}x${height}, 16-colour run length` };
    } catch (e) {
      return { kind: 'unknown', note: `${width}x${height}, no sprite header (${e.message})` };
    }
  }
  if (data.length === PALETTE_BYTES) {
    const over = readPalette(data).overRange;
    return { kind: 'palette', note: over ? `${over} components above 63` : '256 x 6-bit r, g, b' };
  }
  if (looksLikeSND(data)) {
    const snd = readSND(data);
    return { kind: 'sample', note: `${snd.samples.length} samples @ ${snd.rate} Hz` };
  }
  return { kind: 'unknown', note: `${data.length} bytes` };
}
