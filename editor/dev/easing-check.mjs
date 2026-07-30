/*
 * easing-check.mjs — the drawn curve is the curve that plays.
 *
 * A graph editor has an obvious failure mode that looks fine on screen: the handles move, the
 * line redraws, and the motion the movie plays is something else. Two things have to be true
 * for it not to be decorative. The curve has to reach the tween the engine interpolates with,
 * and the tween has to reach the file. Both are cases below, and the second one is checked by
 * serializing the project and reading the JSON, because that is what the compiler will read.
 *
 * The other half is the divergence. `bezier` is a field the upstream wickeditor.com engine has
 * never written, so every .wick that exists today lacks it — and one that lacks it must open
 * and ease exactly as it did. `an-old-tween-still-opens` builds a tween the old way, with no
 * bezier at all, and asks the engine what it draws.
 *
 *   node dev/easing-check.mjs
 *   node dev/easing-check.mjs --headed
 *
 * Env: SMOKE_URL (default http://localhost:3000), PLAYWRIGHT_CHANNEL (see dev/browser.mjs).
 */
import { readFile } from 'node:fs/promises';
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

/*
 * A clip with two keys twelve frames apart, then select the first tween — which is what puts
 * the graph in the Inspector. Built through the engine because drawing it by hand is
 * dev/autokey-check.mjs's job.
 */
await page.evaluate(() => {
  const p = window.editor.project;
  const f = p.activeFrame;
  f.end = 24;
  const path = new window.Wick.Path({
    json: ['Path', { segments: [[-40, -40], [40, -40], [40, 40], [-40, 40]], closed: true,
      fillColor: [0.2, 0.5, 0.9], strokeWidth: 0 }],
  });
  f.addPath(path);
  path.x = 100;
  path.y = p.height / 2;
  p.activeTimeline.playheadPosition = 1;
  f.createTween();
  p.activeTimeline.playheadPosition = 13;
  f.clips[0].transformation.x = 500;
  f.createTween();
  p.activeTimeline.playheadPosition = 1;
  p.selection.clear();
  p.selection.select(f.tweens.find((t) => t.playheadPosition === 1));
  window.editor.projectDidChange({ actionName: 'easing fixture' });
});
await page.waitForTimeout(1200);

const graph = page.locator('svg[aria-label^="Easing curve"]');
const readout = page.locator('[data-curve]');
const handles = graph.locator('circle[role="button"]');

/* Handles belong to a Bézier, and a named easing is not one — its stored control points sit
 * somewhere unrelated to the line being drawn, so showing them would put two draggable dots
 * next to a curve they do not touch. The graph is there from the start; the handles arrive
 * with "Edit as curve". */
record('the-graph-is-there',
  (await graph.count()) === 1 && (await handles.count()) === 0,
  `${await graph.count()} graph, ${await handles.count()} control points while the easing is named, readout says "${await readout.first().textContent()}"`);

/* A named easing plots as itself. out-back leaves the unit square, and the graph has to draw
 * that rather than clip it — the plotted band runs past 1 for exactly this. */
await page.evaluate(() => {
  window.editor.project.selection.easingType = 'out-back';
  window.editor.projectDidChange({ actionName: 'named' });
});
await page.waitForTimeout(800);
const plotted = await graph.evaluate((svg) => {
  const points = svg.querySelector('polyline').getAttribute('points').split(' ').map((p) => Number(p.split(',')[1]));
  const box = svg.querySelector('rect');
  return { highest: Math.min(...points), unitTop: Number(box.getAttribute('y')) };
});
record('a-named-curve-plots-as-itself',
  plotted.highest < plotted.unitTop - 0.5,
  `out-back's overshoot is drawn ${(plotted.unitTop - plotted.highest).toFixed(1)} units above the top of the unit square, not flattened onto it`);

/* "Edit as curve" hands the named shape over to the handles. */
await page.locator('#inspector-button-edit-curve').first().click();
await page.waitForTimeout(800);
const afterEdit = await page.evaluate(() => {
  const t = window.editor.project.selection.getSelectedObjects('Tween')[0];
  return { easingType: t.easingType, bezier: t.bezier };
});
record('edit-as-curve-switches-over',
  afterEdit.easingType === 'custom' && Array.isArray(afterEdit.bezier) && (await handles.count()) === 2,
  `easingType ${afterEdit.easingType}, bezier [${afterEdit.bezier}], ${await handles.count()} handles now on the graph`);

