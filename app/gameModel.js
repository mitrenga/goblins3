const { AbstractModel } = await import('./svision/js/abstractModel.js?ver='+window.srcVersion);
const { VGAVideoRAMEntity } = await import('./svision/js/platform/canvas2D/vga/vgaVideoRAMEntity.js?ver='+window.srcVersion);
const { VGAVideoRAM } = await import('./svision/js/platform/canvas2D/vga/vgaVideoRAM.js?ver='+window.srcVersion);
const { VGAPalette } = await import('./svision/js/platform/canvas2D/vga/vgaPalette.js?ver='+window.srcVersion);
const { loadArchives, holdStep, EDITION } = await import('./archives.js?ver='+window.srcVersion);
const { ResourceSet } = await import('./coktel/js/resources.js?ver='+window.srcVersion);
const { Interpreter } = await import('./coktel/js/interpreter.js?ver='+window.srcVersion);
const { Surface } = await import('./coktel/js/surface.js?ver='+window.srcVersion);
const { decodeSprite } = await import('./coktel/js/sprite.js?ver='+window.srcVersion);
// begin code

/**
 * Goblins Quest 3 itself: the original scripts, run here.
 *
 * Nothing about this game is written in JavaScript. The archives of the
 * floppy release are fetched, the interpreter in `app/coktel` is pointed at
 * `INTRO.TOT` the way the original's `init.cpp` does, and whatever the
 * scripts draw is what appears. The picture on the screen is made of the
 * game's own sprites, its own palettes and its own fonts.
 *
 * ## One frame at a time
 *
 * The interpreter is a **generator**: it yields wherever the original let an
 * interrupt through — the frame boundary inside `keyFunc`, and the wait
 * inside a hotspot block. So this model does not "run a script"; it holds a
 * suspended run and advances it once per frame, reads the mouse and the
 * keyboard in between, and paints what the last frame drew. That is what
 * makes the game playable rather than a slide show, and it is the whole of
 * the difference between G4's two halves.
 *
 * The `loadTot` chain is **followed on its own**, the way the engine's outer
 * loop does: a run that ends by asking for another script gets it on the next
 * frame. `INTRO.TOT` draws nothing at all — it sets the screen up and hands
 * over — so stopping there would show a black screen and nothing else.
 *
 * ## No copy protection, and the text in English
 *
 * Neither is a patch. The engine tells every script which language it is
 * running in (variable 16), and Goblins 3's `DEMO.TOT` asks
 * `if (language != AMERICAN)` before it draws its colour grid — the Sierra US
 * release simply did not have a protection, which is why its manual mentions
 * none. Running as American is therefore both the English text and no
 * protection, by the original's own switch. The default lives with the
 * interpreter (`LANGUAGE` in `app/coktel/js/interpreter.js`) so that the
 * offline tools and the game cannot disagree about it.
 *
 * ## Input
 *
 * The mouse is the game's: where it is, and which buttons are down, go
 * straight to the interpreter, and the pointer that is drawn is the game's
 * own cursor sprite out of its own archives. Keys are turned into the DOS
 * scan-and-character codes the scripts compare against, because that is what
 * a script's hotspot table holds.
 *
 * ## Keys of this model, not of the game
 *
 *   R       start again from `INTRO.TOT`
 *   B       go back to the title screen
 *
 * There is **no status line**. There used to be one across the foot of the
 * screen saying what the interpreter was doing, from when the game could not
 * be played and that was the only thing to look at; now the game draws its
 * own control panel exactly there, and the line sat on top of it. What is
 * left on the screen is faults — a missing archive, a script that threw —
 * because a black screen that says nothing is worse than no screen at all.
 * Everything else goes to the console.
 */
export class GameModel extends AbstractModel {

  /** The script the engine starts at (`_startTot` in the reference). */
  static get START() { return 'INTRO.TOT'; }

