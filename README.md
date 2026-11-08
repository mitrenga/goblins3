# goblins3

Browser remake of **Goblins Quest 3** (Coktel Vision, DOS, 1993) on the svision
library, VGA platform 320x200 in 256 colours, mouse-driven. The brief and
the fidelity target are in `ZADANI.md`, the milestones in `MILNIKY.md`, the
format findings in `NOTES.md` (all three in Czech, as the project's working
documents are).

The game is driven by its TOT bytecode scripts; the remake runs the original
scripts through an interpreter shared by all three Gobliiins, which lives in
its own checkout and is symlinked here as `app/coktel` (decision R-030 in
`../DECISIONS.md`). Builds on Gobliins 2 (`../gobliins2/`) and through it
Gobliiins 1; the interpreter is `v3`. One goblin (Blount) who transforms and
gains companions; the largest of the three, with IMD videos.

## Status

**It opens in a browser, runs the game's own scripts and answers the mouse.**
The interpreter is a generator that suspends wherever the original waits for
the player, so the app advances it one frame at a time and feeds it the mouse
and the keyboard in between. The intro plays through — titles, music, the
animated logo — and hands over to `MENU.TOT`, which is the game's main loop.

It runs as the **American** edition, so the text is English and there is no
copy protection. Neither is a patch: the engine tells every script which
language it is in, and `DEMO.TOT` asks `if (language != AMERICAN)` before
drawing its colour grid — the Sierra US release simply did not have one.

It gets as far as the first room — the pirate ship — drawn whole, with the
control panel along the bottom and the character's name in it.

**Where it stops:** the goblins do not walk. They stand in the right place in
the right pose, the room's own animations run, and a click reaches
`o2_moveGoblin` — but the path-finding over the map is not written, so nobody
goes anywhere. That was found by running the thing and was not in the G4
milestone's list.

What is done:

| milestone | state |
|---|---|
| M0 sources | done — ScummVM `engines/gob`, both editions' archives, manual and hint book |
| G1 unpacker | done — 172 members round-tripped, 0 differences |
| G2 asset decoders | done **except its acceptance** — 1163 assets, 0 differences, but `matchscreen` has no DOSBox screenshot to measure against |
| G3 interpreter | done **except its acceptance** — see below |
| G4 game loop | done **except its acceptance** — drawing, cursor, hotspots, text windows, scenery, `mult` animation, IMD video, the map and the sub-script stack all run, and the game reaches its first room; the goblins do not move yet |

G3 reads the scripts: 19 918 blocks and 49 739 commands across all 39 of
them, 99.97% of the bytecode, 62 468 expressions evaluated, 0 differences
(`checktot --evaluate`). Its acceptance, `matchtot`, needs an opcode log from
the reference engine and exits with code 2 until there is one.

G4 runs them. `runtot` executes 120 445 commands with 0 differences between
the run and the disassembly (fingerprint `0987b751`); `rendertot` draws 39
screens with 19 193 drawing operations and no errors; `playtot` — the test
flight — plays the game frame by frame against a written-down player, gets
from `INTRO` through `DEMO` and `MENU` into the first room, and comes out with
fingerprint `2c2ce664`. None of those is an acceptance either:
they prove the engine agrees with itself, not that it agrees with the
original. That needs the golden records `sources/media/README.md` asks for.

Both open acceptances need something from the operator; what exactly is in
`MILNIKY.md` and `sources/media/README.md`.

## Original data

The game needs the archives of a legally bought copy (GOG). Put them into
`assets/original/` — the list and the edition check are in
`assets/original/README.md`. They never enter the repository.

## Running

Like every svision project: `index.php` → `app/svision/php/main.php`, with
`config/config.php` holding `$devMode = true`. **No build step** — in dev mode
the sources are served as they are.

The game fetches `assets/original/floppy/*.STK` at run time and reads them
with the same code the tools use, so it runs on the original data rather than
on anything prepared for it. Without those files it says so on the screen.

What happens: the game's own title screen comes up — the picture `DEMO.TOT`
draws, decoded out of the archives — and the archives load behind it. It
stays five seconds, or until a click, a key or a touch, whichever is first.
Then the Coktel Vision logo appears the way `init.cpp` draws it, `INTRO.TOT`
runs, and the game opens its first room.

`DEMO.TOT` itself is **not run**: it is the same title screen again, and with
the copy protection off it has only one way out, which is `MENU.TOT` — so
`MENU.TOT` is loaded in its place (`GameModel.SKIP`). `playtot --skip
DEMO=MENU` flies the same path.

