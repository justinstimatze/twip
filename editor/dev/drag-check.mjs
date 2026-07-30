/*
 * drag-check.mjs — the Outliner still reorders, and its drag preview is a real image.
 *
 * Nothing dragged an Outliner row before this. The panel is the only place in the editor where
 * a drag *changes the document* rather than moving a file in, and it was carried entirely by
 * whoever last tried it by hand.
 *
 * The second half exists because a comment in OutlinerObject.jsx claimed for a long time that
 * the seven PNGs there could not be replaced — that setDragImage takes a loaded <img> and no
 * data URI would do. The first part is true and the second was never tested. It is tested here,
 * on the app's own drawing rather than a copy of it: the row's inline <svg> is lifted out of
 * the DOM, given the width, height and resolved colour that iconDataUri adds, and loaded into
 * an Image. `naturalWidth > 0` is exactly the property setDragImage needs.
 *
 * What this cannot check is whether the OS actually paints that ghost under the cursor. There
 * is no way to screenshot a native drag image from Playwright, so the claim stops at "the
 * image the browser was handed is a loaded, dimensioned one" and does not pretend further.
 *
 *   node dev/drag-check.mjs
 *   node dev/drag-check.mjs --headed
 *
 * Env: SMOKE_URL (default http://localhost:3000), PLAYWRIGHT_CHANNEL (see dev/browser.mjs).
 */
import { launch, URL_ } from './browser.mjs';

const headed = process.argv.includes('--headed');
const browser = await launch({ headless: !headed });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const errors = [];
const pngRequests = [];
page.on('pageerror', (e) => errors.push(`[uncaught] ${e.message}`));
page.on('request', (r) => { if (/object-icons\/.*\.png/.test(r.url())) pngRequests.push(r.url()); });

await page.goto(URL_, { waitUntil: 'networkidle', timeout: 60_000 });
await page.waitForFunction(() => window.editor && window.editor.project, null, { timeout: 30_000 });
await page.waitForTimeout(2500);

const results = [];
const record = (name, ok, detail) => { results.push({ name, ok, detail }); };

/* Three named layers, so a reorder is visible in the document rather than inferred from pixels. */
await page.evaluate(() => {
  const t = window.editor.project.activeTimeline;
  while (t.layers.length < 3) t.addLayer(new window.Wick.Layer());
  t.layers.forEach((l, i) => { l.name = `L${i}`; });
});
await page.waitForTimeout(600);

// The Outliner ships collapsed, so every row below is behind this button.
await page.locator('.outliner-expand-button').first().click();
await page.waitForTimeout(1200);

const rows = page.locator('.outliner-object');
const rowCount = await rows.count();
record('rows-render', rowCount >= 3, `${rowCount} rows for 3 layers`);

/*
 * The mechanism the old comment ruled out. Same envelope iconDataUri writes: explicit width and
 * height so the image has intrinsic dimensions, and a resolved colour because a data URI is its
 * own document and inherits nothing.
 */
const preview = await page.evaluate(async () => {
  const svg = document.querySelector('.outliner-object svg');
  if (!svg) return { error: 'no icon in any row' };
  const color = getComputedStyle(document.documentElement).getPropertyValue('--color-content').trim();
  const markup = svg.outerHTML
    .replace('<svg ', `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" color="${color}" `)
    .replace(/stroke="currentColor"/, `stroke="${color}"`);
  const uri = `data:image/svg+xml,${encodeURIComponent(markup)}`;
  const img = new Image();
  const loaded = await new Promise((resolve) => {
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = uri;
    setTimeout(() => resolve(false), 5000);
  });
  return { loaded, w: img.naturalWidth, h: img.naturalHeight, bytes: uri.length, color };
});
record('preview-loads',
  !preview.error && preview.loaded && preview.w > 0 && preview.h > 0,
  preview.error || `${preview.w}x${preview.h} from a ${preview.bytes}-byte data URI in ${preview.color}`);

record('no-png-previews', pngRequests.length === 0,
  pngRequests.length ? pngRequests.join(', ') : 'nothing asked for object-icons/*.png');

/*
 * A real reorder. Playwright's dragTo dispatches the HTML5 drag sequence react-dnd's backend
 * listens for; the assertion is on the document's own layer order afterwards, because a row
 * that moves visually while the timeline underneath disagrees is the failure worth catching.
 *
 * Wick counts layers with 0 frontmost, so dropping the top row onto a lower one sends it down.
 */
const before = await page.evaluate(() => window.editor.project.activeTimeline.layers.map((l) => l.name));
const nameOf = async (i) => (await rows.nth(i).textContent()).trim();
const dragged = await nameOf(0);
await rows.nth(0).dragTo(rows.nth(rowCount - 1));
await page.waitForTimeout(900);
const after = await page.evaluate(() => window.editor.project.activeTimeline.layers.map((l) => l.name));
record('reorder-lands',
  before.join() !== after.join() && after.length === before.length,
  `dragged ${dragged}: ${before.join(',')} -> ${after.join(',')}`);

record('no-page-errors', errors.length === 0, errors.join(' | ') || 'clean');

await browser.close();

for (const r of results) {
  console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name.padEnd(17)} ${r.detail}`);
}
if (results.some((r) => !r.ok)) process.exit(1);
