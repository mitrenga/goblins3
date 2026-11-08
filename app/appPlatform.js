const { VGAPlatform } = await import('./svision/js/platform/canvas2D/vga/vgaPlatform.js?ver='+window.srcVersion);
// begin code

/**
 * The machine Goblins Quest 3 ran on: a PC with a VGA card in mode 13h on a
 * 4:3 monitor — 320x200 pixels shown 1.2 times taller than wide, and a border
 * that is always black because no game of this kind ever set the overscan
 * register (R-029).
 */
export function appPlatform() {
  return new VGAPlatform({
    width: 320,
    height: 200,
    pixelAspect: 1.2,
    minimalBorder: 0
  });
} // appPlatform
