/*
 * library-check.mjs — the asset library is a grid of pictures, and a keyboard can cross it.
 *
 * docs/ui-research.md lists "library-as-list → thumbnail grid with search" among the tells.
 * The search half already existed; what a list could not do is the thing this checks first.
 * Five images named DSC_0413, DSC_0414, frame_07 are one column of near-identical text and
 * five distinguishable pictures, so an-image-shows-itself is the case the whole change is
 * for: the tile has to hold the asset's own bytes, not an icon standing in for them.
 *
 * The other half is the keyboard, and it has a trap worth naming. A listbox conventionally
 * moves selection with focus — but selecting here goes through projectDidChange, which pushes
 * an undo state, so arrowing across ten assets that way would leave ten entries in the history
 * that changed nothing. Focus and selection are separate for that reason and
 * arrowing-is-not-selecting is the case that would notice them being rejoined.
 *
 * Column count is deliberately never asserted. The tiles are auto-fill at a 64px floor, so how
 * many fit is a function of the width the panel was dragged to; what has to be true is that
 * there IS more than one column and that Down lands on the tile below rather than the next one
 * along, which is checked by geometry rather than by arithmetic on a number nobody stores.
 *
 *   node dev/library-check.mjs
 *   node dev/library-check.mjs --headed
 *
 * Env: SMOKE_URL (default http://localhost:3000), PLAYWRIGHT_CHANNEL (see dev/browser.mjs).
 */
import { launch, URL_ } from './browser.mjs';

const browser = await launch({ headless: !process.argv.includes('--headed') });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`[uncaught] ${e.message}`));

await page.goto(URL_, { waitUntil: 'networkidle', timeout: 60_000 });
await page.waitForFunction(() => window.editor && window.editor.project, null, { timeout: 30_000 });
await page.waitForTimeout(2500);

const results = [];
const record = (name, ok, detail) => results.push({ name, ok, detail });

const tiles = page.locator('[role="option"]');
const undoStates = () => page.evaluate(() => window.editor.project.history.numUndoStates);

/*
 * Five images with camera-and-sprite-sheet names, one of them transparent in the corners, and
 * a sound. Drawn in a canvas rather than shipped as fixtures so each is a distinct picture and
 * the test can say which tile should be which colour.
 */