  /**
   * Scripts that are not run, and what is run in their place.
   *
   * `DEMO.TOT` is the title screen, and {@link BootModel} has just shown it —
   * running it again would be the same picture twice with the Coktel logo in
   * between (operator, 2026-09-14).
   *
   * Replacing it with `MENU.TOT` is not a guess about where it would have
   * gone. `DEMO.TOT` holds the title for four hundred turns or until the
   * player presses something, and then has exactly **two** ways out:
   * `loadTot("MENU")`, and a `loadTot("END")` that is inside the copy
   * protection — which this remake does not run at all (see `LANGUAGE` in
   * the interpreter). So `MENU.TOT` is where it always ends up, and nothing
   * it sets up on the way is read again: the screen, the frame rate and the
   * palette are all set afresh by `MENU.TOT` itself.
   *
   * @returns {Object} Script name to script name, both with the `.TOT`.
   */
  static get SKIP() { return {'DEMO.TOT': 'MENU.TOT'}; }

  /**
   * The DOS key codes the scripts compare against.
   *
   * A key is a scan code in the high byte and a character in the low one, and
   * the scripts test both halves — a hotspot bound to a cursor key has
   * nothing in its low byte at all. So a browser key name has to become one
   * of these; anything else is passed through as its own character.
   */
  static get KEYS() {
    return {
      Escape: 0x011B, Enter: 0x1C0D, Backspace: 0x0E08, ' ': 0x3920,
      Delete: 0x5300, ArrowUp: 0x4800, ArrowDown: 0x5000,
      ArrowRight: 0x4D00, ArrowLeft: 0x4B00,
      F1: 0x3B00, F2: 0x3C00, F3: 0x3D00, F4: 0x3E00, F5: 0x3F00,
      F6: 0x4000, F7: 0x4100, F8: 0x4200, F9: 0x4300, F10: 0x4400
    };
  }

  /** How many commands the interpreter may run in one frame. */
  static get STEPS_PER_FRAME() { return 400000; }

  /**
   * How many frames a second the game runs at until a script says otherwise.
   *
   * The scripts of this edition ask for 10, 12 or 15, and they mean it: this
   * is not a drawing speed but the **clock the whole game is timed to**. How
   * long a sound gets before the next one cuts it off, how fast a goblin
   * walks, how long a line of dialogue stays up — all of it is counted in
   * these frames.
   */
  static get DEFAULT_FRAME_RATE() { return 12; }

  /**
   * How long one turn of a wait for the player is, in milliseconds.
   *
   * The original delays ten milliseconds between looks at the mouse, which is
   * far shorter than a frame: waiting is not the same thing as running, and
   * pacing a wait to the frame rate would make the pointer lag.
   */
  static get WAIT_MS() { return 10; }

  /** The palette register a message is written in, and the one for a fault. */
  static get INK() { return 255; }
  static get INK_BAD() { return 254; }

  /** How many scripts of a `loadTot` chain to follow before giving up. */
  static get CHAIN_LIMIT() { return 64; }

  /**
   * How long a picture on the way into the game is held, in milliseconds.
   *
   * Two of them are shown before the player ever gets a say — the Coktel
   * Vision logo, and the one of four pictures of a goblin on a floppy disk
   * that `MENU.TOT` draws while it opens a room. On the original both were up
   * for as long as the drive took. Here the archives are already in memory,
   * so each would be a flash of a frame or two; this is the floor that makes
   * them pictures again rather than a stutter.
   *
   * The archives themselves are **not** held back: they take as long as they
   * take, and the line of text saying which one is on its way is enough to
   * follow. A picture is a different thing — it has to be looked at.
   */
  static get SCREEN_MS() { return 1000; }

