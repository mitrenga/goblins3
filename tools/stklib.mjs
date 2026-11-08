/**
 * stklib — the Coktel Vision STK/ITK archive and its LZ codec.
 *
 * Shared by `tools/dumpstk.mjs` and `tools/checkstk.mjs`. Pure Node, no DOM,
 * no state: everything here takes and returns Buffers.
 *
 * The format is described in `../NOTES.md`; the authority behind it is
 * ScummVM's `sources/reference/gob/dataio.cpp`, read and rewritten here,
 * not copied (see `../sources/reference/README.md`).
 *
 * The **reader** of the LZ codec moved to `app/coktel/js/lz.js` (R-030),
 * because the same codec decodes a packed sprite and a frame of a video and
 * those are the engine's, not the archive's. What stays here is the archive
 * format and the packer, which exists only to prove the reader by round-trip.
 *
 * Archive layout, little-endian:
 *
 *   u16 fileCount
 *   fileCount x { char name[13]; u32 size; u32 offset; u8 compression }
 *   ... the file bodies, at their own offsets ...
 *
 * `size` is what the archive holds, so for a packed file it is the *packed*
 * size. `compression` is 0 for stored, 1 for one LZ stream, 2 for a sequence
 * of LZ chunks. ScummVM folds every non-zero byte to 1 and only ever sets 2
 * itself, for Geisha's `.0OT` files; no Goblins 3 archive uses 2 (see the
 * table in `../MILNIKY.md`), but it is implemented because `NOTES.md` claims
 * the ITK archives of parts 2 and 3 may carry it.
 */

const { unpackLZ } = await import('../app/coktel/js/lz.js');
const archive = await import('../app/coktel/js/archive.js');

// begin code

/** The sliding window is 4096 bytes and wraps; offsets are 12 bits. */
const WINDOW = 4096;
/** An unpacked window starts prefilled with spaces. */
const SPACE = 0x20;
/** Bytes per entry of the file table: 13 name + 4 size + 4 offset + 1 flag. */
export const ENTRY_SIZE = 22;

/**
 * The longest string each form of the codec can encode.
 *
 * Only the packer needs these now: **reading** a stream is
 * {@link unpackLZ} in `app/coktel/js/lz.js`, because the very same codec
 * decodes a packed sprite and a video frame as well, and those are the
 * engine's business rather than the archive's (R-030). The packer stays here,
 * since nothing in a remake ever packs — it exists to prove the reader by
 * round-trip, and that is a tool's job.
 *
 * A stream that opens with the magic `0x1234 0x5678` uses the extended form:
 * the window is only primed with 273 spaces and `len == 18` means "the next
 * byte plus 18", so strings reach 273 bytes. Everything else is the plain
 * form, which primes 4078 spaces and tops out at 18.
 */
const STANDARD = { index: 4078, escapeLen: -1, maxLen: 18, magic: false };
const EXTENDED = { index: 273, escapeLen: 18, maxLen: 273, magic: true };

/**
 * Reads the file table at the head of an STK/ITK archive.
 *
 * Cyrillic editions store a few names in a code page ScummVM patches back to
 * ASCII; ours are English, so the bytes are taken as latin1 and the patch is
 * left out on purpose — if a name ever comes back with a byte above 0x7F,
 * that is a different edition, not a bug here.
 *
 * @param {Buffer} buf the whole archive
 * @returns {{name: string, size: number, offset: number, compression: number}[]}
 */
export function readArchive(buf) {
  return archive.readArchive(buf);
}

/** The raw bytes of one table entry, as they sit in the archive. */
export function fileData(buf, file) {
  return buf.subarray(file.offset, file.offset + file.size);
}

/**
 * Unpacks one LZ stream, as a Buffer.
 *
 * The codec itself is {@link unpackLZ} in `app/coktel/js/lz.js` — the same
 * one decodes a packed sprite and a video frame, so it belongs with the
 * engine rather than with the archive. This only wraps the result in the
 * Buffer the tools downstream read with.
 *
 * @param {Buffer} src the archive
 * @param {number} at where the stream starts
 * @param {number} size how many bytes it unpacks to
 * @returns {{data: Buffer, end: number, extended: boolean}}
 */
export function unpackChunk(src, at, size) {
  const { data, end, extended } = unpackLZ(src, at, size);
  return { data: asBuffer(data), end, extended };
}

/** A Uint8Array as a Buffer over the same bytes — no copy. */
function asBuffer(array) {
  return Buffer.from(array.buffer, array.byteOffset, array.length);
}

