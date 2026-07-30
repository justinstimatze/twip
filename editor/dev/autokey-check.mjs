/*
 * autokey-check.mjs — moving something writes a keyframe, but only when asked.
 *
 * docs/ui-research.md calls auto-keyframing the highest-leverage change away from Flash's
 * convert-to-symbol-then-tween. Most of it turned out to already exist: Clip's transformation
 * setter writes through to the tween under the playhead, and Cursor's mouse-up has always
 * called tryToAutoCreateTween. What was missing was the FIRST key, because making that one is
 * also what wraps loose paths into a clip. Auto-key is the mode that lets a drag do it.
 *
 * So the subject here is a mode, and a mode is only correct in both positions. Half these
 * cases prove auto-key does something and half prove that with it off nothing changed —
 * the second half is the one that matters, because dragging a shape around while composing
 * a still drawing must not silently produce a symbol and an animation.
 *
 * It drives a real mouse over the real canvas rather than calling the engine, because the
 * question is what the GESTURE does. Where it does call the engine it says so and why.
 *
 *   node dev/autokey-check.mjs
 *   node dev/autokey-check.mjs --headed
 *
 * Env: SMOKE_URL (default http://localhost:3000), PLAYWRIGHT_CHANNEL (see dev/browser.mjs).
 */
import { launch, URL_ } from './browser.mjs';

const browser = await launch({ headless: !process.argv.includes('--headed') });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`[uncaught] ${e.message}`));

/* Nothing carried in from a previous run — the mode is deliberately sticky across sessions,
 * which would otherwise make the first case pass or fail depending on what ran last. */
await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60_000 });
await page.evaluate(() => window.localStorage.removeItem('twip:auto-key'));
await page.goto(URL_, { waitUntil: 'networkidle', timeout: 60_000 });
await page.waitForFunction(() => window.editor && window.editor.project, null, { timeout: 30_000 });
await page.waitForTimeout(2500);

const results = [];
const record = (name, ok, detail) => results.push({ name, ok, detail });

const button = page.locator('#canvas-transform-button-autokey').first();

const state = () => page.evaluate(() => {
  const p = window.editor.project;
  const f = p.activeFrame;
  const clip = f && f.clips[0];
  return {
    playhead: p.activeTimeline.playheadPosition,
    clips: f ? f.clips.length : 0,
    paths: f ? f.paths.length : 0,
    tweens: f ? f.tweens.map((t) => t.playheadPosition) : [],
    x: clip ? Math.round(clip.transformation.x) : null,
    keyed: f ? f.tweens.map((t) => `${t.playheadPosition}@${Math.round(t.transformation.x)}`) : [],
    flag: window.Wick.Project.autoKey,
    stored: window.localStorage.getItem('twip:auto-key'),
  };
});

/* One square, drawn through the engine because drawing it with the brush is the brush's
 * check, not this one. Everything after this point is a real pointer. */
const square = () => page.evaluate(() => {
  const p = window.editor.project;
  const f = p.activeFrame;
  f.end = 24;
  f.paths.forEach((path) => path.remove());
  f.clips.forEach((clip) => clip.remove());
  f.tweens.forEach((tween) => tween.remove());
  const path = new window.Wick.Path({
    json: ['Path', { segments: [[-45, -45], [45, -45], [45, 45], [-45, 45]], closed: true,
      fillColor: [0.9, 0.35, 0.2], strokeWidth: 0 }],
  });
  f.addPath(path);
  path.x = p.width / 2;
  path.y = p.height / 2;
  p.activeTimeline.playheadPosition = 1;
  p.selection.clear();
  p.view.render();
  window.editor.projectDidChange({ actionName: 'autokey fixture' });
});

const screen = (x, y) => page.evaluate(([px, py]) => {
  const p = window.editor.project;
  const box = (document.querySelector('#wick-canvas-container canvas') || document.querySelector('canvas')).getBoundingClientRect();
  const v = p.view.paper.view.projectToView(new p.view.paper.Point(px, py));
  return [box.left + v.x, box.top + v.y];
}, [x, y]);

const seek = (frame) => page.evaluate((n) => {
  const p = window.editor.project;
  p.activeTimeline.playheadPosition = n;
  p.view.render();
  p.guiElement.draw();
}, frame);

/* Select, then drag. Both are real events: selecting through the engine would skip the tool
 * that calls tryToAutoCreateTween, which is the thing under test. */