  constructor(app) {
    super(app);
    this.id = 'GameModel';

    this.screen = null;
    /** @type {?object} the game's archives, normally the boot's */
    this.archives = null;
    /** @type {string|null} the next script of the chain, when there is one */
    this.nextTot = null;
    /** @type {Interpreter|null} the run whose picture is on the screen */
    this.vm = null;
    /** @type {number} when the palette was last cycled */
    this.cycledAt = 0;
    /** @type {boolean} set once something went wrong, so the loop stops */
    this.failed = false;
    /**
     * The suspended run, or null.
     *
     * This is the game: a generator sitting wherever the script last let the
     * outside world have a turn. {@link GameModel#loopModel} advances it by
     * one yield a frame.
     *
     * @type {?Generator}
     */
    this.run = null;
    /** @type {string} the running script's name, without the `.TOT` */
    this.scriptName = '';
    /** @type {number} how many scripts of the chain have been run */
    this.chainStep = 0;

    /** @type {{x: number, y: number, buttons: number}} the mouse, as the game sees it */
    this.pointer = {x: 0, y: 0, buttons: 0};
    /**
     * Where the pointer sits on the **screen**, which is not where it sits in
     * the scene: a scrolling room moves under it.
     *
     * It is kept because the original polls the mouse every frame, while a
     * browser only says anything when it moves. Without it a pointer parked
     * at the left edge of a scrolled room would scroll the view one step and
     * then stop, because the view sliding out from under it would take it off
     * the edge.
     */
    this.pointerLocal = {x: 0, y: 0};
    /** @type {number[]} keys pressed since the interpreter last looked */
    this.keyQueue = [];

    /** @type {number} frames a second the scripts asked for */
    this.frameRate = GameModel.DEFAULT_FRAME_RATE;
    /** @type {number} the timestamp the interpreter may run again at */
    this.nextFrameAt = 0;
    /**
     * When a script was last opened — the remake's floppy drive.
     *
     * `MENU.TOT` draws one of four pictures of a goblin standing on a floppy
     * disk before it opens a room, and then the room paints over it. On the
     * original that picture was up for as long as the drive took; here the
     * archives are already in memory, so without a floor under it the player
     * sees a flash and no more. See {@link GameModel#pump}.
     *
     * @type {number}
     */
    this.diskAt = 0;
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
    this.loadArchives();
  } // init

  /**
   * Starts the game on the archives the boot already fetched.
   *
   * {@link BootModel} loads them behind the title screen and leaves them on
   * the app, so normally there is nothing to wait for here. Fetching them is
   * still possible — somebody may start this model on its own — and then it
   * says so on the screen, because eight megabytes is not instant.
   *
   * Everything is inside the guard, the starting of the game included: an
   * `async` method's throw becomes a rejected promise nobody is waiting on,
   * and the screen would keep saying "loading" while the reason went to the
   * console alone. Whatever goes wrong has to end up on the screen.
   */
  async loadArchives() {
    try {
      if (this.app.archives) {
        this.archives = this.app.archives;
      } else {
        this.note('loading '+EDITION+' ...');
        await this.nextFrame();
        this.archives = await loadArchives((line) => {
          this.note(line);
          return this.nextFrame();
        });
        this.app.archives = this.archives;
      }

      // The buses are opened here rather than at startup: a browser will not
      // start an AudioContext until the player has done something, and by now
      // they have — the title screen waits for a click or five seconds.
      this.app.audioManager.openBuses(this);

      // The logo is held rather than merely drawn: the first script paints
      // over it as soon as it has something of its own, and on a machine
      // where that takes a frame the picture the original left up would only
      // flash. The wait is counted from the drawing, so it costs nothing
      // where the script is slow to get going anyway.
      var logoAt = Date.now();
      this.showCoktelLogo();
      await this.nextFrame();
      await holdStep(logoAt, GameModel.SCREEN_MS);
      await this.runChain(GameModel.START);
    } catch (error) {
      this.fail(error.message);
    }
  } // loadArchives

  /**
   * Waits for the browser to paint what was just drawn.
   *
   * Without this the status line is a lie. The archives are usually in the
   * browser's cache by the second visit, so every `await` in the loading
   * resolves inside the same frame and nothing is painted between them; then
   * the interpreter runs, which blocks the thread, and the **first** message
   * stays on the screen however far the code has really got. One frame
   * between the steps makes the line say where it is.
   *
   * @returns {Promise} Resolved on the next animation frame.
   */
  nextFrame() {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  } // nextFrame

  /**
   * Runs something and puts whatever it throws on the screen.
   *
   * @param {Function} work - What to try.
   */
  guard(work) {
    if (!this.archives) {
      return;
    }
    try {
      var result = work();
      // `runChain` is asynchronous, so its failure arrives as a rejection
      // rather than as a throw; both have to end up on the screen.
      if (result && typeof result.catch === 'function') {
        result.catch((error) => this.fail(error.message));
      }
    } catch (error) {
      this.fail(error.message);
    }
  } // guard