await page.evaluate(async () => {
  const png = (name, colour, transparent) => {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const g = c.getContext('2d');
    if (!transparent) { g.fillStyle = colour; g.fillRect(0, 0, 32, 32); }
    g.fillStyle = colour;
    g.beginPath(); g.arc(16, 16, 11, 0, Math.PI * 2); g.fill();
    return new Promise((r) => c.toBlob((b) => r(new File([b], name, { type: 'image/png' }))));
  };

  /* 8-bit mono WAV, 100 samples of silence — the smallest thing the engine will take as a
     SoundAsset. Sounds are the kind that CANNOT show a picture, which is half the point. */
  const wav = () => {
    const data = new Uint8Array(44 + 100);
    const v = new DataView(data.buffer);
    const ascii = (at, s) => [...s].forEach((ch, i) => v.setUint8(at + i, ch.charCodeAt(0)));
    ascii(0, 'RIFF'); v.setUint32(4, 36 + 100, true); ascii(8, 'WAVEfmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, 8000, true); v.setUint32(28, 8000, true);
    v.setUint16(32, 1, true); v.setUint16(34, 8, true);
    ascii(36, 'data'); v.setUint32(40, 100, true);
    data.fill(128, 44);
    return new File([data], 'blip.wav', { type: 'audio/wav' });
  };

  const files = await Promise.all([
    png('DSC_0413.png', '#ef4a2f', false),
    png('DSC_0414.png', '#2f9ecf', false),
    png('frame_07.png', '#8bc8a0', false),
    png('frame_08.png', '#f2b54a', false),
    png('cutout.png', '#a62914', true),
  ]);
  files.push(wav());
  await new Promise((resolve) => {
    window.editor.createAssets(files, [], resolve);
    setTimeout(resolve, 10_000);
  });
});
await page.waitForTimeout(2000);

/* More than one column, and the container says what it is. */
const shape = await page.evaluate(() => {
  const list = document.querySelector('[role="listbox"][aria-label="Assets"]');
  if (!list) return { error: 'no listbox' };
  const items = Array.from(list.querySelectorAll('[role="option"]'));
  const rows = new Set(items.map((t) => Math.round(t.getBoundingClientRect().top)));
  const firstRow = items.filter((t) =>
    Math.round(t.getBoundingClientRect().top) === Math.min(...rows));
  return {
    count: items.length,
    rows: rows.size,
    columns: firstRow.length,
    stops: items.filter((t) => t.tabIndex === 0).length,
    draggable: items.filter((t) => t.getAttribute('draggable') === 'true').length,
  };
});
record('a-grid-not-a-list',
  !shape.error && shape.columns > 1 && shape.rows > 1 && shape.stops === 1
  && shape.draggable === shape.count,
  shape.error || `${shape.count} assets in ${shape.columns} columns over ${shape.rows} rows, `
  + `${shape.stops} tab stop, all ${shape.draggable} still drag sources`);

/*
 * The case the grid is for. Each image tile has to hold that image's own bytes and have
 * decoded them — a broken <img> and a correct one differ only in naturalWidth.
 */
const pictures = await page.evaluate(() => {
  const byName = {};
  document.querySelectorAll('[role="option"]').forEach((tile) => {
    const name = tile.getAttribute('title');
    const img = tile.querySelector('img');
    byName[name] = img
      ? { drawn: img.naturalWidth > 0, w: img.naturalWidth, src: img.src.slice(0, 22) }
      : { drawn: false, icon: !!tile.querySelector('svg') };
  });
  const bed = document.querySelector('[role="option"] > div');
  return { byName, checker: getComputedStyle(bed).backgroundImage !== 'none' };
});
const images = ['DSC_0413.png', 'DSC_0414.png', 'frame_07.png', 'frame_08.png', 'cutout.png'];
record('an-image-shows-itself',
  images.every((n) => pictures.byName[n] && pictures.byName[n].drawn)
  && images.every((n) => pictures.byName[n].src.startsWith('data:image')),
  images.map((n) => `${n}:${pictures.byName[n] ? pictures.byName[n].w + 'px' : 'missing'}`).join(' ')
  + ` — each from its own ${pictures.byName[images[0]].src}… , on a checked bed: ${pictures.checker}`);

/* A sound has no picture to show, and the tile has to say so rather than show a broken one. */
const sound = await page.evaluate(() => {
  const tile = Array.from(document.querySelectorAll('[role="option"]'))
    .find((t) => t.getAttribute('title') === 'blip.wav');
  if (!tile) return { error: 'no sound tile' };
  return { img: !!tile.querySelector('img'), icon: !!tile.querySelector('svg'),
    label: tile.getAttribute('aria-label') };
});
record('a-sound-shows-its-kind',
  !sound.error && !sound.img && sound.icon && /sound/.test(sound.label),
  sound.error || `no <img>, an icon instead, and it announces itself as "${sound.label}"`);

/*
 * Arrows move focus across the grid — and Down has to find the tile BELOW, which is what
 * separates a grid from a list wrapped onto several lines.
 */
await tiles.first().focus();
const before = await undoStates();
/* Read the order off the panel rather than predicting it: which name sorts where is the
 * library's business, and asserting a guess at it would make this case fail for a reason that
 * has nothing to do with arrow keys. */
const order = await page.evaluate(() =>
  Array.from(document.querySelectorAll('[role="option"]')).map((t) => t.getAttribute('title')));
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(200);
const right = await page.evaluate(() => document.activeElement.getAttribute('title'));
await page.keyboard.press('ArrowLeft');
await page.keyboard.press('ArrowDown');
await page.waitForTimeout(200);
const down = await page.evaluate(() => {
  const tile = document.activeElement;
  const first = document.querySelector('[role="option"]');
  const a = first.getBoundingClientRect();
  const b = tile.getBoundingClientRect();
  return { title: tile.getAttribute('title'), sameColumn: Math.abs(a.left - b.left) < 2,
    lower: b.top > a.top };
});
record('arrows-walk-the-grid',
  right === order[1] && down.sameColumn && down.lower && down.title !== order[1],
  `from ${order[0]}: right went to ${right} (the next tile along), down went to ${down.title} `
  + `— same column, next row, not merely the next in the list`);

/*
 * And walking is not selecting. A listbox that moved the selection with focus would have spent
 * an undo state per keypress here, since selecting goes through projectDidChange.
 */
record('arrowing-is-not-selecting',
  (await undoStates()) === before
  && (await page.evaluate(() => window.editor.getSelectionType())) === 'unknown',
  `three arrow keys left the history at ${await undoStates()} state(s) and the selection empty`);

/* Enter is what selects, and selecting is what reveals what you can do with it. */
await page.keyboard.press('Enter');
await page.waitForTimeout(600);
const picked = await page.evaluate(() => ({
  type: window.editor.getSelectionType(),
  selected: (document.querySelector('[role="option"][aria-selected="true"]') || {}).title,
  action: (document.querySelector('#asset-action-add') || {}).textContent,
}));
record('enter-selects-and-offers',
  picked.type === 'imageasset' && picked.action === 'Add to Canvas',
  `selection is a ${picked.type} ("${picked.selected}") and the footer offers "${picked.action}"`);

/* The verb follows the kind: a sound has no place on the canvas. */
await page.evaluate(() => {
  const tile = Array.from(document.querySelectorAll('[role="option"]'))
    .find((t) => t.getAttribute('title') === 'blip.wav');
  tile.click();
});
await page.waitForTimeout(600);
record('a-sound-goes-to-the-frame',
  (await page.evaluate(() => (document.querySelector('#asset-action-add') || {}).textContent))
    === 'Add to Frame',
  `with a sound selected the footer offers "${await page.evaluate(() => (document.querySelector('#asset-action-add') || {}).textContent)}"`);

/* And the button does what it says. */
await page.evaluate(() => {
  const tile = Array.from(document.querySelectorAll('[role="option"]'))
    .find((t) => t.getAttribute('title') === 'DSC_0413.png');
  tile.click();
});
await page.waitForTimeout(500);
const pathsBefore = await page.evaluate(() => window.editor.project.activeFrame.paths.length);
await page.locator('#asset-action-add').click();
await page.waitForTimeout(1200);
const pathsAfter = await page.evaluate(() => window.editor.project.activeFrame.paths.length);
record('add-to-canvas-adds-it',
  pathsAfter === pathsBefore + 1,
  `the frame went from ${pathsBefore} to ${pathsAfter} path(s)`);

/*
 * Filtering shortens the list under a focus index that outlives it. An index past the end
 * leaves every tile at tabIndex -1 — a grid the Tab key cannot enter, which looks like
 * nothing being wrong at all.
 */
await page.evaluate(() => {
  const tiles = document.querySelectorAll('[role="option"]');
  tiles[tiles.length - 1].focus();
});
await page.keyboard.press('End');
await page.waitForTimeout(300);
await page.locator('#asset-library-filter-input').fill('DSC');
await page.waitForTimeout(700);
const filtered = await page.evaluate(() => {
  const items = Array.from(document.querySelectorAll('[role="option"]'));
  return { count: items.length, stops: items.filter((t) => t.tabIndex === 0).length };
});
record('filtering-does-not-strand-the-grid',
  filtered.count === 2 && filtered.stops === 1,
  `"DSC" left ${filtered.count} tiles and ${filtered.stops} tab stop`);

await page.locator('#asset-library-filter-input').fill('');
await page.waitForTimeout(500);

record('no-page-errors', errors.length === 0, errors.slice(0, 3).join(' | ') || 'clean');

await browser.close();

for (const r of results) console.log(`${(r.ok ? 'ok' : 'FAIL').padEnd(5)} ${r.name.padEnd(33)} ${r.detail}`);
const broke = results.filter((r) => !r.ok);
if (broke.length) {
  console.error(`\n${broke.length} failing: ${broke.map((r) => r.name).join(', ')}`);
  process.exit(1);
}
console.log('\nok — the library shows what it holds, and a keyboard can cross it');