const dragFrom = async (px, py, dx, dy) => {
  const [x, y] = await screen(px, py);
  await page.mouse.click(x, y);
  await page.waitForTimeout(400);
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(x + (dx * i) / 8, y + (dy * i) / 8);
  await page.mouse.up();
  await page.waitForTimeout(800);
};

const size = await page.evaluate(() => ({ w: window.editor.project.width, h: window.editor.project.height }));
const mid = [size.w / 2, size.h / 2];

// ---- off ----------------------------------------------------------------------------
await square();
await page.waitForTimeout(700);
const fresh = await state();
record('off-by-default', fresh.flag === false && fresh.stored === null && (await button.count()) > 0,
  `engine flag ${fresh.flag}, nothing stored, ${await button.count()} toggle in the toolbar`);

/* An icon-only button reaches a screen reader as "button" unless something names it, and a
 * tooltip is not that something — it needs a pointer. The other five buttons in this widget
 * were in the same state and are named the same way now. */
const named = await page.evaluate(() => [...document.querySelectorAll('.canvas-transforms-widget button')]
  .filter((b) => b.id.startsWith('canvas-transform-button-'))
  .map((b) => `${b.id.replace('canvas-transform-button-', '')}=${b.getAttribute('aria-label') || 'UNNAMED'}`));
const autokeyNamed = await page.evaluate(() => {
  const b = document.querySelector('#canvas-transform-button-autokey');
  return b && { label: b.getAttribute('aria-label'), pressed: b.getAttribute('aria-pressed') };
});
record('the-toggle-says-what-it-is',
  named.length > 0 && !named.some((n) => n.endsWith('UNNAMED'))
  && autokeyNamed && autokeyNamed.label === 'Auto-Key' && autokeyNamed.pressed === 'false',
  `${named.join(' ')} — auto-key reads aria-pressed=${autokeyNamed && autokeyNamed.pressed}`);

await dragFrom(mid[0], mid[1], 100, -70);
const dragged = await state();
record('off-drag-just-moves', dragged.tweens.length === 0 && dragged.clips === 0 && dragged.paths === 1,
  `${dragged.paths} path, ${dragged.clips} clips, ${dragged.tweens.length} tweens — the drag moved a drawing and nothing else`);

// ---- on -----------------------------------------------------------------------------
await button.click();
await page.waitForTimeout(600);
const on = await state();
record('toggle-turns-it-on', on.flag === true && on.stored === 'on',
  `engine flag ${on.flag}, localStorage twip:auto-key=${on.stored}`);

await square();
await page.waitForTimeout(700);
await dragFrom(mid[0], mid[1], 110, -60);
const first = await state();
const moved = first.x !== null && Math.abs(first.x - size.w / 2) > 40;
record('first-drag-keys',
  first.tweens.length === 1 && first.tweens[0] === 1 && first.clips === 1 && first.paths === 0 && moved,
  `${first.clips} clip, ${first.paths} loose paths, keys at ${first.keyed.join(',') || 'none'}`
  + ` — the key has to hold where the drag PUT it (${Math.round(size.w / 2)} would be where it started)`);

/* The gesture the whole feature is for: move the playhead, move the object, get an
 * animation. This half already worked before auto-key; it is here because auto-key
 * bootstrapping the first key must not have broken it. */
await seek(12);
await page.waitForTimeout(500);
const at1 = first.x;
await dragFrom(mid[0] + 110, mid[1] - 60, -180, 90);
const second = await state();
record('second-key-at-the-playhead',
  second.tweens.includes(1) && second.tweens.includes(12) && second.x !== at1,
  `keys at ${second.keyed.join(' ')} — two positions, two values`);

/* The Inspector's setters call the same seam as the cursor. Driven through Selection
 * because that IS the code path the numeric inputs run; typing into them is the
 * Inspector's own check. */
await seek(20);
await page.waitForTimeout(400);
await page.evaluate(() => {
  const p = window.editor.project;
  const clip = p.activeFrame && p.activeFrame.clips[0];
  if (!clip) return;
  p.selection.clear();
  p.selection.select(clip);
  p.selection.x = p.selection.x + 140;
  window.editor.projectDidChange({ actionName: 'nudge' });
});
await page.waitForTimeout(800);
const third = await state();
record('inspector-edits-key-too', third.tweens.includes(20),
  `keys at ${third.tweens.join(',')} — moving from the Inspector keys like dragging does`);

/* A tween that interpolates is the point of all of it. Ask the engine what it draws
 * between two keys rather than trusting that two keys imply motion. */
