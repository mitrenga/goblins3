const { ArchiveSet } = await import('./coktel/js/archive.js?ver='+window.srcVersion);
// begin code

/**
 * The game's own archives, fetched once and shared by every model.
 *
 * They are the operator's files and they are not small — the floppy edition
 * is about eight megabytes across four archives — so they are loaded once,
 * during the title screen, and whoever needs them afterwards is handed the
 * same {@link ArchiveSet}. The boot showing a picture while they arrive is
 * not decoration: it is the only thing there is to look at while they do.
 */

/** Where the archives of the edition being worked on are served from. */
export const EDITION = 'assets/original/floppy';

/** The archives, in the order the engine opens them; later wins. */
export const ARCHIVES = ['INTRO.STK', 'TOT.STK', 'EXT.STK', 'IMD.ITK'];

/**
 * Waits until something that was put on the screen has been up long enough.
 *
 * Not a throttle and not a fake: it is how long a picture has to stay up to
 * be seen at all. The archives are fetched at whatever speed they come, but
 * the pictures on the way into the game are drawn and then painted straight
 * over, and without a floor under them the player gets a flash of a frame or
 * two. The floor is counted from the moment the step began, so anything that
 * genuinely takes longer is not delayed at all.
 *
 * @param {number} startedAt - `Date.now()` when the step began.
 * @param {number} minimum - How long it has to last, in milliseconds.
 * @returns {Promise} Resolved once the floor has passed; at once if it has.
 */
export function holdStep(startedAt, minimum) {
  var remaining = minimum-(Date.now()-startedAt);
  if (remaining <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, remaining));
} // holdStep

/**
 * Fetches every archive and indexes them.
 *
 * @param {Function} [onProgress] - Called with a line to show, before each
 *   step, so that something on the screen says which file is on its way.
 * @returns {Promise<ArchiveSet>} The archives, ready to be read.
 * @throws {Error} Named for the archive that failed — a checkout without the
 *   operator's data has to say so rather than fail somewhere less obvious.
 */
export async function loadArchives(onProgress) {
  var set = new ArchiveSet();

  for (var i = 0; i < ARCHIVES.length; i++) {
    var name = ARCHIVES[i];
    // Named one at a time, so a fetch that never comes back says which.
    if (onProgress) {
      await onProgress('loading '+name+' ('+(i+1)+'/'+ARCHIVES.length+')');
    }

    var response = await fetch(EDITION+'/'+name);
    if (!response.ok) {
      throw new Error(name+' '+response.status+' '+response.statusText);
    }
    var bytes = new Uint8Array(await response.arrayBuffer());

    // A front controller that answers every path with the page would hand
    // back HTML with a 200; the archive reader would then fail somewhere
    // less obvious, so it is named here.
    if (bytes.length > 0 && (bytes[0] === 0x3C || bytes[0] === 0xEF)) {
      throw new Error(name+' is not an archive (the server sent a page)');
    }

    if (onProgress) {
      await onProgress('reading '+name+' ('+Math.round(bytes.length/1024)+' kB)');
    }
    set.add(bytes);
  }

  return set;
} // loadArchives