/**
 * Unpacks a `compression == 2` body: LZ streams cut into chunks.
 *
 * Each chunk is `u16 chunkSize, u16 realSize, u16 (unused)` followed by its
 * own LZ stream; `chunkSize` counts from just after itself to the next chunk,
 * and `0xFFFF` marks the last one.
 *
 * @param {Buffer} src the archive
 * @param {number} at where the first chunk header starts
 * @returns {{data: Buffer, chunks: number, extended: boolean}}
 */
export function unpackChunks(src, at) {
  const { data, chunks, extended } = archive.unpackChunks(src, at);
  return { data: asBuffer(data), chunks, extended };
}

/**
 * Unpacks one archive member.
 *
 * @param {Buffer} body the bytes the file table points at
 * @param {number} compression the table's flag byte
 * @returns {{data: Buffer, extended: boolean, chunks: number}}
 */
export function unpack(body, compression) {
  const out = archive.unpack(body, compression);
  return { ...out, data: asBuffer(out.data) };
}

/**
 * Packs bytes into a `compression == 1` body — `u32 size` then one LZ stream.
 *
 * This is ours, not the original's: Coktel's own packer chose its strings
 * differently and the packed bytes are not expected to match. What has to
 * match is what comes back out, which is what `tools/checkstk.mjs` proves.
 *
 * The encoder walks the input keeping the very same window the decoder will
 * keep, so a candidate string is scored against the window as the decoder
 * would read it — including the overlap where a string copies bytes this
 * same reference is still writing. Candidates come from a hash chain over
 * the three bytes starting at each window position.
 *
 * @param {Buffer} data the bytes to pack
 * @param {{extended?: boolean, depth?: number}} [opts] `extended` picks the
 *   long-string form, `depth` how many candidates per position to score
 * @returns {Buffer} the body, ready to be stored with compression 1
 */
export function pack(data, { extended = false, depth = 24 } = {}) {
  const form = extended ? EXTENDED : STANDARD;
  const win = new Uint8Array(WINDOW);
  let index = form.index;
  win.fill(SPACE, 0, index);

  /** key of three bytes -> the window positions that start with them */
  const chains = new Map();
  const key = (a, b, c) => (a << 16) | (b << 8) | c;
  const remember = (pos) => {
    const k = key(win[pos], win[(pos + 1) % WINDOW], win[(pos + 2) % WINDOW]);
    let list = chains.get(k);
    if (!list) chains.set(k, list = []);
    list.unshift(pos);
    if (list.length > depth) list.length = depth;
  };
  // The primed spaces are matchable too; every position in the run is
  // equivalent, so remembering them all just keeps the newest `depth`.
  for (let pos = 0; pos + 2 < form.index; pos++) remember(pos);

  const out = [];
  let flags = 0, flagCount = 0, pending = [];
  const flushFlags = () => {
    out.push(flags, ...pending);
    flags = 0; flagCount = 0; pending = [];
  };
  const emit = (isLiteral, bytes) => {
    if (isLiteral) flags |= 1 << flagCount;
    pending.push(...bytes);
    if (++flagCount === 8) flushFlags();
  };
  /** Appends one produced byte to the window the decoder will hold. */
  const advance = (b) => {
    win[index] = b;
    index = (index + 1) % WINDOW;
    remember((index - 3 + WINDOW) % WINDOW);
  };

  let p = 0;
  while (p < data.length) {
    let bestOff = -1, bestLen = 0;
    const limit = Math.min(form.maxLen, data.length - p);

    if (limit >= 3) {
      const candidates = chains.get(key(data[p], data[p + 1], data[p + 2])) || [];
      for (const off of candidates) {
        let len = 0;
        while (len < limit) {
          const q = (off + len) % WINDOW;
          // Positions this very reference has already written hold the bytes
          // we are matching, not what the window held before it started.
          const ahead = (q - index + WINDOW) % WINDOW;
          const b = ahead < len ? data[p + ahead] : win[q];
          if (b !== data[p + len]) break;
          len++;
        }
        if (len > bestLen) { bestLen = len; bestOff = off; }
        if (bestLen === limit) break;
      }
    }

    if (bestLen >= 3) {
      const nibble = bestLen <= 17 ? bestLen - 3 : 0x0F;
      // In the extended form nibble 15 is the escape, so 18 is spelled as
      // "escape, plus 0" rather than directly; in the plain form it is a
      // length like any other.
      const bytes = [bestOff & 0xFF, (((bestOff >> 8) & 0x0F) << 4) | nibble];
      if (extended && nibble === 0x0F) bytes.push(bestLen - 18);
      emit(false, bytes);
      for (let i = 0; i < bestLen; i++) advance(data[p + i]);
      p += bestLen;
    } else {
      emit(true, [data[p]]);
      advance(data[p]);
      p += 1;
    }
  }
  if (flagCount) flushFlags();

  const head = Buffer.alloc(4);
  head.writeUInt32LE(data.length, 0);
  // The two forms are told apart by the magic, not by anything in the file
  // table, so the extended one has to announce itself.
  const magic = extended ? Buffer.from([0x34, 0x12, 0x78, 0x56]) : Buffer.alloc(0);
  return Buffer.concat([head, magic, Buffer.from(out)]);
}