const between = await page.evaluate(() => {
  const f = window.editor.project.activeFrame;
  const at = (n) => { const t = f.getActiveTween(); return t ? t.transformation.x : null; };
  const p = window.editor.project;
  const out = [];
  for (const n of [1, 6, 12]) { p.activeTimeline.playheadPosition = n; out.push(Math.round(at(n))); }
  p.activeTimeline.playheadPosition = 1;
  return out;
});
const ascends = (between[0] < between[1] && between[1] < between[2])
  || (between[0] > between[1] && between[1] > between[2]);
record('the-keys-actually-tween', ascends,
  `x at frames 1, 6, 12 is ${between.join(', ')} — the midpoint sits between the keys`);

/*
 * Rotation, which is a different code path from the x above: x always keyed after it
 * applied, while width, height, rotation, skew and both flips keyed before. Keying first is
 * harmless when a clip already exists to be corrected and fatal when making that clip IS the
 * edit — the clip gets built, then applyChanges rebuilds the frame from paper and throws it
 * away. So the assertion is that the edit survived, twice over: the first rotation leaves a
 * clip and a key, and a second rotation further down the timeline leaves a key that actually
 * holds an angle.
 *
 * The first key reading 0° is not a miss. Wrapping loose paths into a new clip puts the
 * rotation in the paths' own geometry and leaves the clip square to the world; only rotating
 * the clip afterwards turns the clip itself.
 */
await page.evaluate(() => { window.editor.project.selection.clear(); });
await square();
await page.waitForTimeout(700);
const spun = await page.evaluate(() => {
  const p = window.editor.project;
  const f = p.activeFrame;
  const turn = (deg) => {
    p.selection.clear();
    p.selection.select(f.clips[0] || f.paths[0]);
    p.selection.rotation = deg;
    window.editor.projectDidChange({ actionName: 'rotate' });
  };
  turn(30);
  const bootstrapped = { clips: f.clips.length, tweens: f.tweens.length };
  p.activeTimeline.playheadPosition = 16;
  turn(75);
  const key = f.getTweenAtPosition(16);
  return { ...bootstrapped, at16: key ? Math.round(key.transformation.rotation) : null };
});
record('rotating-keys-from-nothing',
  spun.clips === 1 && spun.tweens === 1 && spun.at16 !== null && Math.abs(spun.at16) > 1,
  `first rotation left ${spun.clips} clip and ${spun.tweens} key; rotating again at frame 16 keyed ${spun.at16}°`);

// ---- sticky, then off ---------------------------------------------------------------
await page.reload({ waitUntil: 'networkidle', timeout: 60_000 });
await page.waitForFunction(() => window.editor && window.editor.project, null, { timeout: 30_000 });
await page.waitForTimeout(2500);

/* The edits above autosaved, so the reload is greeted by the recover-your-work modal — an
 * overlay that swallows every click aimed at the canvas under it. Deleting the IndexedDB
 * store instead does not work: the page still holds it open and the delete blocks. */
const recover = page.locator('.autosave-modal-overlay');
if (await recover.count()) {
  await recover.locator('button:has-text("Delete"), .action-button:has-text("Delete")').first().click();
  await page.waitForTimeout(800);
}
const reloaded = await state();
record('mode-survives-reload', reloaded.flag === true,
  `after a reload the engine flag is ${reloaded.flag}`);

/* The hotkey and the button are the same switch. */
await page.locator('#wick-canvas-container canvas, canvas').first().click({ position: { x: 10, y: 10 } });
await page.keyboard.press('9');
await page.waitForTimeout(600);
const hotkeyed = await state();
record('the-hotkey-is-the-same-switch', hotkeyed.flag === false,
  `9 turned it ${hotkeyed.flag ? 'on' : 'off'}, localStorage says ${hotkeyed.stored}`);

await square();
await page.waitForTimeout(700);
await dragFrom(mid[0], mid[1], 90, 70);
const backOff = await state();
record('off-again-stops-keying', backOff.tweens.length === 0 && backOff.clips === 0,
  `${backOff.tweens.length} tweens, ${backOff.clips} clips — off means off`);

record('no-page-errors', errors.length === 0, errors.slice(0, 3).join(' | ') || 'clean');

await browser.close();

for (const r of results) console.log(`${(r.ok ? 'ok' : 'FAIL').padEnd(5)} ${r.name.padEnd(28)} ${r.detail}`);
const broke = results.filter((r) => !r.ok);
if (broke.length) {
  console.error(`\n${broke.length} failing: ${broke.map((r) => r.name).join(', ')}`);
  process.exit(1);
}
console.log('\nok — moving something keys it, and only when asked');