  /**
   * Says what is going on, on the screen.
   *
   * The only two things that ever reach the screen this way: the archives
   * being fetched (when this model was started on its own, without the boot
   * having done it), and a fault. Everything else goes to the console —
   * anything drawn here sits on top of the game's own control panel.
   *
   * @param {string} message - What is happening.
   * @param {boolean} [bad] - Whether it is a fault.
   */
  note(message, bad) {
    // The two registers are set every time rather than trusted: the scripts
    // put whatever they like in the palette, and over one with black in the
    // register the text uses the line would be there and invisible. They are
    // the last two of the 256 because the further from the low registers,
    // the less a picture misses them.
    this.screen.palette.set(GameModel.INK, 63, 63, 63);
    this.screen.palette.set(GameModel.INK_BAD, 63, 21, 21);

    var vram = this.screen.videoRAM;
    var y = vram.height-16;
    vram.fillRect(0, y, vram.width, 16, 0);
    // Forty glyphs of eight pixels fill the 320 the screen has.
    vram.drawText(this.app.fonts.vgaFonts8x16Mono, 0, y,
      message.substring(0, 40), bad ? GameModel.INK_BAD : GameModel.INK);
    this.screen.invalidate();
  } // note

  /**
   * Starts the chain at `totName`.
   *
   * Only the first script is started here; the rest follow by themselves,
   * because a run that ends having asked for another one is picked up by
   * {@link GameModel#pump} on the next frame.
   *
   * @param {string} totName - With the `.TOT`.
   */
  async runChain(totName) {
    this.chainStep = 0;
    this.nextTot = null;
    this.startScript(totName);
    await this.nextFrame();
  } // runChain

  /**
   * Shows the Coktel Vision logo, the way the original does before any script.
   *
   * `init.cpp` draws it itself, not through the bytecode: the picture is
   * `COKTEL.IMS` and its palette `COKTEL.CLT`, both plain members of
   * `INTRO.STK`. It is the first thing a player sees.
   */
  showCoktelLogo() {
    var image = this.archives.member('COKTEL.IMS');
    var palette = this.archives.member('COKTEL.CLT');
    if (!image || !palette) {
      return;
    }
    var decoded = decodeSprite(image, this.screen.videoRAM.width, this.screen.videoRAM.height);
    this.screen.videoRAM.bytes.set(decoded.pixels.subarray(0, this.screen.videoRAM.bytes.length));
    this.screen.palette.load(palette);
    this.screen.invalidate();
  } // showCoktelLogo

  /**
   * Opens one script and builds the host that answers for **its** resources.
   *
   * A sub-script's sprites and texts are not the caller's, so every
   * environment needs its own host — and since a sub-script may open one of
   * its own, the host it is given knows how to do this again.
   *
   * @param {string} totName - With or without the `.TOT`.
   * @returns {Object|null} `{data, host}`, or null when there is no such script.
   */
  openEnvironment(totName) {
    var wanted = totName.replace(/\.TOT$/i, '').toUpperCase()+'.TOT';
    // Asking for a script we do not run gets the one it would have led to.
    // Done here because this is the one place every script is opened, the
    // chain's and a sub-script's alike.
    var asked = GameModel.SKIP[wanted] || wanted;
    var base = asked.replace(/\.TOT$/i, '');

    var tot = this.archives.member(base+'.TOT');
    if (!tot) {
      return null;
    }

    var resources = new ResourceSet({
      name: base,
      tot: tot,
      ext: this.archives.member(base+'.EXT'),
      ex: null,
      im: null,
      texts: this.archives.member(base+'.ANG')
    });
    resources.ex = this.archives.member('COMMUN.EX'+resources.props.exFileNumber);

    return {data: tot, host: this.host(resources), name: base};
  } // openEnvironment

