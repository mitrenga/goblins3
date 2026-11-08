const { AbstractModel } = await import('./svision/js/abstractModel.js?ver='+window.srcVersion);
const { VGAVideoRAMEntity } = await import('./svision/js/platform/canvas2D/vga/vgaVideoRAMEntity.js?ver='+window.srcVersion);
const { VGAVideoRAM } = await import('./svision/js/platform/canvas2D/vga/vgaVideoRAM.js?ver='+window.srcVersion);
const { VGAPalette } = await import('./svision/js/platform/canvas2D/vga/vgaPalette.js?ver='+window.srcVersion);
const { ResourceSet } = await import('./coktel/js/resources.js?ver='+window.srcVersion);
const { decodeSprite } = await import('./coktel/js/sprite.js?ver='+window.srcVersion);
const { loadArchives, EDITION } = await import('./archives.js?ver='+window.srcVersion);
// begin code

/**
 * The title screen, shown while the game's archives arrive.
 *
 * This is where the other VGA remakes put a period-correct MS-DOS boot — the
 * memory count, the prompt, the game's name typed at it. Goblins 3 does not:
 * the boot was taken out and this put in its place (operator, 2026-09-14).
 *
 * What is shown is the game's **own** title screen — the picture `DEMO.TOT`
 * draws, decoded out of `DEMO.EXT` under the palette out of `DEMO.TOT`. It is
 * not a copy and not a screenshot: it is the original resource, drawn by the
 * same sprite decoder the game uses. A checkout without the operator's
 * archives therefore cannot show it, and says so instead.
 *
 * ## Why the archives are loaded here
 *
 * Because the picture is inside them, and because they are eight megabytes
 * that have to be fetched before anything can run. Loading them behind the
 * title is the one moment in the game when there is time for it, and it means
 * {@link GameModel} starts with them already in hand instead of fetching them
 * a second time.
 *
 * ## How long it stays
 *
 * Five seconds from the moment the picture is **on the screen** — not from the
 * start, which on a slow connection would mean the title flashing past after
 * a long blank wait. Anything the player does ends it sooner; doing something
 * while the archives are still coming means "as soon as you can".
 */
export class BootModel extends AbstractModel {

  /** How long the title stays up once it is drawn, in milliseconds. */
  static get HOLD_MS() { return 5000; }

  /** Which script's title screen it is, and the resources that make it. */
  static get TITLE() {
    return {tot: 'DEMO.TOT', ext: 'DEMO.EXT', sprite: 30000, palette: 0};
  }

  /** The palette register the loading text is written in, and one for a fault. */
  static get INK() { return 255; }
  static get INK_BAD() { return 254; }

  /**
   * @param {Object} app - The application.
   * @param {Object} [properties] - `nextModel`, the model to hand over to.
   */
  constructor(app, properties) {
    super(app);
    this.id = 'BootModel';

    this.properties = Object.assign({nextModel: 'GameModel'}, properties || {});

    this.screen = null;
    /** @type {boolean} whether the title is on the screen */
    this.shown = false;
    /** @type {?number} the timestamp the title went up */
    this.shownAt = null;
    /** @type {boolean} set when the player has asked to get on with it */
    this.skipped = false;
    /** @type {boolean} set once we have handed over, so it happens once */
    this.handedOver = false;
    /** @type {boolean} set when there is nothing to show and nothing to do */
    this.failed = false;
  } // constructor

  init() {
    super.init();

    if (this.borderEntity != null) {
      this.borderEntity.bkColor = '#000000';
    }
    this.desktopEntity.bkColor = '#000000';

    this.screen = new VGAVideoRAMEntity(this.desktopEntity, 0, 0,
      new VGAVideoRAM(), new VGAPalette());
    this.desktopEntity.addEntity(this.screen);

    // Something readable before the archives arrive: they are megabytes and
    // a slow disk would otherwise leave the screen black with no explanation.
    this.screen.palette.load(VGAPalette.defaultPalette());
    this.note('loading '+EDITION+' ...');

    this.start();
  } // init

  /**
   * Fetches the archives and puts the title up.
   *
   * Everything is inside the guard, the drawing included: an `async` method's
   * throw becomes a rejected promise nobody is waiting on, and the screen
   * would keep saying "loading" while the reason went to the console alone.
   */
  async start() {
    try {
      this.app.archives = await loadArchives((line) => {
        this.note(line);
        return this.nextFrame();
      });
      this.showTitle();
    } catch (error) {
      this.fail(error.message);
    }
  } // start

