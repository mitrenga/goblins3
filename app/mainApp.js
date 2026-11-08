const { AbstractApp } = await import('./svision/js/abstractApp.js?ver='+window.srcVersion);
const { VGAFonts8x16 } = await import('./svision/js/platform/canvas2D/vga/vgaFonts8x16.js?ver='+window.srcVersion);
const { BootModel } = await import('./bootModel.js?ver='+window.srcVersion);
const { VGAControls } = await import('./svision/js/platform/canvas2D/vga/vgaControls.js?ver='+window.srcVersion);
const { GameModel } = await import('./gameModel.js?ver='+window.srcVersion);
const { AudioManager } = await import('./audioManager.js?ver='+window.srcVersion);
const { Version } = await import('./version.js?ver='+window.srcVersion);
// begin code

/**
 * Goblins Quest 3 in a browser.
 *
 * Two models, switched by name the way the other VGA remakes do it: the boot
 * and the game.
 *
 * The boot is **not** svision's `DOSBootModel` here. The other VGA remakes
 * type a period-correct MS-DOS start at a text screen; Goblins 3 shows the
 * game's own title screen instead and loads the archives behind it
 * (operator, 2026-09-14) — see {@link BootModel}.
 *
 * The game itself is not written here. It is the **original TOT scripts**,
 * fetched out of the game's own archives and run through the interpreter in
 * `app/coktel` — see {@link GameModel}.
 */
export class MainApp extends AbstractApp {

  constructor(platform, importPath, wsURL) {
    super(platform, 'bodyApp', importPath, wsURL);
    this.id = 'MainApp';
    this.version = Version;

    this.fonts = {};
    // Only the boot needs a font of our own; the game draws with the fonts
    // out of its own archives.
    this.fonts.vgaFonts8x16Mono = new VGAFonts8x16(this, false);
    this.audioManager = new AudioManager(this);

    // Goblins 3 is played entirely with the mouse: left button to walk, act,
    // pick up and switch goblin, right button for the inventory. The keyboard
    // is only Escape and typing a saved game's name.
    this.controlsOptions = VGAControls.controlsOptions(VGAControls.POINT_AND_CLICK);
    this.controls = {
      keyboard: VGAControls.defaultControls('keyboard', VGAControls.POINT_AND_CLICK),
      mouse: VGAControls.defaultControls('mouse', VGAControls.POINT_AND_CLICK),
      gamepads: VGAControls.defaultControls('gamepads', VGAControls.POINT_AND_CLICK),
      /** the input manager only marks whether a touch screen is there; a
          touch is a click, so there is no on-screen layout to draw */
      touchscreen: {supported: false, type: false}
    };
    this.controls.mouse.enable = true;

    this.setModel('BootModel');
  } // constructor

  /**
   * Switches models: shuts the current one down, makes the next, initialises
   * it and lays it out.
   *
   * @param {string} model - 'BootModel' or 'GameModel'.
   */
  setModel(model) {
    var needResizeApp = false;
    if (this.model) {
      this.model.shutdown();
      needResizeApp = true;
    }
    switch (model) {
      case 'BootModel':
        this.model = new BootModel(this, {nextModel: 'GameModel'});
        break;
      case 'GameModel':
        this.model = new GameModel(this);
        break;
    } // switch
    this.model.init();
    if (needResizeApp) {
      this.resizeApp();
    }
  } // setModel

} // MainApp
