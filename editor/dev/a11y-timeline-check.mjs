/*
 * a11y-timeline-check.mjs — the timeline can be driven and read without a mouse or eyes.
 *
 * The timeline is a <canvas>, and a canvas is empty as far as assistive technology is
 * concerned. TimelineMirror.jsx puts the same model into a focusable DOM grid beside it, and
 * the whole of that idea rests on things a screenshot cannot show: that the grid exists, that
 * it announces true things, that arrow keys move it, and that moving it moves the playhead the
 * canvas draws. Each of those is a case below.
 *
 * The mirror is a second representation of a model the canvas also renders, which is the
 * standing risk with this approach: it can drift, and drift is silent. So the cases check the
 * mirror against the ENGINE, not against a fixture — cell text is compared to the frames the
 * model holds, and the cursor is compared to the playhead after the keys have moved it. A
 * mirror that stops matching fails here rather than in someone's ears.
 *
 * `announces-real-frames` is the one that would catch the subtle version. A grid that renders
 * but labels every cell "keyframe" would pass a smoke test, pass an axe scan, and be useless.
 *
 *   node dev/a11y-timeline-check.mjs
 *   node dev/a11y-timeline-check.mjs --headed
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

const grid = page.locator('[role="grid"][aria-label="Timeline frames"]');
const cells = grid.locator('[role="gridcell"]');
const playhead = () => page.evaluate(() => window.editor.project.activeTimeline.playheadPosition);
const activeLayer = () => page.evaluate(() => window.editor.project.activeTimeline.activeLayerIndex);

/*
 * Three layers of different lengths, which is where the empty space in a timeline actually
 * comes from. A hole in the MIDDLE of a layer is not constructible: Layer.addFrame calls
 * resolveGaps and the engine closes it. What is ordinary is a layer that stops early — layer
 * two ends at 4 while the document runs to 12 — and a layer holding nothing at all, which is
 * what every layer looks like the moment it is created.
 */
await page.evaluate(() => {
  const p = window.editor.project;
  const t = p.activeTimeline;
  while (t.layers.length < 3) t.addLayer(new window.Wick.Layer());
  t.layers[0].frames[0].end = 12;
  t.layers[1].addFrame(new window.Wick.Frame({ start: 1, end: 4 }));
  p.guiElement.draw();
  window.editor.projectDidChange({ actionName: 'fixture' });
});
await page.waitForTimeout(900);

record('grid-exists', (await grid.count()) === 1,
  `${await grid.count()} grid beside the canvas, ${await cells.count()} cells`);

const counts = await grid.evaluate((g) => ({
  rows: g.getAttribute('aria-rowcount'),
  cols: g.getAttribute('aria-colcount'),
}));
const model = await page.evaluate(() => {
  const t = window.editor.project.activeTimeline;
  return { layers: t.layers.length, length: t.length };
});
record('counts-match-the-model',
  Number(counts.rows) === model.layers && Number(counts.cols) === model.length,
  `grid says ${counts.rows}x${counts.cols}, model has ${model.layers} layers over ${model.length} frames`);

/*
 * Every cell's text against the frame it claims to be. aria-colindex is the playhead position
 * the cell starts at, so the model can be asked directly what lives there.
 */
const mismatches = await page.evaluate(() => {
  const t = window.editor.project.activeTimeline;
  const bad = [];
  const rows = [...document.querySelectorAll('[role="grid"][aria-label="Timeline frames"] [role="row"]')];
  rows.forEach((rowEl, i) => {
    const layer = t.layers[i];
    for (const cell of rowEl.querySelectorAll('[role="gridcell"]')) {
      const at = Number(cell.getAttribute('aria-colindex'));
      const width = Number(cell.getAttribute('aria-colspan'));
      const said = cell.textContent.trim();
      const frame = layer.getFrameAtPlayheadPosition(at);
      if (!frame) {
        if (!said.startsWith('empty')) bad.push(`row ${i} col ${at}: model has no frame, cell says "${said}"`);
        continue;
      }
      if (said.startsWith('empty')) { bad.push(`row ${i} col ${at}: model has a frame, cell says "${said}"`); continue; }
      if (frame.start !== at) bad.push(`row ${i}: cell starts at ${at}, frame starts at ${frame.start}`);
      if (frame.end - frame.start + 1 !== width) bad.push(`row ${i} col ${at}: colspan ${width}, frame is ${frame.end - frame.start + 1} long`);
      const wants = frame.contentful ? 'drawing keyframe' : 'blank keyframe';
      if (!said.startsWith(wants)) bad.push(`row ${i} col ${at}: says "${said}", frame is ${wants}`);
    }
  });
  return bad;
});
record('announces-real-frames', mismatches.length === 0,
  mismatches.slice(0, 4).join(' | ') || 'every cell names the frame the engine actually holds, gaps included');