  /**
   * Loads a script and sets it running, suspended at its first yield.
   *
   * The TOT is loaded, its resources are gathered the way the engine does
   * (its own `.EXT`, the shared `COMMUN.EX<n>` its header names, its language
   * file) and a run is started at its first entry point. Nothing is executed
   * here: the generator is created and left to {@link GameModel#pump}.
   *
   * @param {string} totName - With the `.TOT`.
   */
  startScript(totName) {
    var opened = this.openEnvironment(totName);
    if (!opened) {
      this.fail(totName+' is not in the archives');
      return;
    }
    // Which script this really is — `SKIP` may have chosen another one.
    var base = opened.name;

    // A `loadTot` changes the script and **almost nothing else**: the
    // palette, the surfaces, the fonts, the cursor and the variable block all
    // carry on, because the scripts hand the game over to each other in the
    // middle of a picture. So the interpreter is reused rather than rebuilt —
    // `DEMO.TOT` fades to black and clears the palette before handing over to
    // `MENU.TOT`, and a fresh interpreter would have nothing to come back to.
    var vm = this.vm;
    if (vm) {
      vm.setHost(opened.host);
      vm.loadTot(opened.data);
    } else {
      vm = new Interpreter({
        data: opened.data,
        version: 'v3',
        random: this.randomSource(),
        maxSteps: GameModel.STEPS_PER_FRAME,
        host: opened.host
      });
    }

    this.vm = vm;
    this.scriptName = base;
    this.nextTot = null;
    this.run = vm.runGen();
  } // startScript

  /**
   * Advances the suspended run to its next yield — one frame of the game.
   *
   * A generator's `next()` comes back either at a yield, which is a frame
   * boundary or a turn of the hotspot wait, or at the end of the run. The
   * step bound is a safety net for the second kind of freeze a script can
   * cause: not "it never came back" but "it came back a hundred thousand
   * times without ever reaching a yield".
   */
  pump(timestamp) {
    if (!this.run || this.failed) {
      return;
    }
    // The game has its own clock and it is **slower than the browser's**. A
    // script that asks for twelve frames a second is not asking for a drawing
    // speed: it is telling us how long everything in it lasts, and running it
    // at sixty makes the whole game five times too fast — which is heard
    // before it is seen, as every sound being cut off by the next one.
    if (timestamp < this.nextFrameAt) {
      return;
    }
    // A script has just been opened: the game's clock stops for as long as
    // the drive would have taken. Stopping it here rather than waiting inside
    // the host is what keeps the loading picture **on the screen** — the
    // model goes on painting every frame, and what it paints is the last
    // thing the script drew.
    if (Date.now()-this.diskAt < GameModel.SCREEN_MS) {
      return;
    }
    var vm = this.vm;
    // The budget is the whole safety net, and it has to be set **before** the
    // step rather than checked after it: a script that loops without ever
    // reaching a frame boundary never comes back at all, and then there is no
    // "after". Spending it ends the run with a reason instead of the tab.
    vm.maxSteps = vm.steps+GameModel.STEPS_PER_FRAME;

    var step;
    try {
      step = this.run.next();
    } catch (error) {
      this.fail(this.scriptName+': '+error.message);
      return;
    }

    if (!step.done) {
      // What the interpreter stopped for decides how long it waits: a frame
      // boundary is a frame, a turn of a wait for the player is a moment.
      var wait = step.value && step.value.reason === 'frame'
        ? 1000/this.frameRate : GameModel.WAIT_MS;
      // On a grid rather than from now, so that a frame which took a little
      // too long does not push every frame after it late — but never a grid
      // so far behind that it is caught up with in one burst.
      this.nextFrameAt = Math.max(this.nextFrameAt+wait, timestamp);
      return;
    }

    // The run ended. Either it asked for another script, or the game is over.
    var result = step.value;
    if (result.reason === 'error') {
      this.fail(this.scriptName+': '+result.error);
      return;
    }

    this.run = null;
    if (result.reason === 'steps' || result.reason === 'spinning') {
      // Not fatal — what it drew is still worth looking at — so the screen is
      // left alone and the console is told.
      console.warn('GameModel: '+this.scriptName+' ran '+GameModel.STEPS_PER_FRAME+
        ' commands without ever waiting');
      return;
    }

    var next = vm.totToLoad ? vm.totToLoad.toUpperCase() : null;
    if (!next) {
      return;
    }
    if (++this.chainStep >= GameModel.CHAIN_LIMIT) {
      console.warn('GameModel: the loadTot chain passed '+GameModel.CHAIN_LIMIT+' scripts');
      return;
    }
    this.startScript(next);
  } // pump