  /**
   * Draws the game's own title screen.
   *
   * The sprite and the palette are read exactly as `DEMO.TOT` reads them —
   * through the same {@link ResourceSet} and the same decoder — so what is
   * on the screen is the original's picture and not a likeness of it.
   */
  showTitle() {
    var title = BootModel.TITLE;
    var tot = this.app.archives.member(title.tot);
    if (!tot) {
      this.fail(title.tot+' is not in the archives');
      return;
    }

    var resources = new ResourceSet({
      name: title.tot.replace(/\.TOT$/i, ''),
      tot: tot,
      ext: this.app.archives.member(title.ext),
      ex: null,
      im: null,
      texts: null
    });

    var picture = resources.resource(title.sprite);
    var palette = resources.resource(title.palette);
    if (!picture || !palette || palette.data.length < 768) {
      this.fail('the title screen is not in '+title.ext);
      return;
    }

    var vram = this.screen.videoRAM;
    var decoded = decodeSprite(picture.data, picture.width, picture.height);
    vram.fill(0);
    // The picture is the screen's own size, so it goes in whole; anything
    // smaller would simply leave the rest black, as the original does.
    vram.bytes.set(decoded.pixels.subarray(0, vram.bytes.length));
    this.screen.palette.load(palette.data.subarray(0, 768));
    this.screen.invalidate();

    this.shown = true;
  } // showTitle

  /**
   * Waits for the browser to paint what was just drawn.
   *
   * Without it the loading line is a lie: the archives are usually in the
   * browser's cache by the second visit, so every `await` resolves inside the
   * same frame and nothing is painted between them — and the **first**
   * message stays on the screen however far the code has really got.
   *
   * @returns {Promise} Resolved on the next animation frame.
   */
  nextFrame() {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  } // nextFrame

  /**
   * Says what is going on, on the screen.
   *
   * The boot's own font is used, because the game's fonts come out of the
   * archives and those are exactly what may be missing.
   *
   * @param {string} message - What is happening.
   * @param {boolean} [bad] - Whether it is a fault.
   */
  note(message, bad) {
    this.screen.palette.set(BootModel.INK, 63, 63, 63);
    this.screen.palette.set(BootModel.INK_BAD, 63, 21, 21);

    var vram = this.screen.videoRAM;
    var y = vram.height-16;
    vram.fillRect(0, y, vram.width, 16, 0);
    // Forty glyphs of eight pixels fill the 320 the screen has.
    vram.drawText(this.app.fonts.vgaFonts8x16Mono, 0, y,
      message.substring(0, 40), bad ? BootModel.INK_BAD : BootModel.INK);
    this.screen.invalidate();
  } // note

  /**
   * Says on the screen that there is nothing to show.
   *
   * Without this a missing archive, a server that will not serve `.STK` and a
   * decoder that threw all look the same from the outside: a black screen.
   * The game is **not** started afterwards — it would only fail again, and
   * less clearly.
   *
   * @param {string} message - What happened.
   */
  fail(message) {
    // The screen has forty characters; the console has the whole message.
    console.error('BootModel: '+message);
    this.failed = true;
    this.screen.videoRAM.fill(0);
    this.screen.palette.load(VGAPalette.defaultPalette());
    this.note(message, true);
  } // fail

  /** Switches to the game. */
  handOver() {
    this.handedOver = true;
    var next = this.properties.nextModel;
    if (typeof next === 'function') {
      next(this.app);
    } else {
      this.app.setModel(next);
    }
  } // handOver

  /**
   * One frame: hand over once the title has had its time, or been skipped.
   *
   * The model has to **draw itself every frame**: the library's loop advances
   * events and audio but paints nothing, and `invalidate()` only marks the
   * entity's cache stale. The other VGA models here do the same.
   *
   * @param {number} timestamp - The current frame timestamp in milliseconds.
   */
  loopModel(timestamp) {
    super.loopModel(timestamp);
    this.drawModel();

    if (this.failed || this.handedOver || !this.shown) {
      return;
    }
    if (this.shownAt === null) {
      this.shownAt = timestamp;
    }
    if (this.skipped || timestamp-this.shownAt >= BootModel.HOLD_MS) {
      this.handOver();
    }
  } // loopModel

  /**
   * Anything at all gets on with it.
   *
   * The library delivers every input as an event, not as a call, and a
   * `keyPress` here is a key, a mouse button, a touch or a gamepad button
   * alike — which is exactly what "or a click, or pressing anything" means.
   *
   * Pressing something while the archives are still coming is remembered
   * rather than ignored: it means "as soon as you can", not "never mind".
   *
   * @param {Object} event - The event object, identified by its id property.
   * @returns {boolean} True if the event was handled.
   */
  handleEvent(event) {
    if (super.handleEvent(event)) {
      return true;
    }
    if (event.id === 'keyPress') {
      this.skipped = true;
      return true;
    }
    return false;
  } // handleEvent

} // BootModel