There is **no MS-DOS boot**. The other VGA remakes here type a period-correct
one at a text screen; this one shows the title instead (operator,
2026-09-14), which is also the only useful thing to look at while eight
megabytes of archive arrive.

`R` starts the chain again, `B` goes back to the title. There is no status
line: the game draws its own control panel across the foot of the screen, and
anything of ours would sit on top of it. Faults still appear there, because a
black screen that says nothing is worse; everything else goes to the console.

## Tools

| tool | what it does |
|---|---|
| `tools/stklib.mjs` | the archive format and its LZ codec — reader, packer, type table (G1) |
| `tools/dumpstk.mjs` | unpacks the `.STK`/`.ITK` archives of one edition into `data/<edition>/stk/` with a manifest, and identifies file types — G1 |
| `tools/checkstk.mjs` | round-trip of the LZ unpacker/packer over every member — the G1 acceptance check |
| `tools/assetlib.mjs` | what is inside a script: resource tables, both sprite formats, palettes, SND, texts (G2) |
| `tools/imdlib.mjs` | the IMD video container and its frames (G2) |
| `tools/dumpassets.mjs` | every script's sprites to PNG, palettes to PNG + JSON, samples to WAV, texts to JSON, the videos to PNG frames — G2 |
| `tools/checkassets.mjs` | reads the dumped assets back and compares them with the archives — the part of G2 that can be proved without DOSBox |
| `tools/renderscreen.mjs` | paints a screen through `VGAVideoRAM` + `VGAPalette` to PNG — G2 |
| `tools/matchscreen.mjs` | compares a rendered screen with a DOSBox screenshot — the G2 acceptance |
| `tools/totlib.mjs` | the glue between an edition's archives and the shared interpreter in `app/coktel` (G3) |
| `tools/checktot.mjs` | walks every script's bytecode and checks each block ends where it says; `--evaluate` cross-checks the expression evaluator — the part of G3 that can be proved without a recording |
| `tools/tracetot.mjs` | writes each script out as a listing and as data (`data/<edition>/tot/`) — G3 |
| `tools/runtot.mjs` | **runs** the scripts without a browser, checks the run against the disassembly, prints a fingerprint — G3 |
| `tools/hostlib.mjs` | the one host the offline tools give the interpreter — two hosts would be two different games (G4) |
| `tools/rendertot.mjs` | runs a script and photographs the screen it drew, as a PNG `matchscreen` can compare — G4 |
| `tools/playtot.mjs` | **plays** the game frame by frame with a written-down player (`tools/flights/*.txt`); `--skip FROM=TO` follows the path the app really takes — the test flight, G4 |
| `tools/checkadl.mjs` | plays every piece of AdLib music through the OPL2: does the command stream close, and does the chip make a sound? — G5 |
| `tools/matchtot.mjs` | compares our reading with an opcode log from the reference engine — the G3 acceptance |

Every tool takes `--edition floppy|cd` (default `floppy`, the only edition
being worked on); the `dump*` ones take `--list` to print what they would do
without writing anything. `data/` is the operator's game data in another
shape and is not in the repository (`.gitignore`).

To see one screen (as a PNG on disk, not in a browser):

    node tools/dumpstk.mjs                 # the archives -> data/floppy/stk/
    node tools/dumpassets.mjs              # the assets   -> data/floppy/assets/
    node tools/renderscreen.mjs --spec tools/screens/coktel.spec.json
    node tools/matchscreen.mjs             # needs sources/media/screens/floppy/

To see what the scripts say and do:

    node tools/checktot.mjs --evaluate     # does every block close? 0 differences
    node tools/tracetot.mjs                # listings -> data/floppy/tot/*.txt
    node tools/runtot.mjs --script INTRO   # run it: 9 commands, then it asks for DEMO.tot

To play it without a browser:

    node tools/rendertot.mjs               # 39 screens -> data/floppy/screens/scripts/
    node tools/playtot.mjs --frames 4000 --shot data/floppy/screens
    node tools/playtot.mjs --language BRITISH --plan tools/flights/protection.txt \
        --shot data/floppy/screens          # the copy-protection screen, which
                                            # the default (American) skips

A flight plan is one instruction a line — `wait N`, `move X Y`,
`click X Y [button]`, `key NAME` — read one per frame. The clock is a frame
counter and `rand()` is seeded, so two flights give the same fingerprint.

`tools/screens/*.spec.json` describe a screen — a palette, a background and
the sprites over it — and are the input both to rendering and to matching.

## Sources

`sources/README.md` — where from, when, with which hash. The ScummVM gob
engine is in `sources/reference/gob/`; the Sierra US 1994 manual and hint
book (scans from sierragamers.com) with their transcripts are in
`sources/docs/`.
