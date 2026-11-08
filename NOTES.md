# NOTES.md — poznatky o formátech a vnitřnostech

Převzato z prvního dílu (`../gobliiins/NOTES.md`) 2026-09-14; tady se doplňuje to, co je ve verzi `v3` jinak. Společné věci opravovat **v obou** souborech, dokud není sdílené místo. Každý údaj má zdroj; `★` značí nález
ověřený na skutečných datech nebo na běžícím originálu, bez značky je to
přepis ze ScummVM, zatím neověřený. Co je ověřené u G1, ověřovaly
`tools/dumpstk.mjs` a `tools/checkstk.mjs` nad oběma edicemi.

Zdroj, není-li uvedeno jinak: `sources/reference/gob/`, commit `e5758226`.

## Edice Goblins 3 (`detection/tables_gob3.h`) ★

ScummVM zná **38 edic** Goblins 3 podle MD5 **prvních 5000 B** `intro.stk`
(`AD_ENTRY1s`): 25× AdLib, 11× CD (řeč), 2× bez AdLibu; platformy 28× DOS,
7× Windows, 2× Amiga, 1× Macintosh. Naše dvě (ověřeno na datech,
`sources/docs/original_files.md`):

| edice | `intro.stk` | řádek tabulky | rysy |
|---|---|---|---|
| `floppy` | 157 084 B, MD5 `32b0f57f…` | 36 („v1.00", EN_GRB, DOS) | AdLib (`GOB3x.ADL`), bez řeči, 41 IMD |
| `cd` | 612 482 B, MD5 `c3e9132e…` | 341–404 („CD v1.02", EN/DE/FR/IT/ES) | CD řeč (`USGOB3.ITK`), hudba CD audio (`MUS_GOB3.LIC`), 45 IMD |

Obě jsou VGA; remake dělá obě, hráč volí při startu (`MILNIKY.md`).

## STK / ITK archiv (`dataio.cpp`)

Little-endian. Tabulka souborů na začátku:

```
u16  fileCount
fileCount × {
  char name[13]      jméno ve tvaru 8.3, nulou ukončené
  u32  size          velikost v archivu (u komprimovaných: zabalená)
  u32  offset        od začátku archivu
  u8   compression   0 = surové, jinak 1; ITK (v2+) může mít 2
}
```

★ Ověřeno na obou edicích Goblins 3 (G1, `tools/dumpstk.mjs`): položka má
22 B, tabulka končí přesně tam, kde začíná první tělo. Příznak komprese je
v Goblins 3 **jen 0 nebo 1** — `compression 2` tu není nikde (viz níž).

Komprimovaný soubor začíná `u32 size` (rozbalená velikost, u compression 1),
pak proud LZ s **oknem 4096 B** (`unpackChunk`):

- `cmd` je 8bitová maska čtená po bajtu, bit 1 = doslovný bajt, bit 0 =
  kopie z okna;
- kopie: 2 bajty `tmp1, tmp2` → `off = tmp1 | ((tmp2 & 0xF0) << 4)`,
  `len = (tmp2 & 0x0F) + 3`;
- okno je předplněné mezerami (0x20), zápisový index začíná na 4078;
- rozšířený tvar začíná magickými `0x1234 0x5678`: index 273 a `len == 18`
  znamená `len = dalšíBajt + 18` (řetězce až 274 B).
- compression 2: data po **chuncích** `u16 chunkSize, u16 realSize, u16`
  (nevyužité), pak proud; `chunkSize` se počítá od konce svého vlastního
  `u16` k dalšímu chunku (další chunk je na `pos + chunkSize + 2`),
  `0xFFFF` je poslední. ★ **V Goblins 3 se nevyskytuje** — ani v `.ITK`.
  Poznámka „ITK (v2+) může mít 2" byla nepřesná: ScummVM skládá každý
  nenulový příznak na 1 a dvojku si nasazuje samo jen u Geishiných `.0OT`.
- ★ Rozšířený tvar s magickými `0x1234 0x5678` **v kompresi archivu nikde
  není** — všech 82 zabalených souborů diskety i 41 CD je prostý tvar. Uvnitř
  **spritu** ale je: `COKTEL.IMS` (logo Coktel Vision, první obrazovka hry)
  je v obou edicích jediný soubor, který ho používá (G2, prohledané obě
  edice). Obojí je napsané i přečtené — `tools/checkstk.mjs --extended
  --chunked`.
- ★ **Je to jeden a týž kodek na třech místech**: komprese souboru v archivu,
  sprite `01 02 01` a `deLZ77` snímku videa IMD. Liší se jen to, co je před
  proudem (u archivu `u32` velikost, u spritu `01 02 01` + `u32`, u videa
  `u32`). Proto `tools/stklib.mjs` obsluhuje všechny tři.

To je varianta LZSS, jakou používal i Coktelův `COMP` nástroj; round-trip
test G1 = rozbalit → zabalit vlastním packerem → rozbalit → shodné bajty
(shodu zabalených bajtů s originálem nečekat, packer může volit jinak).

## TOT skript (`totfile.cpp`, `script.cpp`)

Hlavička **128 B**:

```
[39] '0'+versionMajor, [40] '.', [41] '0'+versionMinor
u32  variablesCount
u32  textsOffset, u32 textsSize
u32  resourcesOffset, u32 resourcesSize
u16  animDataSize
u8   imFileNumber, u8 exFileNumber, u8 communHandling   ([59], [60], [61])
u16  functions[14]      vstupní body (init, hotspots …), od offsetu 100
```

★ **`scriptEnd` není políčko hlavičky** — engine si ho spočítá jako menší
z `textsOffset` a `resourcesOffset` (a velikost souboru, když ani jedno
není). Bytecode končí tam.

★ Offsety z `totfile.cpp`: `[39] '0'+major`, `[40] '.'`, `[41] '0'+minor`,
`u32 variablesCount` na 44, `u32 textsOffset` na 48, `u32 resourcesOffset`
na 52, `u16 animDataSize` na 56, `[59] imFileNumber`, `[60] exFileNumber`,
`[61] communHandling`, `functions[14]` od 100 po `u16`. ★ Všech 39 skriptů
disketové edice hlásí **verzi 1.3** a `variablesCount` 7916. Za hlavičkou bytecode;
texty a zdroje (obrázky, palety) na svých offsetech, případně ve vedlejších
souborech `.EXT` (`exFileNumber`) a `.IM` (`imFileNumber`).

## Interpretr (`inter.cpp`, `inter_v1.cpp`) ★

Čtyři tabulky opcode: `OPCODEVER` (řízení: skoky, podmínky, smyčky,
proměnné), `OPCODEDRAW` (kreslení, palety, sprity), `OPCODEFUNC` (funkce
včetně načtení TOT, hotspotů, zvuku), `OPCODEGOB` (goblini — chování
postav). Výrazy vyhodnocuje `expression.cpp` (zásobníkový evaluátor,
proměnné 8/16/32 bit a řetězce). Gobliiins 1 = `Inter_v1`; `v2`/`v3` přidávají
a přepisují položky tabulek — proto jeden interpretr pro všechny tři díly.
Přepsané do `app/coktel/js/` (R-030); ověřené na datech nástrojem
`tools/checktot.mjs`.

### Bajt příkazu ★

Jeden bajt, ale rozdělený nesouměrně (`Inter::funcBlock`):

```
horní půlbajt 0..11   →  rodina 0, opcode = horní půlbajt        (0x00..0x0B)
horní půlbajt 12..15  →  rodina = 16 − horní půlbajt,
                          opcode = dolní půlbajt                  (0x40..0x4F,
                                                                   0x30..0x3F,
                                                                   0x20..0x2F,
                                                                   0x10..0x1F)
```

Index do tabulky je `rodina * 16 + opcode`. U rodiny 0 se dolní půlbajt
**zahazuje** — a scénáře v něm nic nemají, jinak by se to poznalo.

### Blok ★

Dva druhy, `Inter::callSub` je rozlišuje prvním bajtem.

**Blok příkazů** (typ 1) — hlavička 4 bajty: `u8 typ`, `u8 početPříkazů`,
`u16 velikost`. Velikost se počítá **od svého vlastního políčka**, takže celý
blok je `velikost + 2` bajtů od začátku hlavičky. Z toho plyne kontrola, na
které stojí `checktot.mjs`: rozebrání `početPříkazů` příkazů musí skončit
přesně na `začátek + velikost + 2`.

**Blok hotspotů** (typ 2, `Hotspots::evaluate`) — **velikost nedeklaruje**.
Hlavička je `u8 typ`, `u8 početHotspotů` a 6 bajtů parametrů (handleMouse,
trvání, dva indexy, příznak přepočtu); blok končí posledním popisem hotspotu.
Každý popis nese své bloky „enter" a „leave" **uvnitř sebe**.

Blok vnořený do příkazu (`if`, `while`, `repeat`, větev `switch`) je vždycky
blok příkazů: `funcBlock` na typový bajt **vůbec nekouká**, jen ho přeskočí.

### Za blokem `if` je vždycky značka ★

`o1_if` přeskočí blok „then" a pak **přečte jeden bajt**. Když má horní
půlbajt 12, následuje blok „else" a přeskočí se taky; jinak se ten bajt
zahodí. Takže za každým „then" blokem jeden bajt je, i když žádné „else"
není — jinak by se `funcBlock` rozsynchronizoval.

V datech disketové edice má ta značka **jen dvě hodnoty**: `0x00` (8343×,
žádné „else") a `0xC0` (587×, „else" následuje). `0xC0` je rodina 4,
opcode 0 — políčko, které v tabulce opcode prázdné je, takže se značka
nedá splést s příkazem.

`o1_repeatUntil` je symetrický: mezi tělem cyklu a podmínkou leží
**jeden bajt** (`seek(blockPos + size + 1)`). `o1_whileDo` ne — tam jde
podmínka před tělem a za tělem nic není.

`o1_switch`: skupiny `i8 počet` + tolik hodnot + blok; `-5` končí. Hodnota je
buď holá imediátní konstanta (token + hodnota + terminátor 99 = 3/4/6 bajtů),
nebo celý výraz. Za posledním `-5` může být blok „default", poznaný podle
horního půlbajtu **4** (ne 12 jako u `if`).

### Kde operandy nečte tělo opcode ★

Past, kterou samotné čtení `inter_v*.cpp` neodhalí — opcode zavolá metodu
jiné třídy a **ta** si ze skriptu bere dál:

| opcode | kdo čte | co |
|---|---|---|
| `o1_freeAnim` (draw 0x11), `o1_freeStatic` (0x1B) | `Scenery::freeAnim/freeStatic(-1)` | výraz s indexem |
| `o1_loadStatic` (0x1A) | `Scenery::loadStatic` | výraz, `i16 velikost` + `velikost*2` B, `i16 počet`, `i16 resource`, pak `počet` × 8 B |
| `o1_loadAnim` (0x10) | `Scenery::loadAnim` | totéž bez tabulky pozadí |
| `o1_loadMult` (0x00) | `Mult_v2::loadMult` | počty statiků, animací a zvuků jsou **v resource**, ne v bytecode |
| `o2_loadMapObjects` (0x50) | `Map_v2::loadMapObjects` | `varIndex`, `i16 id`; pro `id < 65520` ještě `i16 počet` + seznam zvuků |
| `o1_freeSoundSlot` (0x3B) | `Game::freeSoundSlot(-1)` | výraz se slotem |

`Mult_v2::loadMult` je jediné místo, kde se **bez resource skript rozebrat
nedá** — proto `ScriptWalker` bere resolver zdrojů a bez něj u toho opcode
skončí a řekne, který zdroj chtěl, místo aby hádal.

### `loadSound` má dva tvary ★

`Inter_v2::loadSound(search)` slouží dvěma volajícím a čte pokaždé něco
jiného:

- `search == 0` (opcode `o2_loadSound`) — slot si pojmenuje skript:
  **výraz**, pak `i16 id`
- `search == 1` (seznam zvuků v `mult` a v mapě) — slot si najde engine sám:
  **jen `i16 id`**

V obou případech `id == -1` znamená, že zvuk je soubor a jeho jméno je
následujících **9 bajtů**. Zaměnit ta dvě volání je rozdíl mezi blokem,
který se uzavře, a skriptem, který se od toho místa rozebírá na nesmysl.

### `o2_animPalInit` čte dva výrazy, ne šest ★

Tři větve podle znaménka indexu, každá čte tytéž **dva** výrazy —
tvar operandů je `i16` + 2 výrazy, stejně jako v `v1`.

### `palLoad` je jediný opcode závislý na stroji ★

Velikost operandu `o1_palLoad` závisí na video režimu a počtu barev, ne na
bytecode. V režimu 13h s 256 barvami (R-029) vychází pevně: 1 bajt příkazu +
{48: 48 B, 49: 18, 50: 16, 51: 2, 52: 48, 53: 2, 54: 0, 55: 2, 56: 2,
61: 4, jinak 0}. Horní bit příkazu je příznak „neaplikovat hned", ne součást
čísla. EGA edice by tuhle tabulku měla jinou.

### Konec souboru ★

Za posledním blokem bytecode leží jeden bajt **`0x1A`** — terminátor souboru
z dob CP/M. Je to jediné, co ve všech 39 skriptech zůstane nepokryté, když
se projdou všechny dosažitelné bloky.

## Zdroje skriptu (`resources.cpp`) ★

Skript si říká o zdroj číslem: **pod 30000** je jeho vlastní (tabulka v TOT),
**od 30000** je zdroj jeho `.EXT` (číslo mínus 30000).

Tabulka v TOT, na `resourcesOffset`:

```
i16  itemsCount
u8   unknown
itemsCount × { i32 offset, u16 size, i16 width, i16 height }
data na resourcesOffset + 3 + itemsCount*10 + offset
```

`offset < 0` znamená, že zdroj leží v `COMMUN.IM<n>` a políčko je jeho index
tam (`index = -offset - 1`). ★ **Goblins 3 žádný IM soubor nemá** — všechny
skripty mají `communHandling = 2` a `imFileNumber = 0`, což je právě ta
kombinace, při které engine IM nenačítá.

Tabulka v `.EXT` / `.EX<n>`, od začátku souboru:

```
i16  itemsCount
u8   unknown
itemsCount × { i32 offset, u16 size, u16 width, u16 height }
data od 3 + itemsCount*10
```

Dvě zvláštnosti: **nejvyšší bit `width` (0x8000) znamená, že je zdroj
zabalený** LZ; a protože `size` je jen 16bitové, bity 0x4000/0x2000/0x1000
`width` nesou vyšší bity velikosti (+1, +2, +4 × 65536) a při `height == 0`
je `width` rovnou horní polovina velikosti. Skutečná šířka je `width & 0xFFF`.
`offset < 0` znamená sdílený `COMMUN.EX<n>` (`offset = -offset - 1`), jinak
vlastní `.EXT`. Jméno EX souboru je `COMMUN.EX` + číslice `exFileNumber`;
disketa má jen `COMMUN.EX1`.

Texty: při `textsOffset == 0` jsou v jazykovém souboru `<jméno>.<přípona>`
(`ANG` angličtina, `DAT` francouzština, `ALL` němčina, `ESP`, `ITA`, `USA`),
jinak uvnitř TOT. Tabulka je `i16 itemsCount & 0x3FFF`, pak
`{ i16 offset, i16 size }` na položku. ★ Disketa má 36 souborů `.ANG`, CD
pět jazykových sad po 36.

★ Naměřeno na disketě (G2, `tools/dumpassets.mjs`): 39 skriptů, 55 palet,
275 spritů, 792 samplů SND a 337 zdrojů, které se bez interpretru nedají
zařadit — jsou to popisy scenérie, kousků a scén, které si `Scenery` a `Mult`
čtou napůl ze zdroje a napůl **z proudu skriptu**. Patří k G3.

## Grafika

- ★ **Sprity mají dva tvary** a engine je pozná podle prvních bajtů
  (`video_v2.cpp`, `video.cpp`):
  - **256 barev**: `01 02 tvar`. `tvar == 02` je holý rastr `width*height`
    hned za hlavičkou; `tvar == 01` je `u32` (engine si jím počítá, nám ho
    nahradí `width*height`) a pak týž LZ proud jako v archivu. Na disketě
    181 zdrojů.
  - **16 barev, RLE** (`Video::drawPacked`) — bez hlavičky: bajt, v bitech
    4–7 barva 0–15, bit 3 říká „krátký běh" (délka `(b & 7) + 1`, 1–8),
    jinak se přidá druhý bajt a délka je `((b & 7) << 8 | next) + 1`.
    Běhy přetékají přes konce řádků. Na disketě 94 zdrojů, hlavně ikony
    control panelu 16×16 a některá pozadí 320×200.
  Barva 0 je průhledná, když se sprite kreslí přes něco.
- Palety: ★ zdroj o 768 bajtech = 256 × `r, g, b` po 6 bitech (0–63) →
  `VGAPalette.load()`. Fade přes `palanim.cpp`. Na disketě 55 palet,
  typicky jedna na obrazovku.
- ★ **První obrazovka hry** není skript: `init.cpp` načte paletu
  `COKTEL.CLT` a sprite `COKTEL.IMS` (320×200, LZ v rozšířeném tvaru),
  vykreslí na 0,0 a udělá fade. CD edice místo toho pouští `COKTEL.IMD`.
  Renderuje se `tools/renderscreen.mjs --spec tools/screens/coktel.spec.json`.
- Animace: `.ANI` (`anifile.cpp`), scény `.MUL` + `mult.cpp` (v1: `mult_v1.cpp`).
  ★ Goblins 3 **žádné samostatné `.ANI` ani `.MUL` nemá** — ty jsou až engine
  v4 a výš. Scenérie i `mult` jsou obyčejné zdroje skriptu, viz níž.

### Scenérie a `mult` (`scenery.cpp`, `mult.cpp`, `mult_v2.cpp`) ★

Místnost ani postava nejsou obrázek. Jsou to **kusy** vyřezané z několika
velkých spritových listů a tabulka, která říká, co kam patří:

```
kusy    zdroj o size/8 položkách: i16 left, right, top, bottom
statika i16 počet vrstev, pak i16 offset na každou
        vrstva: i16 backResId, i16 planeCount, pak planeCount × 8 B
                u8 pictIndex, u8 pieceIndex, u8 drawOrder,
                i16 destX, i16 destY, i8 transp
animace i16 počet vrstev, pak i16 offset na každou
        vrstva: i16 unknown0, posX, posY, animDeltaX, animDeltaY,
                i8 transp, i16 framesCount, pak běhy po 5 B
                u8 pictIndex, u8 pieceIndex, i8 destX, i8 destY, i8 notFinal
```

- ★ **Snímek animace je běh kusů**, který končí tam, kde `notFinal` přestane
  být 1 — takže se počet kusů nedá zjistit jinak než projitím.
- ★ **Horní čtyři bity `pictIndex` jsou vyšší bity posunů** (`0xC0` → +128
  do x, `0x30` → +128 do y), aby kus dosáhl dál, než unese `i8`. Vlastní
  index obrázku jsou spodní čtyři bity minus jedna.
- ★ **Seznam obrázků není ve zdroji, ale v bytecode** — hned za opcodem
  `loadStatic`/`loadAnim`: 8 B na obrázek (zdroj kusů, šířka, výška, zdroj
  spritu). `loadStatic` má před tím ještě tabulku pozadí, jedno na vrstvu,
  a ta **přebíjí** `backResId` ze zdroje. Proto se scenérie nedá vytáhnout
  bez skriptu, který ji načítá (nález G2, dořešeno u G4).
- ★ **`mult`** je časová osa: `i8 staticCount-1`, `i8 animCount-1` (nejvyšší
  bit `staticCount` = mult nese i videa), pak 14 B na scenérii, `i16
  frameRate`, statické klíče, **čtyři** proudy animačních klíčů po 10 B
  (`u16 frame`, `i16 layer, posX, posY, order`), 5×16 barev prolínaček,
  klíče palety, textů, zvuků a videí. Textové a zvukové klíče mají navíc
  24 B výplně, **když mult videa nenese**.
- ★ **Stav pohyblivého objektu leží v bloku proměnných**, ne v enginu:
  35 bajtů `Mult_AnimData` (`animation, layer, frame, animType, order,
  isPaused, isStatic, maxTick, …`), a `loadMultObject` do prvních jedenácti
  píše po jednom výrazu — bajt 99 znamená „tenhle nech být". Proto se do nich
  dívá i skript a proto se nedají cachovat.
- ★ **`animType` je celý slovník smyček**: 0 znovu od začátku, 1 znovu
  a posuň o `animDelta` (to je chůze), 2 přepni na jinou animaci, 3 a 4 stůj,
  5 zestatičti, 6 a 7 drž poslední snímek, 100 a 101 „o tohle se stará
  goblin".
- ★ **Překreslování jde přes sdílený obdélník** `toRedraw*`: `updateAnim`
  ho zvětšuje o to, co nakreslila (nebo jen naměřila, když `doDraw` není),
  a `updateStatic(order + 1)` podle něj vrátí scenérii, která stojí před
  objektem. Plocha 22 (`kAnimSurface`) drží scénu **bez pohyblivých věcí**
  a maže se z ní.
### Video IMD (`video/coktel_decoder.cpp`, staženo u G2) ★

Hlavička 18 B, pak paleta:

```
u16 handle (0)   u8 version   u8 features   u16 frameCount
i16 defaultX, defaultY, width, height        u16 flags   u16 firstFramePos
768 B palety (6bitové složky)
version ≥ 3: u16 počet standardních souřadnic (0 nebo 1), při 1 i16 x,y,w,h
version ≥ 4: u32 pozice tabulky offsetů snímků
features & 0x80: u32 pozice tabulky souřadnic snímků
features & 0x20: doporučená velikost bufferu (2 nebo 10 B)
features & 0x40: i16 soundFreq, sliceSize, slicesCount
```

Snímek je posloupnost příkazů `u16`: `0xFF00`/`0xFF01` zvukový řez,
`0xFFF4` nová paleta, `0xFFFD` skok, `0xFFFC` (nebo rovnou délka) blok
obrazu. Blok začíná typem: bit 4 = 16 registrů palety napřed, bit 7 = zbytek
je LZ (`deLZ77` = náš `unpack(…, 1)`). Typy 0x02 celé řádky, 0x42 každý bajt
na 4 pixely, ostatní `& 0x0F == 0x02` poloviční svislé rozlišení, 0x01
a zbytek běhy s dírami (bajt s nejvyšším bitem = tolik pixelů dat, bez něj
= tolik pixelů se nemění). Souřadnice v souboru jsou vůči `defaultX/Y`.

★ Naměřeno na disketě: **41 videí**, verze 2 (4×) a 4 (37×), od 48×47 po
320×200, 2 až 75 snímků, **žádné se zvukem** (řeč je jen na CD). Mezi poli,
která engine přečte, a `firstFramePos` bývá 0, 8, 12 nebo 14 bajtů, na které
se engine nikdy nepodívá — místo rezervované pro pole, která ta verze
nepoužívá; význam těch 12 u souborů s `features = 0x20` zatím neznámý.
- ★ **`IMD.LTK` není archiv** (jen na disketě, CD ho nemá). Začíná stejným
  `u16` počtem (41) jako `IMD.ITK`, ale položka je `char name[8]`,
  `u32 offset`, `u32 size` — offsety míří do `IMD.ITK` — a za tabulkou leží
  hlavičky IMD i s tabulkami offsetů snímků. Je to předpočítaný index videí;
  rozebere se u G2 spolu s dekodérem.

## Proměnné, které engine nastaví před každým skriptem ★

`Game::playTot` je zapisuje **před každým** TOT, ne jednou na začátku, a
skripty na tom stojí — první příkaz `INTRO.TOT` je `var8_4931 = var_16`:

| proměnná | co v ní je |
|---|---|
| 13 | `useMouse` (1) |
| 14 | `soundFlags` — `MIDI 0x4000 \| ADLIB 0x08 \| BLASTER 0x04 \| SPEAKER 0x01` |
| 15 | `fakeVideoMode` (0x13 v režimu 13h) |
| 16 | **jazyk** |

Plus `renewTimeInVars()` (proměnné 5–11).

★ **Proměnná 16 má dva významy** a oba jsou původní: engine do ní tady dá
jazyk a pak ji **používá znovu** jako „který hotspot se právě řeší"
(`Hotspots::setCurrentHotspot`). Skript, který chce jazyk, ji čte dřív než
jakýkoli blok hotspotů — což `INTRO.TOT` dělá.

★ **Jazyky** (`global.h`): 0 francouzština, 1 němčina, **2 britská
angličtina**, 3 španělština, 4 italština, **5 americká angličtina**,
6 nizozemština, 7 korejština, 8 hebrejština, 9 portugalština, 10 japonština.
Nenastavená šestnáctka je nula, čili **francouzština** — a přesně tak nám
remake anglické edice chvíli mluvil francouzsky, než se tyhle čtyři zápisy
doplnily.

## Ochrana proti kopírování (disketová edice) ★

Disketová edice v1.00 **ochranu má**, přestože manuál Sierra US 1994 žádnou
neuvádí. Zjištěno u G4 tím, že na ni dojela vlastní hra
(`tools/playtot.mjs`): `INTRO.TOT` → `DEMO.TOT` ukáže osm barevných políček
nahoře a otázku v textovém okně dole („Consult the colour chart in the box and
type the number corresponding with the colour of the space"), vykreslenou
`printTotText`. Jejím fontem je `PROT.LET` — jediné, k čemu se ten font
v edici používá.

★ **Ochranu vypíná sám skript, podle jazyka.** `DEMO.TOT` má nad celým
blokem `if (var8_4931 != 5)`, a pětka je **americká angličtina** — takže
Sierra US release ochranu opravdu neměl a jeho manuál nelže. Tabulka je
uvnitř skriptu, ne v datech: 41 řetězců `var_6950`.. drží zakódovanou
barevnou kartu, `rand(9)*4` a `rand(10)` z ní vyberou políčko, správná
barva vyjde jako `(bajt+3 & 112)/16` a osm hotspotů nahoře porovnává klik
s ní. Dva pokusy, pak `loadTot("END")`.

**Remake běží jako americká edice** — tím je text anglicky a ochrana se
nekoná, obojí původním přepínačem, bez sahání do bytecode.

## Zvuk (`sound/`)

- **SND** (`sounddesc.cpp`) ★: 6 B hlavičky — `u32` big-endian, jehož horní
  bajt je příznak a **dolní tři bajty délka**, pak frekvence big-endian `u16`
  na offsetu 4 (minimálně 4700 Hz), pak **signed 8bitové samply** →
  `PCMSample.fromSigned8`. Na disketě 792 samplů, 4700–20752 Hz (4700 je ta
  podlaha, ne skutečná frekvence).
  ★ **Signed, ne unsigned — tady to bylo napsané špatně až do G5.** Engine je
  čte jako `(int8)` (`SoundMixer::getData`), takže ticho je 0 a rozsah
  −128..127, ne unsigned 0..255 s tichem na 128, jak to má osmibitový WAV.
  Změřeno na 141 samplech edice: **19 % bajtů leží do čtyř od nuly, 1,6 %
  poblíž 128**, nejčastější hodnoty jsou 1, 3, 2, 4, 253, 255. Přečtené jako
  unsigned je každý z nich rozbitý — a přesně tak to znělo.
  **Proč to prošlo tak dlouho:** `checkassets` je round-trip a dump
  i porovnání používaly *totéž* špatné čtení. Round-trip dokazuje, že je
  dekodér v souladu **sám se sebou**, nikdy že je správně. Autoritou je
  reference a data, ne shoda nástroje se sebou.
- **ADL** (`adlplayer.cpp`): Coktelův formát pro AdLib — timbry (parametry
  operátorů) + stopy s příkazy; přehrávač píše registry OPL2, prodlevy jsou
  v **milisekundách**. ★ Čip je ze svision (`js/audio/chip/opl2.js`), ovladač
  je náš (`app/coktel/js/adl.js`) — hotový, ověřený `tools/checkadl.mjs`
  (8 skladeb, 136 696 zápisů, 0 rozdílů). ★ **Není to totéž co
  `svision/js/audio/chip/adlibMidi.js`**: ten hraje standardní MIDI plus
  tabulku nástrojů po 16 bajtech (formát Prince of Persia). Coktel má vlastní
  timbry i vlastní proud příkazů; sdílený je čip, ne ovladač.
- **PC speaker** (`pcspeaker.cpp`) — efekty pro edice bez AdLibu.

## Co je ve verzi `v3` jinak ★

- **Videa IMD/VMD** — dekodér je mimo `engines/gob` (`video/coktel_decoder.*`),
  stažený u G2 do `sources/reference/video/`. Chunkovaná komprese 2 se v datech
  neukázala (viz výš).
- Jeden goblin (Blount), který se proměňuje a získává společníky; nejrozsáhlejší díl, videa IMD → `goblin_v3.cpp`.
- **Tabulky opcode: `v3` je proti `v2` velmi malá delta** (`inter_v3.cpp`,
  115 řádků včetně hlavičky):
  - `OPCODEDRAW` — **beze změny**, `Inter_v3::setupOpcodesDraw()` jen zavolá
    `v2`.
  - `OPCODEFUNC` — tři přepsané položky, **žádná nemění tvar operandů**:
    `0x22 o3_speakerOn` (obchází krátké pípnutí kroků), `0x23 o3_speakerOff`
    (ignoruje vypnutí po tom pípnutí), `0x32 o3_copySprite` (navíc
    `sparseRetrace` kvůli „prolínání" detailů v CD edici).
  - `OPCODEGOB` — **nahrazuje, nedědí**: `Inter_v3::setupOpcodesGob()`
    nevolá `v2` ani `v1`, takže z tabulky zbývá jen
    `0 o2_loadInfogramesIns`, `1 o2_startInfogrames`, `2 o2_stopInfogrames`,
    `10 o2_playInfogrames` (všechny `i16`) a `100 o3_wobble` (bez operandu).
    Všechno, co dílu 1 a 2 chodilo přes `goblinFunc` (stavy goblinů, mapa,
    předměty), je pryč.
- **Neznámý gob opcode není chyba.** `Inter::executeOpcodeGob` u položky, kterou
  tabulka nemá, přeskočí `početParametrů * 2` bajtů a jen varuje. Protože je
  tabulka `v3` skoro prázdná, je to běžná cesta, ne výjimka — a `o2_goblinFunc`
  navíc pro `cmd == 101` nečte **vůbec nic** dalšího.
- **`Inter_v3` je pořád `Draw_v2`, `Mult_v2`, `Map_v2`, `Scenery`** — kreslení
  se v `v3` nemění.
