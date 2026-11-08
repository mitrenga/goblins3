const { AbstractAudioManager } = await import('./svision/js/audio/abstractAudioManager.js?ver='+window.srcVersion);
const { AudioSampleHandler } = await import('./svision/js/audio/audioSampleHandler.js?ver='+window.srcVersion);
const { PCMSample } = await import('./svision/js/audio/pcmSample.js?ver='+window.srcVersion);
const { toLevels } = await import('./coktel/js/snd.js?ver='+window.srcVersion);
// begin code

/**
 * The game's sound: the samples it plays and the beeper it beeps.
 *
 * Nothing here decides **what** to play — that is the interpreter's, through
 * `app/coktel/js/sound.js`. This is the other side of that seam: it is handed
 * a decoded sample and a rate and puts it out.
 *
 * ## Three buses, because they interrupt each other differently
 *
 * `sfx` is the game's sounds: a new one stops the one before it, which is
 * what a Sound Blaster with one voice did and what the scripts expect.
 * `speaker` is the PC speaker, which in Goblins 3 is only the goblins'
 * footsteps and has to be able to beep while a sound is playing. `music`
 * is the AdLib, and is not opened here — see below.
 *
 * ## The samples are the game's own bytes
 *
 * A `.SND` is **signed** eight-bit at four to twenty kilohertz, exactly as
 * the card took it. Turning a byte into a level is the format's business and
 * lives with the format (`snd.js`), not here — it was written in two places
 * once, and the two disagreed. They are cached against the byte array they
 * came from, so a sound played a hundred times is converted once.
 *
 * ## The card's DAC is modelled here, not left to the browser
 *
 * These recordings are **5 000 to 11 000 Hz** — a quarter of what a browser
 * runs at. Handing one over at its own rate and letting the audio system get
 * it up to 48 kHz means whatever resampler that browser happens to have,
 * which differs between browsers and sounds nothing like the card: a Sound
 * Blaster's DAC **held** each byte for a whole tick, steps and all, and a
 * linear interpolator smooths exactly the edges that gave those samples their
 * character.
 *
 * So the conversion is done here, once, all the way up to the bus's own rate:
 * each byte held for `output rate / wanted rate` samples, and a gentle low
 * pass after it for the card's output stage — the same shape as the `lowPass`
 * of svision's OPL2, and for the same reason. The buffer then goes out at the
 * context's rate with a playback rate of 1, so nothing resamples it again and
 * it sounds the same in every browser.
 *
 * The pitch a script asks for is folded into the hold: the same bytes wanted
 * faster are simply held for fewer output samples, which is precisely what
 * the card did when the game changed the DAC's clock.
 *
 * ## The music is waiting for svision
 *
 * AdLib music is not a recording: it is a few kilobytes of commands driving a
 * chip, so its bus has to **generate** rather than play. The chip
 * (`audio/chip/opl2.js`) and the driver (`app/coktel/js/adl.js`) both exist;
 * what is missing is the handler that pulls samples out of a chip into a bus,
 * and that is generic — every DOS remake wants it — so it belongs in svision
 * and is being written there. {@link AudioManager#MUSIC_BUS} is the seam it
 * plugs into; until then {@link AudioManager#playMusic} does nothing and says
 * so once.
 */
export class AudioManager extends AbstractAudioManager {

  /** The game's own sounds: one at a time, as the card had it. */
  static get SFX_BUS() { return 'sfx'; }
  /** The beeper, which has to be able to sound over them. */
  static get SPEAKER_BUS() { return 'speaker'; }
  /** The AdLib music — opened once svision has a handler that generates. */
  static get MUSIC_BUS() { return 'music'; }

  /** How long a beep with no length of its own lasts, in milliseconds. */
  static get BEEP_MS() { return 60; }