/* Empty space is a cell, or the part of the timeline with nothing in it is silent. Layer two
 * runs out at 4 and layer three was never given a frame at all. */
const gapCells = await page.evaluate(() => [...document.querySelectorAll('[role="gridcell"]')]
  .filter((c) => c.textContent.trim().startsWith('empty'))
  .map((c) => c.textContent.trim()));
record('empty-space-is-a-cell',
  gapCells.some((t) => /frames 5 to 12/.test(t)) && gapCells.some((t) => /frames 1 to 12/.test(t)),
  gapCells.length ? `${gapCells.length} empty cell(s): ${gapCells.join(' / ')}` : 'the empty parts of the timeline are not in the grid');

/* Arrow keys, and the playhead that has to follow them. Row two is the one with somewhere to
 * go sideways: a frame to 4, then the empty rest of the document. */
await page.locator('[data-cell="1:0"]').focus();
await page.waitForTimeout(200);
const startedAt = await playhead();
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(250);
const afterRight = await playhead();
await page.keyboard.press('ArrowDown');
await page.waitForTimeout(250);
const afterDown = await activeLayer();
record('arrows-drive-the-playhead', afterRight === 5 && startedAt === 1 && afterDown === 2,
  `right moved the playhead ${startedAt} -> ${afterRight} (onto the empty span), down moved the active layer to ${afterDown}`);

/* Focus has to actually be on a cell, or none of the above reaches a screen reader. */
const focused = await page.evaluate(() => {
  const el = document.activeElement;
  return el ? { role: el.getAttribute('role'), text: el.textContent.trim(), tab: el.tabIndex } : null;
});
record('focus-lands-on-a-cell', focused && focused.role === 'gridcell' && focused.tab === 0,
  focused ? `focus is on a ${focused.role} reading "${focused.text}"` : 'nothing is focused');

/* Enter on empty space selects nothing, which is the correct amount. Focus is sitting on the
 * empty tail of a short layer after the arrows above, so this costs nothing to check. */
await page.keyboard.press('Enter');
await page.waitForTimeout(400);
const afterEmptyEnter = await page.evaluate(() => window.editor.project.selection.getSelectedObjects().length);
record('enter-on-empty-is-inert', afterEmptyEnter === 0,
  `Enter over an empty span left ${afterEmptyEnter} object(s) selected`);

/* Enter on a frame selects, and the engine has to agree that it did. */
await page.locator('[data-cell="0:0"]').focus();
await page.waitForTimeout(200);
await page.keyboard.press('Enter');
await page.waitForTimeout(600);
const selected = await page.evaluate(() => {
  const s = window.editor.project.selection;
  return { types: s.getSelectedObjects().map((o) => o.classname), said: document.querySelector('[role="status"]')?.textContent?.trim() };
});
record('enter-selects-the-frame', selected.types.includes('Frame') && !!selected.said,
  `selection holds ${selected.types.join(', ') || 'nothing'}; status region says "${selected.said || ''}"`);

/* Navigating is not editing. One undo state per arrow key would bury the history. */
const undoBefore = await page.evaluate(() => window.editor.project.history.numUndoStates);
await page.keyboard.press('ArrowLeft');
await page.keyboard.press('ArrowRight');
await page.keyboard.press('ArrowUp');
await page.waitForTimeout(400);
const undoAfter = await page.evaluate(() => window.editor.project.history.numUndoStates);
record('navigating-is-not-editing', undoBefore === undoAfter,
  `three arrow keys left the undo history at ${undoAfter} state(s)`);

record('no-page-errors', errors.length === 0, errors.join(' | ') || 'clean');

await browser.close();

for (const r of results) console.log(`${(r.ok ? 'ok' : 'FAIL').padEnd(5)} ${r.name.padEnd(26)} ${r.detail}`);
const broke = results.filter((r) => !r.ok);
if (broke.length) {
  console.error(`\n${broke.length} failing: ${broke.map((r) => r.name).join(', ')}`);
  process.exit(1);
}
console.log('\nok — the timeline answers to a keyboard');