  /**
   * Says on the screen that something went wrong.
   *
   * Without this a missing archive, a script that threw or a server that will
   * not serve `.STK` all look the same from the outside: a black screen. The
   * boot's own font is used, because the game's fonts come out of the
   * archives and those are exactly what may be missing.
   *
   * @param {string} message - What happened.
   */
  fail(message) {
    // The screen has forty characters; the console has the whole message and,
    // for a throw, the stack behind it.
    console.error('GameModel: '+message);
    this.failed = true;
    this.vm = null;
    this.screen.videoRAM.fill(0);
    this.screen.palette.load(VGAPalette.defaultPalette());
    this.note(message, true);
  } // fail

  /**
   * What the interpreter asks of the outside world.
   *
   * The same shape the offline tools build in `tools/hostlib.mjs` — that is
   * the point of the seam: the interpreter is identical in the browser and
   * under Node, and only the answers differ.
   *
   * @param {ResourceSet} resources - The running script's resources.
   * @returns {Object} The host.
   */
  host(resources) {
    var model = this;
    return {
      spriteResource: function (id) {
        var resource = resources.resource(id);
        if (!resource || !resource.width || !resource.height) {
          return null;
        }
        return {data: resource.data, width: resource.width, height: resource.height};
      },
      paletteResource: function (id) {
        var resource = resources.resource(id);
        return resource && resource.data.length >= 768
          ? resource.data.subarray(0, 768) : null;
      },
      resource: function (id) {
        var resource = resources.resource(id);
        return resource ? resource.data : null;
      },
      fileData: function (file, size, offset) {
        var data = model.archives.member(file);
        if (!data) {
          return null;
        }
        if (size === undefined) {
          return data;
        }
        var from = offset < 0 ? data.length+offset+1 : (offset || 0);
        return data.subarray(from, from+size);
      },
      fileSize: function (file) {
        var data = model.archives.member(file);
        return data ? data.length : -1;
      },
      writeFile: function () { return false; },
      totTextItemPart: function (item, part) {
        var text = resources.textItem(item);
        if (!text) {
          return '';
        }
        var whole = '';
        for (var i = 0; i < text.length; i++) {
          whole += String.fromCharCode(text[i]);
        }
        var parts = whole.split('\\');
        return parts[part] === undefined ? parts[0] : parts[part];
      },
      // The engine runs its own hotspot blocks now; there is a player.
      hotspots: null,
      /** The oldest key not yet taken, or none. */
      key: function () {
        return model.keyQueue.length ? model.keyQueue.shift() : 0;
      },
      texts: function () { return resources.texts; },
      /**
       * Milliseconds since the game started.
       *
       * A real clock, because this is playing rather than measuring: the
       * cursor's animation, the hotspot blocks' timeouts and the mult's
       * pacing all read it. A test flight replaces it with a counter.
       */
      now: function () { return Math.round(performance.now()); },
      date: function () {
        var now = new Date();
        return {
          year: now.getFullYear(), month: now.getMonth()+1,
          weekday: (now.getDay()+6)%7+1, day: now.getDate(),
          hour: now.getHours(), minute: now.getMinutes(), second: now.getSeconds()
        };
      },
      mouse: function () {
        // Asked every frame, and answered in the scene's coordinates from
        // where the pointer is on the screen — see {@link GameModel#pointerLocal}.
        var draw = model.vm ? model.vm.draw : null;
        model.pointer.x = model.pointerLocal.x+(draw ? draw.scrollOffsetX : 0);
        model.pointer.y = model.pointerLocal.y+(draw ? draw.scrollOffsetY : 0);
        return model.pointer;
      },
      setMousePos: function (x, y) {
        // The engine's coordinates are the scene's; the screen's come off them.
        var draw = model.vm ? model.vm.draw : null;
        model.pointer.x = x;
        model.pointer.y = y;
        model.pointerLocal.x = x-(draw ? draw.scrollOffsetX : 0);
        model.pointerLocal.y = y-(draw ? draw.scrollOffsetY : 0);
      },
      /**
       * How fast the game is to run from here on.
       *
       * The scripts set it per screen, and it is the clock everything in them
       * is timed to — see {@link GameModel.DEFAULT_FRAME_RATE}.
       */
      setFrameRate: function (rate) {
        if (rate > 0 && rate <= 100) {
          model.frameRate = rate;
        }
      },
      /**
       * Whether a sound is playing — variable 1, which the scripts wait on.
       *
       * Only the samples count. A script waiting for "the sound" to finish
       * means a line or an effect; answering yes for the background music
       * would leave it waiting for ever.
       */
      soundPlaying: function () { return model.app.audioManager.soundPlaying(); },
      // Sound. The interpreter decides what should play and hands over a
      // decoded sample; `audioManager.js` is what makes the noise.
      playSample: function (vm, request) { model.app.audioManager.playSample(request); },
      stopSample: function () { model.app.audioManager.stopSample(); },
      playMusic: function (vm, request) { model.app.audioManager.playMusic(request); },
      stopMusic: function () { model.app.audioManager.stopMusic(); },
      speakerOn: function (vm, request) { model.app.audioManager.speakerOn(request); },
      speakerOff: function () { model.app.audioManager.speakerOff(); },
      multSound: function () {},
      playImd: function () {},
      // The engine nests scripts itself (`totSub`); the host only has to
      // find them. `MENU.TOT` is the game's main loop and every room is a
      // sub-script of it, so without this the game is a spinning menu.
      totSub: null,
      switchTotSub: null,
      /**
       * A script asking for another one — and the one place the remake
       * touches its "disk". See {@link GameModel#diskAt}.
       */
      openTot: function (vm, name) {
        model.diskAt = Date.now();
        return model.openEnvironment(name);
      },
      missingTot: function (vm, name) {
        console.warn('GameModel: no such script '+name);
      }
    };
  } // host