  /**
   * How many times a sound plays, from the repeat count the engine hands over.
   *
   * The count is the **total number of passes**, not how many extra ones —
   * and both 0 and 1 mean once, because the original's mixer asks
   * `repCount - 1 > 0` before going round again (`SoundMixer::checkEndSample`).
   *
   * Adding one to this instead, which is the obvious reading of the name,
   * plays every sound in the game **twice**: 624 of the floppy edition's 644
   * sample plays ask for 1.
   *
   * **Only -1 loops.** The mixer tests for that exact value; -2 falls through
   * the same `repCount - 1 > 0` and plays once, like any other count that is
   * not more than one.
   *
   * @param {number} repeat - The engine's count.
   * @returns {number|boolean} Passes, or true for a loop.
   */
  static passesOf(repeat) {
    if (repeat === -1) {
      return true;
    }
    return Math.max(repeat, 1);
  } // passesOf

  constructor(app) {
    super(app);
    this.id = 'AudioManager';

    /**
     * Converted samples, against the bytes they came from.
     *
     * A `WeakMap` because the keys are the engine's own slot contents: when a
     * script frees a slot the bytes go, and the conversion should go with
     * them without anybody having to say so.
     *
     * @type {WeakMap}
     */
    this.converted = new WeakMap();
    /** @type {boolean} whether the missing music handler has been mentioned */
    this.saidNoMusic = false;
  } // constructor

  createAudioHandler(bus, options) {
    return new AudioSampleHandler(this.app);
  } // createAudioHandler

  /**
   * Opens the buses the game plays on.
   *
   * Through the model's events rather than by calling {@link openBus}
   * directly — that is how the other remakes do it, and it is what lets the
   * library reopen a bus it could not open the first time
   * (`unsupportedAudioBus` comes back as an event and is answered with
   * another `openAudioBus`). A direct call would work until the day it did
   * not, and then silently.
   *
   * @param {Object} model - The model whose event queue to send through.
   */
  openBuses(model) {
    model.sendEvent(0, {id: 'openAudioBus', bus: AudioManager.SFX_BUS,
      options: {muted: false, channelCount: 1}});
    model.sendEvent(0, {id: 'openAudioBus', bus: AudioManager.SPEAKER_BUS,
      options: {muted: false, channelCount: 1}});
  } // openBuses

  /**
   * Plays one of the game's samples.
   *
   * @param {Object} request - `{samples, rate, repeat}` from the interpreter;
   *   `samples` are unsigned bytes and `repeat` is how many **extra** times,
   *   negative meaning for ever.
   */
  playSample(request) {
    if (!request.samples || request.samples.length === 0) {
      return;
    }
    var wanted = request.rate || request.own;
    if (!wanted) {
      return;
    }

    var sample = this.dacSample(request.samples, wanted);
    this.cache(AudioManager.SFX_BUS, 'sound', sample);
    this.playSound(AudioManager.SFX_BUS, 'sound', {
      repeat: AudioManager.passesOf(request.repeat)
    });
  } // playSample

  /**
   * The bytes as the card's DAC would have put them out, at the bus's rate.
   *
   * Cached twice over: by the bytes, and within those by the rate asked for,
   * because the same sound at two pitches really is two different streams.
   *
   * @param {Uint8Array} bytes - Unsigned eight-bit, 128 being silence.
   * @param {number} wanted - The rate the DAC is clocked at, in Hz.
   * @returns {PCMSample} At the bus's own rate.
   */
  dacSample(bytes, wanted) {
    var byRate = this.converted.get(bytes);
    if (byRate === undefined) {
      byRate = {};
      this.converted.set(bytes, byRate);
    }
    if (byRate[wanted] !== undefined) {
      return byRate[wanted];
    }

    var out = this.busRate();
    var hold = out/wanted;
    var length = Math.max(1, Math.round(bytes.length*hold));
    var levels = toLevels(bytes);
    var samples = new Float32Array(length);

    // Zero order hold: each byte fills its own stretch of output, edges and
    // all. This is the step the card made and the browser would have rounded
    // off.
    for (var i = 0; i < length; i++) {
      var at = Math.floor(i/hold);
      samples[i] = levels[at < levels.length ? at : levels.length-1];
    }

    // And the card's output stage: one pole, at half the DAC's rate, which
    // takes the hardest edges off without touching the sound itself.
    var alpha = 1-Math.exp(-2*Math.PI*(wanted/2)/out);
    var filtered = 0;
    for (var j = 0; j < length; j++) {
      filtered += alpha*(samples[j]-filtered);
      samples[j] = filtered;
    }

    var sample = new PCMSample(samples, out);
    byRate[wanted] = sample;
    return sample;
  } // dacSample