/* Dragging a handle. The assertion is not that the handle moved — it is that the tween the
 * engine will interpolate with holds the new curve. */
const before = await page.evaluate(() => window.editor.project.selection.getSelectedObjects('Tween')[0].bezier.slice());
const box = await graph.boundingBox();
const first = await handles.first().boundingBox();
await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width * 0.24, box.y + box.height * 0.30, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(800);
const after = await page.evaluate(() => window.editor.project.selection.getSelectedObjects('Tween')[0].bezier.slice());
record('dragging-a-handle-changes-the-tween',
  after.some((n, i) => Math.abs(n - before[i]) > 0.02),
  `[${before.map((n) => n.toFixed(2))}] -> [${after.map((n) => n.toFixed(2))}]`);

/* And the curve is what the engine actually eases with. A tween whose first control point was
 * just dragged up and left has to be AHEAD of linear at the same moment. */
const eased = await page.evaluate(() => {
  const t = window.editor.project.selection.getSelectedObjects('Tween')[0];
  return { curve: window.Wick.Tween.sampleEasing('custom', t.bezier, 0.5), linear: 0.5, bezier: t.bezier };
});
record('the-engine-eases-with-it', Math.abs(eased.curve - eased.linear) > 0.02,
  `at the halfway point the curve is at ${eased.curve.toFixed(3)} where linear is 0.5`);

/* Keyboard, because a handle only a mouse can reach is a handle half the people who need
 * precision cannot use. */
await handles.first().focus();
const keyBefore = await page.evaluate(() => window.editor.project.selection.getSelectedObjects('Tween')[0].bezier.slice());
await page.keyboard.press('ArrowRight');
await page.keyboard.press('ArrowUp');
await page.waitForTimeout(600);
const keyAfter = await page.evaluate(() => window.editor.project.selection.getSelectedObjects('Tween')[0].bezier.slice());
record('arrows-move-a-handle',
  Math.abs(keyAfter[0] - keyBefore[0] - 0.02) < 1e-6 && Math.abs(keyAfter[1] - keyBefore[1] - 0.02) < 1e-6,
  `right then up moved x by ${(keyAfter[0] - keyBefore[0]).toFixed(3)} and y by ${(keyAfter[1] - keyBefore[1]).toFixed(3)}`);

/* Auto-smooth reads the segment's position in the motion. This tween is the first of two, so
 * it both starts from rest and ends at one — ease in and out. */
await page.locator('#inspector-button-smooth-curve').first().click();
await page.waitForTimeout(800);
const smoothed = await page.evaluate(() => {
  const t = window.editor.project.selection.getSelectedObjects('Tween')[0];
  return { easingType: t.easingType, bezier: t.bezier };
});
record('smooth-picks-from-the-neighbours',
  smoothed.easingType === 'custom' && smoothed.bezier.join(',') === '0.42,0,0.58,1',
  `the only segment in the motion smoothed to [${smoothed.bezier}] — starts from rest and comes to rest`);

/* A drag is one edit, not one per pointer move. */
const undoStates = await page.evaluate(() => window.editor.project.history.numUndoStates);
const box2 = await graph.boundingBox();
const second = await handles.nth(1).boundingBox();
await page.mouse.move(second.x + second.width / 2, second.y + second.height / 2);
await page.mouse.down();
for (let i = 1; i <= 12; i++) {
  await page.mouse.move(box2.x + box2.width * (0.5 + i * 0.02), box2.y + box2.height * (0.6 - i * 0.01));
}
await page.mouse.up();
await page.waitForTimeout(800);
const undoAfter = await page.evaluate(() => window.editor.project.history.numUndoStates);
record('one-drag-is-one-undo', undoAfter - undoStates === 1,
  `twelve pointer moves left ${undoAfter - undoStates} undo state(s)`);