  /**
   * The source `rand()` in a script draws from.
   *
   * Seeded, not `Math.random()` — a run that cannot be repeated cannot be
   * matched against a recording (R-009). The seed is the clock only because
   * this is playing rather than measuring; a test flight passes a fixed one.
   */
  randomSource() {
    var state = (Date.now() & 0x7FFFFFFF) >>> 0;
    return function (max) {
      state = (state+0x6D2B79F5) >>> 0;
      var t = state;
      t = Math.imul(t^(t >>> 15), t|1);
      t ^= t+Math.imul(t^(t >>> 7), t|61);
      var value = ((t^(t >>> 14)) >>> 0)/4294967296;
      return max > 0 ? Math.floor(value*max) : 0;
    };
  } // randomSource

  /** Copies the engine's screen and palette into the video memory. */
  paint() {
    if (!this.vm) {
      return;
    }
    var draw = this.vm.draw;
    // A run that has ended — between two scripts of a chain — never reached
    // its last frame boundary, so what it drew is still only on the back
    // surface and has to be pushed out by hand.
    if (!this.run) {
      draw.forceBlit();
    }
    var visible = new Surface(draw.screenWidth, draw.screenHeight,
      this.screen.videoRAM.bytes);
    draw.composeScreen(visible);
    this.screen.palette.load(draw.palette);
    this.screen.invalidate();
  } // paint

  /**
   * One frame: advance the game, then draw it.
   *
   * The model has to **draw itself every frame**: the library's loop advances
   * events and audio but paints nothing, and `invalidate()` only marks the
   * entity's cache stale so the next `drawEntity()` recomposes it. Without
   * the call below a finished picture sits in the video memory unseen until
   * something else forces a redraw — leaving the tab and coming back does it,
   * which is exactly how this was found. `vgademo` and the other VGA models
   * do the same.
   *
   * The palette cycling is kept here rather than left to the scripts because
   * a script that is sitting in a hotspot wait does not run `animatePalette`
   * itself, and the water and the torches have to keep moving while the
   * player thinks.
   *
   * @param {number} timestamp - The current frame timestamp in milliseconds.
   */
  loopModel(timestamp) {
    super.loopModel(timestamp);

    this.pump(timestamp);

    if (this.vm && timestamp-this.cycledAt >= 60) {
      this.cycledAt = timestamp;
      this.vm.draw.animatePalette();
    }

    this.paint();
    this.drawModel();
  } // loopModel