  /**
   * The rate the buses run at.
   *
   * The context's own, once there is one; 44 100 before that, which only
   * matters if a sound is asked for before the first bus opens.
   *
   * @returns {number} Samples a second.
   */
  busRate() {
    return this.ctx !== null && this.ctx !== undefined ? this.ctx.sampleRate : 44100;
  } // busRate

  /**
   * Puts one sample in a bus's cache under a name.
   *
   * The manager looks a sound up by name; these sounds have no names of their
   * own — they are slots of the interpreter, played and forgotten — so one
   * name per bus is enough and the entry is replaced each time.
   *
   * @param {string} bus - Which bus.
   * @param {string} name - The name to look it up by.
   * @param {PCMSample} sample - The sound.
   */
  cache(bus, name, sample) {
    if (!(bus in this.audioDataCache)) {
      this.audioDataCache[bus] = {};
    }
    this.audioDataCache[bus][name] = sample;
  } // cache

  /** Stops the samples. */
  stopSample() {
    this.stopBus(AudioManager.SFX_BUS);
  } // stopSample

  /**
   * The PC speaker — in Goblins 3, the goblins' footsteps.
   *
   * A square wave at the frequency asked for. A length of -1 means "until
   * told to stop", but the scripts fire the stop so quickly after the start
   * that honouring it would swallow the beep — which is why the engine has a
   * length of its own for the footstep and tells us to ignore the next stop
   * (`sound.js`). A short default is used for everything else so that a beep
   * nobody ever stops does not hang.
   *
   * @param {Object} request - `{frequency, length}`, length in milliseconds.
   */
  speakerOn(request) {
    if (!request.frequency) {
      return;
    }
    var ms = request.length > 0 ? request.length : AudioManager.BEEP_MS;
    var sample = PCMSample.tone(11025, request.frequency, ms/1000, {wave: 'square', volume: 0.35});
    // Its own bus, so it never cuts the game's sounds — and without `overlap`
    // a new beep replaces the one before it rather than piling up.
    this.cache(AudioManager.SPEAKER_BUS, 'beep', sample);
    this.playSound(AudioManager.SPEAKER_BUS, 'beep', false);
  } // speakerOn

  /** Stops the beeper. */
  speakerOff() {
    this.stopBus(AudioManager.SPEAKER_BUS);
  } // speakerOff

  /**
   * Starts a piece of AdLib music — once there is a bus that can generate it.
   *
   * @param {Object} request - `{data, repeat}`; `data` is the whole `.ADL`.
   */
  playMusic(request) {
    if (AudioManager.MUSIC_BUS in this.buses) {
      this.cache(AudioManager.MUSIC_BUS, 'music', request);
      this.playSound(AudioManager.MUSIC_BUS, 'music', false);
      return;
    }
    if (!this.saidNoMusic) {
      this.saidNoMusic = true;
      console.info('AudioManager: no music bus yet — the AdLib driver is in '+
        'app/coktel/js/adl.js and the chip in svision; what is missing is a '+
        'handler that pulls samples out of a chip into a bus.');
    }
  } // playMusic

  /** Stops the music. */
  stopMusic() {
    if (AudioManager.MUSIC_BUS in this.buses) {
      this.stopBus(AudioManager.MUSIC_BUS);
    }
  } // stopMusic

  /**
   * Whether anything is playing — what the scripts read out of variable 1.
   *
   * Only the samples count: a script that waits for a sound to finish is
   * waiting for a line of speech or an effect, never for the background
   * music, which in the original would have left it waiting for ever.
   *
   * @returns {boolean} True while a sample is sounding.
   */
  soundPlaying() {
    var bus = this.buses[AudioManager.SFX_BUS];
    return bus !== undefined && bus.playing !== undefined && bus.playing.length > 0;
  } // soundPlaying

} // AudioManager