/* The curve has to survive into the file, because the file is what the compiler reads. */
const saved = await page.evaluate(() => {
  const data = window.editor.project.serialize();
  const tweens = Object.values(window.Wick.ObjectCache.getAllObjects())
    .filter((o) => o.classname === 'Tween')
    .map((o) => o.serialize());
  return { tweens: tweens.map((t) => ({ easingType: t.easingType, bezier: t.bezier })), had: !!data };
});
const custom = saved.tweens.find((t) => t.easingType === 'custom');
record('the-curve-reaches-the-file',
  !!custom && Array.isArray(custom.bezier) && custom.bezier.length === 4,
  custom ? `serialized as easingType "custom" with bezier [${custom.bezier}]` : 'no custom tween in the serialized project');

/*
 * The divergence, from the other side. A tween built the way every existing .wick describes
 * one — easingType only, no bezier key at all — has to open and ease exactly as before. This
 * is the case that fails if the new field were ever treated as required.
 */
const old = await page.evaluate(() => {
  const fresh = new window.Wick.Tween({ playheadPosition: 1, easingType: 'in-out-cubic' });
  const asFile = fresh.serialize();
  delete asFile.bezier;
  const reopened = window.Wick.Tween.fromData
    ? window.Wick.Tween.fromData(asFile)
    : (() => { const t = new window.Wick.Tween(); t.deserialize(asFile); return t; })();
  return {
    easingType: reopened.easingType,
    bezier: reopened.bezier,
    at: [0.25, 0.5, 0.75].map((k) => reopened._getTweenFunction()(k)),
    named: [0.25, 0.5, 0.75].map((k) => window.Wick.Tween.sampleEasing('in-out-cubic', null, k)),
  };
});
record('an-old-tween-still-opens',
  old.easingType === 'in-out-cubic'
  && Array.isArray(old.bezier) && old.bezier.length === 4
  && old.at.every((v, i) => Math.abs(v - old.named[i]) < 1e-12),
  `no bezier in the data: easing stayed "${old.easingType}", eased ${old.at.map((n) => n.toFixed(4)).join(', ')}, and bezier defaulted to [${old.bezier}] rather than breaking`);

/*
 * And the whole question, asked of a real file. motion-tween.wick was authored on
 * wickeditor.com by wickengine 2021.1.22, five years before any of this — it has never heard
 * of a `bezier` field and never will. It goes through the editor's own open path, not through
 * a constructor, because opening a file is the thing that has to keep working.
 */
const legacy = await readFile(new URL('../../fixtures/motion-tween.wick', import.meta.url));
const reopened = await page.evaluate((b64) => new Promise((resolve) => {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const file = new File([bytes], 'motion-tween.wick');
  const bail = setTimeout(() => resolve({ error: 'fromWickFile never called back' }), 20_000);
  window.Wick.WickFile.fromWickFile(file, (project) => {
    clearTimeout(bail);
    if(!project) return resolve({ error: 'fromWickFile returned nothing' });
    const tweens = [];
    project.root.timeline.layers.forEach((layer) => layer.frames.forEach(
      (frame) => frame.tweens.forEach((t) => tweens.push({ at: t.playheadPosition, easing: t.easingType, bezier: t.bezier }))));
    resolve({ framerate: project.framerate, layers: project.root.timeline.layers.length, tweens });
  });
}), legacy.toString('base64'));
record('a-2021-wick-file-still-opens',
  !reopened.error && reopened.tweens.length > 0
  && reopened.tweens.every((t) => Array.isArray(t.bezier) && t.bezier.length === 4),
  reopened.error
  || `${reopened.layers} layer(s) at ${reopened.framerate}fps, ${reopened.tweens.length} tween(s) easing `
     + `${reopened.tweens.map((t) => t.easing).join(', ')} — each defaulted to a curve instead of failing to load`);

record('no-page-errors', errors.length === 0, errors.slice(0, 3).join(' | ') || 'clean');

await browser.close();

for (const r of results) console.log(`${(r.ok ? 'ok' : 'FAIL').padEnd(5)} ${r.name.padEnd(30)} ${r.detail}`);
const broke = results.filter((r) => !r.ok);
if (broke.length) {
  console.error(`\n${broke.length} failing: ${broke.map((r) => r.name).join(', ')}`);
  process.exit(1);
}
console.log('\nok — the drawn curve is the curve that plays');