/**
 * Packs bytes into a `compression == 2` body — the same LZ streams, cut into
 * chunks that can be unpacked one at a time.
 *
 * No Goblins 3 archive is stored this way (`../MILNIKY.md`), so this exists
 * to give `tools/checkstk.mjs --chunked` something to prove the chunked
 * reader on until an archive that uses it turns up.
 *
 * @param {Buffer} data the bytes to pack
 * @param {{chunkBytes?: number, extended?: boolean}} [opts]
 * @returns {Buffer} the body, ready to be stored with compression 2
 */
export function packChunks(data, { chunkBytes = 8192, extended = false } = {}) {
  const parts = [];
  for (let at = 0; at < data.length || at === 0; at += chunkBytes) {
    const piece = data.subarray(at, Math.min(at + chunkBytes, data.length));
    // pack() prefixes the unpacked size, which a chunk carries in its own
    // header instead, so the first four bytes go back off.
    const stream = pack(piece, { extended }).subarray(4);
    const last = at + chunkBytes >= data.length;
    const head = Buffer.alloc(6);
    head.writeUInt16LE(last ? 0xFFFF : stream.length + 4, 0);
    head.writeUInt16LE(piece.length, 2);
    parts.push(head, stream);
    if (last) break;
  }
  return Buffer.concat(parts);
}

/**
 * Names what a member is, from its extension and then its first bytes.
 *
 * The extension is the primary signal — the engine itself dispatches on it —
 * and the header check is only there to catch a file that is not what its
 * name says. `header` is null when nothing could be checked; IMD/VMD headers
 * are left alone on purpose, their decoder is G2 and guessing at the fields
 * here would only put a wrong number in the manifest.
 *
 * @param {string} name the 8.3 name out of the file table
 * @param {Buffer} data the *unpacked* bytes
 * @returns {{ext: string, type: string, header: string|null}}
 */
export function classify(name, data) {
  const ext = (name.split('.')[1] || '').toUpperCase();
  const type = TYPES[ext] || (/^(ANG|ALL|ESP|ITA|FRA|ALL|DAT)$/.test(ext) ? 'text' : 'unknown');

  let header = null;
  if (ext === 'TOT') {
    header = (data.length >= 128 && data[40] === 0x2E)
      ? `TOT v${String.fromCharCode(data[39])}.${String.fromCharCode(data[41])}`
      : 'not a 128-byte TOT header';
  } else if (ext === 'CLT') {
    header = data.length === 768 ? 'VGA palette, 256 x 3 six-bit components'
      : `${data.length} bytes, not a 768-byte palette`;
  } else if (ext === 'LET') {
    // video.cpp: width (low 7 bits), height, first and last character, then
    // one bitmap per character, rows padded to whole bytes
    const w = data[0] & 0x7F, h = data[1], first = data[2], last = data[3];
    const expect = 4 + (last - first + 1) * (Math.ceil(w / 8) * h);
    header = `font ${w}x${h}, chars 0x${first.toString(16)}..0x${last.toString(16)}` +
             (expect === data.length ? '' : ` (${data.length} bytes, expected ${expect})`);
  } else if (ext === 'SND') {
    const size = data.length >= 6 ? data.readUInt32BE(0) & 0x00FFFFFF : 0;
    header = `SND ${size} samples @ ${Math.max(data.readUInt16BE(4), 4700)} Hz`;
  }
  return { ext, type, header };
}

/** Extension -> what the engine does with it. Kept next to `classify`. */
const TYPES = {
  TOT: 'script',        // bytecode, 128-byte header, texts and resources
  EXT: 'resources',     // the resources a TOT reaches past its own end
  EX1: 'resources',     // COMMUN.EX1 — the resources shared by every script
  IM: 'image', IM1: 'image', IM2: 'image', IM3: 'image',
  CLT: 'palette',
  LET: 'font',
  GDR: 'videodriver',   // Coktel's own DOS display drivers, not used here
  ADL: 'music',         // AdLib, Coktel's own format
  SND: 'sample',
  ANI: 'animation',
  MUL: 'scene',
  IMD: 'video',
  VMD: 'video',
  IMS: 'imagesound',    // COKTEL.IMS, the logo's sound
  INF: 'index',
};