  /**
   * The library delivers every input as an event, not as a call — see
   * `AbstractModel.handleEvent`. A `keyPress` here is a key, a mouse button,
   * a touch or a gamepad button alike.
   *
   * @param {Object} event - The event object, identified by its id property.
   * @returns {boolean} True if the event was handled.
   */
  handleEvent(event) {
    if (super.handleEvent(event)) {
      return true;
    }

    // The pointer: every event that carries coordinates moves it, whether it
    // is a move, a press or a touch.
    if (event.x !== undefined && event.y !== undefined) {
      this.movePointer(event.x, event.y);
    }

    if (event.id === 'mouseHover' || event.id === 'keyMove') {
      return true;
    }
    if (event.id === 'keyPress') {
      return this.pressed(event.key);
    }
    if (event.id === 'keyRelease') {
      return this.released(event.key);
    }
    if (event.id === 'blurWindow') {
      // A window that loses focus never sends the button up, and the game
      // would then think the player is holding the mouse down for ever.
      this.pointer.buttons = 0;
      return true;
    }
    return false;
  } // handleEvent

  /**
   * Moves the pointer, in the game's own coordinates.
   *
   * The event arrives in the model's space, which has the screen somewhere
   * inside it; the game counts from the top left of its own 320x200, and a
   * scrolling room adds the scroll offset on top of that, because the game's
   * mouse lives in the **scene** and not on the screen.
   *
   * @param {number} x - Model space.
   * @param {number} y - Model space.
   */
  movePointer(x, y) {
    var left = this.screen.parentX+this.screen.x;
    var top = this.screen.parentY+this.screen.y;
    var draw = this.vm ? this.vm.draw : null;
    var width = draw ? draw.screenWidth : this.screen.width;
    var height = draw ? draw.screenHeight : this.screen.height;

    var localX = Math.max(0, Math.min(width-1, Math.round(x-left)));
    var localY = Math.max(0, Math.min(height-1, Math.round(y-top)));
    this.pointerLocal.x = localX;
    this.pointerLocal.y = localY;
    this.pointer.x = localX+(draw ? draw.scrollOffsetX : 0);
    this.pointer.y = localY+(draw ? draw.scrollOffsetY : 0);
  } // movePointer

  /**
   * A key, a mouse button or a touch went down.
   *
   * @param {string} key - The library's name for it.
   * @returns {boolean} True if it was handled.
   */
  pressed(key) {
    if (key === 'Mouse1' || key === 'Touch') {
      this.pointer.buttons |= 1;
      return true;
    }
    if (key === 'Mouse2') {
      this.pointer.buttons |= 2;
      return true;
    }

    // The model's own keys, which the game never sees.
    var upper = key.length === 1 ? key.toUpperCase() : key;
    switch (upper) {
      case 'R':
        this.failed = false;
        this.vm = null;
        this.guard(() => {
          this.showCoktelLogo();
          this.runChain(GameModel.START);
        });
        return true;
      case 'B':
        this.app.setModel('BootModel');
        return true;
    } // switch

    var code = GameModel.KEYS[key];
    if (code === undefined && key.length === 1) {
      // Anything else is its own character with no scan code, which is what
      // the scripts compare a typed letter against.
      code = key.charCodeAt(0);
    }
    if (code === undefined) {
      return false;
    }
    // A queue and not a single slot: a key pressed while the interpreter is
    // busy between two frames must not be lost.
    this.keyQueue.push(code);
    return true;
  } // pressed

  /**
   * A key, a mouse button or a touch came up.
   *
   * @param {string} key - The library's name for it.
   * @returns {boolean} True if it was handled.
   */
  released(key) {
    if (key === 'Mouse1' || key === 'Touch') {
      this.pointer.buttons &= ~1;
      return true;
    }
    if (key === 'Mouse2') {
      this.pointer.buttons &= ~2;
      return true;
    }
    return false;
  } // released

} // GameModel
