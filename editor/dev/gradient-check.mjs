/*
 * gradient-check.mjs — a person can make a gradient, and it reaches the movie.
 *
 * The compiler's own tests prove that a document holding a gradient compiles and that the
 * matrix is right; the golden render proves the pixels. None of them touch the question this
 * one asks, which is whether the gestures exist at all. A compiler that emits a fill nothing
 * in the editor can author is a feature only its tests can use.
 *
 * The gesture is not the one you would guess, and guessing wrong is why this check exists.
 * Dragging the gradient tool across a shape does nothing — the tool targets on *click* and
 * seeds a two-stop ramp from the fill the shape already has, so at that moment the document
 * is unchanged and the shape still looks solid. It becomes a gradient when a handle moves,
 * and it becomes a *visible* gradient when a stop is recoloured, because both stops start
 * the same colour. Three gestures, and the first two are invisible.
 *
 * The colour has to arrive as a CSS string. `stopColor` assigns straight through to a paper.js
 * item's `fillColor`, and paper coerces an object it does not recognise to black rather than
 * refusing it — so passing a `Wick.Color` here produces a red-to-black ramp that looks like a
 * compiler bug and is not one. dev/make-fixture.mjs carries the same warning for the same
 * reason. WickInput's colour row emits `rgba(...)`, which is why the real UI is fine.
 *
 *   node dev/gradient-check.mjs
 *   node dev/gradient-check.mjs --headed
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

/* The path's fill, as the compiler will find it. A gradient arrives as a reference into the
   export's dictionary, which is also why `json[0]` stops being the class name. */
const fill = () => page.evaluate(() => {
  const p = window.editor.project.activeFrame.paths[0];
  if (!p) return null;
  const json = p.json;
  const props = typeof json[0] === 'string' ? json[1] : json[1][1];
  return props ? props.fillColor : null;
});

/* Canvas coordinates are not page coordinates: the stage sits below the menu bar and the
   toolbar, and the toolbar's height is not a constant any more. */
const onScreen = (pick) => page.evaluate((which) => {
  const tool = window.editor.project.activeTool;
  const box = document.querySelector('#wick-canvas-container').getBoundingClientRect();
  const point = which === 'destination'
    ? tool._destination.position
    : tool._colorStops[tool._colorStops.length - 1].position;
  const view = window.paper.view.projectToView(point);
  return [Math.round(view.x + box.left), Math.round(view.y + box.top)];
}, pick);

const drag = async (from, to) => {
  await page.mouse.move(...from);
  await page.mouse.down();
  await page.mouse.move(...to, { steps: 14 });
  await page.mouse.up();
  await page.waitForTimeout(700);
};

/* ---- draw something solid to start from ------------------------------------------------ */

await page.locator('#tool-button-rectangle').first().click();
await page.waitForTimeout(200);
await page.evaluate(() => window.editor.setToolSetting('fillColor', new window.Wick.Color('#ef4a2f')));
await drag([450, 300], [700, 500]);
const solid = await fill();
record('a-rectangle-starts-solid', Array.isArray(solid) && typeof solid[0] === 'number',
  `fillColor is ${JSON.stringify(solid)}`);

/* ---- the three gestures ----------------------------------------------------------------- */

await page.locator('#tool-button-gradienttool').first().click();
await page.waitForTimeout(400);
await page.mouse.click(575, 400);
await page.waitForTimeout(600);

const targeted = await page.evaluate(() => {
  const tool = window.editor.project.activeTool;
  return { type: tool && tool.selectionType, hasTarget: !!(tool && tool.target),
           stops: tool && tool._colorStops ? tool._colorStops.length : 0 };
});
record('clicking-targets-the-shape',
  targeted.hasTarget && targeted.type === 'gradientfill' && targeted.stops === 2,
  `the tool reports ${targeted.type} with ${targeted.stops} stops`);

// Still solid, which is correct and is the thing that makes this feature hard to find.
const afterClick = await fill();
record('targeting-alone-changes-nothing',
  JSON.stringify(afterClick) === JSON.stringify(solid),
  'the document is untouched until a handle moves');

const handle = await onScreen('destination');
await drag(handle, [handle[0] - 60, handle[1] + 90]);
const dragged = await fill();
record('moving-a-handle-makes-it-a-gradient',
  Array.isArray(dragged) && dragged[0] === 'gradient',
  `fillColor is now ${JSON.stringify(dragged).slice(0, 60)}`);

const stop = await onScreen('stop');
await page.mouse.click(...stop);
await page.waitForTimeout(500);
const recoloured = await page.evaluate(() => {
  const tool = window.editor.project.activeTool;
  if (tool.selectionType !== 'gradientstop') return `selected ${tool.selectionType}`;
  // A CSS string, not a Wick.Color — see the header.
  tool.stopColor = 'rgba(100,182,223,1)';
  return 'ok';
});
await page.waitForTimeout(700);

const stops = await page.evaluate(() => {
  const p = window.editor.project.activeFrame.paths[0];
  const table = p.json[0][1];
  const entry = table[Object.keys(table)[0]];
  return entry[1].map((s) => s[0]);
});
record('a-stop-can-be-recoloured',
  recoloured === 'ok' && stops.length === 2
  && JSON.stringify(stops[0]) !== JSON.stringify(stops[1]),
  `${recoloured}; the ramp runs ${JSON.stringify(stops[0])} to ${JSON.stringify(stops[1])}`);

/* ---- and it reaches the movie ------------------------------------------------------------ */

const compiled = await page.evaluate(async () => {
  const bytes = await new Promise((resolve) =>
    window.Wick.WickFile.toWickFile(window.editor.project, (file) =>
      file.arrayBuffer().then((b) => resolve(new Uint8Array(b))), 'blob'));
  const { blob, skipped } = await window.editor.compileWickToSWF(bytes);
  const head = new Uint8Array(await blob.slice(0, 3).arrayBuffer());
  return { size: blob.size, skipped, signature: String.fromCharCode(...head) };
});
record('the-gradient-reaches-the-movie',
  ['FWS', 'CWS'].includes(compiled.signature) && compiled.skipped === '',
  `${compiled.size} bytes of ${compiled.signature}, nothing reported skipped`);

record('no-page-errors', errors.length === 0, errors.slice(0, 3).join(' | ') || 'clean');

await browser.close();

for (const r of results) console.log(`${(r.ok ? 'ok' : 'FAIL').padEnd(5)} ${r.name.padEnd(36)} ${r.detail}`);
const broke = results.filter((r) => !r.ok);
if (broke.length) {
  console.error(`\n${broke.length} failing: ${broke.map((r) => r.name).join(', ')}`);
  process.exit(1);
}
console.log('\nok — a gradient can be drawn, and what is drawn is what compiles');
