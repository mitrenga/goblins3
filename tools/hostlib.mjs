/**
 * hostlib — the host the offline tools give the interpreter.
 *
 * The interpreter hands everything it does not do itself to a host: where a
 * resource's bytes are, what time it is, whether a key was pressed, what to do
 * with a sound. `tools/runtot.mjs` and `tools/rendertot.mjs` both need one and
 * they need the **same** one — two hosts that answer differently are two
 * different games, and then the two tools' numbers stop being about the same
 * thing.
 *
 * This host reads out of the archives and answers everything else plainly. It
 * is deliberately **deterministic**: the clock is a counter, the mouse never
 * moves and no key is ever pressed, so two runs give the same trace and the
 * fingerprint means something (R-009, `../METHODOLOGY.md`).
 *
 * @module tools/hostlib
 */
import { textItem } from './assetlib.mjs';

// begin code

/**
 * Builds a host for one script.
 *
 * @param {object} options
 * @param {{member: Function}} options.archives from `totlib.openEdition`
 * @param {object} options.script from `totlib.openScript`
 * @param {number} [options.waitLimit] how many times the script may ask for a
 *   key before the run is called idle and stopped; a headless run has no
 *   player, so a script waiting for one would otherwise never end
 * @param {Function} [options.onCommand] called before every command
 * @param {Function} [options.onEffect] called for everything the interpreter
 *   does not do itself
 * @returns {object} the host, plus `stats` it fills in as it goes
 */
export function archiveHost({ archives, script, waitLimit = 2000, onCommand = null, onEffect = null }) {
  /** A counter, not a clock: the same run has to give the same answers. */
  let tick = 0;
  let idleAsks = 0;
  /** @type {Map<string, number>} what the script asked the host for */
  const wanted = new Map();
  /** @type {object[]} every sound the run would have made, in order */
  const sounds = [];

  const host = {
    command(vm, command) {
      tick++;
      onCommand?.(vm, command);
    },

    effect(vm, effect) {
      if (effect.name) wanted.set(effect.name, (wanted.get(effect.name) ?? 0) + 1);
      onEffect?.(vm, effect);
    },

    /** A headless run has no player, so the interpreter stops at a hotspot block. */
    hotspots: null,

    /**
     * A sprite resource's bytes and the size the script's own table gives it.
     *
     * The size is not in the resource: the engine takes it from the table
     * too, which is why a sprite cannot be decoded without the script it
     * belongs to.
     */
    spriteResource(id) {
      const resource = script.set.resource(id);
      if (!resource || !resource.width || !resource.height) return null;
      return { data: resource.data, width: resource.width, height: resource.height };
    },

    /** A palette resource: 256 registers of six-bit red, green and blue. */
    paletteResource(id) {
      const resource = script.set.resource(id);
      if (!resource || resource.data.length < 768) return null;
      return new Uint8Array(resource.data.subarray(0, 768));
    },

    /**
     * A resource's raw bytes.
     *
     * `loadMult` and `loadMapObjects` take their counts out of a resource
     * rather than out of the bytecode, so without this they cannot even be
     * read past.
     */
    resource: (id) => script.resources(id),

    /**
     * A file out of the archives.
     *
     * Two callers with two shapes: `loadFont` wants the whole file and asks
     * with the name alone, `readData` wants a slice and says how much from
     * where. A negative offset counts back from the end, as the engine's own
     * seek does.
     */
    fileData(file, size, offset = 0) {
      const data = archives.member(file);
      if (!data) return null;
      if (size === undefined) return data;
      const from = offset < 0 ? data.length + offset + 1 : offset;
      return data.subarray(from, from + size);
    },

    fileSize: (file) => archives.member(file)?.length ?? -1,

    /** Nothing writes: a tool must not change the operator's data. */
    writeFile: () => false,

    /**
     * One part of a text item.
     *
     * The parts of a dialogue line are separated by a backslash; asking past
     * the last one gives the whole item, which is what the engine does with a
     * text it cannot split.
     */
    totTextItemPart(item, part) {
      const table = script.set.texts;
      if (!table) return '';
      const text = textItem(table, item);
      if (!text) return '';
      const parts = text.toString('latin1').split('\\');
      return parts[part] ?? parts[0] ?? '';
    },

    /** The whole text table, which `printTotText` reads as one piece. */
    texts: () => script.set.texts,

    now: () => tick,
    date: () => ({ year: 1993, month: 1, weekday: 5, day: 1, hour: 12, minute: 0, second: 0 }),
    mouse: () => ({ x: 0, y: 0, buttons: 0 }),

    /**
     * No key, ever — and after enough asking, the run is stopped.
     *
     * The original's idle loop asks for a key, animates a little and asks
     * again. With no player that never ends, so it is recognised and stopped
     * rather than left to run into the step bound, which would say nothing
     * about where the script got to.
     */
    key(vm) {
      if (++idleAsks >= waitLimit) {
        vm.stopReason = 'waiting';
        vm.quit = true;
      }
      return 0;
    },

    /**
     * No sound comes out, but what would have is counted.
     *
     * Saying "nothing is playing" is not laziness: a script that waits for a
     * sound to finish would wait for ever on a yes, and a headless run has
     * nothing to finish.
     */
    soundPlaying: () => false,

    playSample(vm, request) {
      sounds.push({ kind: 'sample', slot: request.slot, rate: request.rate,
        own: request.own, length: request.samples ? request.samples.length : 0,
        repeat: request.repeat });
    },
    stopSample() { sounds.push({ kind: 'stop' }); },
    playMusic(vm, request) {
      sounds.push({ kind: 'music', slot: request.slot,
        bytes: request.data ? request.data.length : 0, repeat: request.repeat });
    },
    stopMusic() { sounds.push({ kind: 'stopMusic' }); },
    speakerOn(vm, request) { sounds.push({ kind: 'speaker', frequency: request.frequency }); },
    speakerOff() {},

    totSub: () => {},
    switchTotSub: () => {},

    /** What the script asked for that the engine does not do yet. */
    get wanted() { return wanted; },
    /** Every sound the run would have made, in order. */
    get sounds() { return sounds; },
    /** The virtual clock, for a caller that wants to report it. */
    get tick() { return tick; },
  };

  return host;
}

/** The commonest things a script asked the host for, as a readable line. */
export function summariseWanted(wanted, limit = 6) {
  return [...wanted]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => `${name} ${count}x`)
    .join(', ');
}
