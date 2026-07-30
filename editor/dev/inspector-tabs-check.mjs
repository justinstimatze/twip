/*
 * inspector-tabs-check.mjs — the Inspector describes three things, and switching between them
 * does not cost you the selection.
 *
 * The panel was flat: one selection, one view. That is not merely cramped, it is a question
 * the interface cannot answer — with a clip selected there was no way to see how long the
 * frame under it is, because seeing the frame meant selecting the frame meant losing the
 * clip. So the case that matters most here is the-frame-is-still-there: select a shape, ask
 * the Frame tab, and get an answer without the selection moving.
 *
 * Two failure modes worth naming, because both look fine on screen:
 *
 * The tab following the selection is the "context-aware" half, and it is only right if it
 * ALSO stops following when you take over — a rail that snaps back to Object on the next
 * render is worse than no tabs, since the panel you chose keeps vanishing. Checked in both
 * directions.
 *
 * And the Document tab writes through updateProjectSettings, which pushes an undo state.
 * Every other Inspector row commits per keystroke; typing 1280 into Width that way is four
 * resizes and four undo states, three at widths nobody asked for. one-edit-is-one-undo is
 * the case that would notice the draft going away.
 *
 *   node dev/inspector-tabs-check.mjs
 *   node dev/inspector-tabs-check.mjs --headed
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

/*
 * Typed, not assigned. A synthetic `blur` event does not reach React's onBlur — React listens
 * for `focusout` at the root — so the Document tab's commit would silently never fire and the
 * draft would look like a bug in the panel rather than a bug in the check. Real keystrokes
 * also exercise the per-keystroke path the draft exists to hold back.
 */
async function retype (locator, text) {
  await locator.click();
  await locator.press('ControlOrMeta+a');
  await locator.pressSequentially(text, { delay: 30 });
}

const tabs = page.locator('[role="tablist"][aria-label="Inspector subject"] [role="tab"]');
const tab = (name) => page.locator(`#inspector-tab-${name}`);
const panel = page.locator('[role="tabpanel"]');
const activeTab = () => page.evaluate(() =>
  (document.querySelector('[role="tab"][aria-selected="true"]') || {}).textContent);
const railContext = () => page.evaluate(() => {
  const rail = document.querySelector('[aria-label="Inspector Panel"] .rail-label');
  return rail && rail.nextElementSibling ? rail.nextElementSibling.textContent : null;
});

/* A drawing on a twenty-frame span, so there is both something to select and a frame worth
 * asking about. Built through the engine — drawing it by hand is autokey-check's job. */
await page.evaluate(() => {
  const p = window.editor.project;
  const f = p.activeFrame;
  f.end = 20;
  const path = new window.Wick.Path({
    json: ['Path', { segments: [[-40, -40], [40, -40], [40, 40], [-40, 40]], closed: true,
      fillColor: [0.2, 0.5, 0.9], strokeWidth: 0 }],
  });
  f.addPath(path);
  path.x = 200; path.y = 200;
  p.activeTimeline.playheadPosition = 4;
  window.editor.projectDidChange({ actionName: 'tabs fixture' });
});
await page.waitForTimeout(800);

/* One tab stop for the rail, not three: exactly one tab is reachable by Tab, and the arrows
 * move within. Three tab stops would make a keyboard user walk the whole rail to reach a
 * field. */
const rail = await page.evaluate(() => {
  const list = document.querySelector('[role="tablist"][aria-label="Inspector subject"]');
  if(!list) return { error: 'no tablist' };
  const buttons = Array.from(list.querySelectorAll('[role="tab"]'));
  return {
    labels: buttons.map((b) => b.textContent),
    selected: buttons.filter((b) => b.getAttribute('aria-selected') === 'true').map((b) => b.textContent),
    reachable: buttons.filter((b) => b.tabIndex === 0).length,
    controls: buttons.every((b) => document.getElementById(b.getAttribute('aria-controls'))
      || b.getAttribute('aria-selected') === 'false'),
  };
});
record('three-tabs-one-stop',
  !rail.error && (await tabs.count()) === 3 && rail.selected.length === 1
  && rail.reachable === 1 && rail.controls,
  rail.error || `${rail.labels.join(' / ')} — "${rail.selected[0]}" selected, ${rail.reachable} tab stop, the selected tab names its panel`);

/* Selecting a shape puts the panel on Object without being asked. */
await page.evaluate(() => {
  const p = window.editor.project;
  p.selection.clear();
  p.selection.select(p.activeFrame.paths[0]);
  window.editor.projectDidChange({ actionName: 'select path' });
});
await page.waitForTimeout(600);
record('selecting-follows-to-object',
  (await activeTab()) === 'Object' && (await panel.locator('input').count()) > 0,
  `tab is "${await activeTab()}" with ${await panel.locator('input').count()} fields, rail says "${await railContext()}"`);

/*
 * The whole point. With the path still selected, the Frame tab answers about the frame under
 * the playhead — and the selection does not move to get the answer.
 */
await tab('frame').click();
await page.waitForTimeout(500);
const withPathHeld = await page.evaluate(() => {
  const label = Array.from(document.querySelectorAll('[role="tabpanel"] label'))
    .find((l) => l.textContent === 'Length');
  const input = label && document.getElementById(label.htmlFor);
  return {
    length: input ? input.value : null,
    stillSelected: window.editor.getSelectionType(),
    modelLength: window.editor.project.activeFrame.length,
  };
});
record('the-frame-is-still-there',
  Number(withPathHeld.length) === withPathHeld.modelLength
  && withPathHeld.stillSelected === 'path',
  `Frame tab reads length ${withPathHeld.length} (model says ${withPathHeld.modelLength}) while the selection is still a ${withPathHeld.stillSelected}`);

/*
 * And editing there writes to that frame — held until you leave the field, which on this row
 * is what keeps it from deleting its own subject. Typing 30 passes through 3, and a 3-frame
 * frame does not reach the playhead at 4; applied per keystroke, the row would vanish
 * mid-word and take the rest of the number with it.
 */
const beforeUndo = await page.evaluate(() => window.editor.project.history.numUndoStates);
await retype(page.locator('#length-input'), '30');
await page.waitForTimeout(300);
const midFrame = await page.evaluate(() => {
  const f = window.editor.project.activeFrame;
  return { length: f ? f.length : null, rows: document.querySelectorAll('[role="tabpanel"] input').length };
});
await page.keyboard.press('Tab');
await page.waitForTimeout(600);
const framePatched = await page.evaluate(() => ({
  length: window.editor.project.activeFrame.length,
  states: window.editor.project.history.numUndoStates,
}));
record('the-frame-tab-edits-that-frame',
  midFrame.length === 20 && midFrame.rows > 0 && framePatched.length === 30
  && framePatched.states - beforeUndo === 1,
  `frame held at ${midFrame.length} with ${midFrame.rows} fields still on screen while "30" was typed, then went to `
  + `${framePatched.length} in ${framePatched.states - beforeUndo} undo state(s)`);

/*
 * The fallback is the frame under the playhead, so it has to move when the playhead does. A
 * panel that reads the frame once and keeps showing it is the failure this catches: it looks
 * identical until you scrub, and then it is quietly describing a frame you left.
 */
await page.evaluate(() => {
  const p = window.editor.project;
  const layer = p.activeLayer;
  layer.addFrame(new window.Wick.Frame({ start: 31, end: 45 }));
  p.activeTimeline.playheadPosition = 35;
  window.editor.projectDidChange({ actionName: 'second frame' });
});
await page.waitForTimeout(700);
const scrubbed = await page.evaluate(() => {
  const label = Array.from(document.querySelectorAll('[role="tabpanel"] label'))
    .find((l) => l.textContent === 'Length');
  const input = label && document.getElementById(label.htmlFor);
  const rail = document.querySelector('[aria-label="Inspector Panel"] .rail-label');
  return { length: input ? input.value : null, rail: rail.nextElementSibling.textContent };
});
record('the-tab-follows-the-playhead',
  Number(scrubbed.length) === 15 && scrubbed.rail === 'Frame 35',
  `scrubbed to 35 and the panel moved with it: rail says "${scrubbed.rail}", length ${scrubbed.length}`);

/* Clicking a frame in the timeline is a different kind of selection, and the rail follows it
 * the other way — back onto Frame, now showing the selection rather than the fallback. */
await page.evaluate(() => {
  const p = window.editor.project;
  p.selection.clear();
  p.selection.select(p.activeFrame);
  window.editor.projectDidChange({ actionName: 'select frame' });
});
await page.waitForTimeout(600);
record('selecting-a-frame-follows-too',
  (await activeTab()) === 'Frame' && (await railContext()) === 'Frame',
  `tab is "${await activeTab()}", rail says "${await railContext()}"`);

/*
 * A tab picked by hand has to stick. Nothing here changes the selection TYPE, so the rail
 * must not move — this is the case that fails if the tab is derived from the selection on
 * every render rather than only when the selection changes.
 */
await tab('document').click();
await page.waitForTimeout(400);
await page.evaluate(() => {
  const p = window.editor.project;
  p.selection.clear();
  p.selection.select(p.activeFrame);
  window.editor.projectDidChange({ actionName: 'reselect the same kind of thing' });
});
await page.waitForTimeout(600);
record('a-hand-picked-tab-sticks',
  (await activeTab()) === 'Doc',
  `after reselecting a frame the panel is still on "${await activeTab()}", rail says "${await railContext()}"`);

/*
 * The Document tab is the project. Typing a width and leaving the field resizes the stage —
 * once, not once per digit, which is what the draft is for.
 */
const beforeDoc = await page.evaluate(() => ({
  width: window.editor.project.width,
  states: window.editor.project.history.numUndoStates,
}));
await retype(page.locator('#width-input'), '1280');
await page.waitForTimeout(300);
const midType = await page.evaluate(() => window.editor.project.width);
/* Tab out — a real focus change, which is what commits. */
await page.keyboard.press('Tab');
await page.waitForTimeout(600);
const afterDoc = await page.evaluate(() => ({
  width: window.editor.project.width,
  states: window.editor.project.history.numUndoStates,
}));
record('one-edit-is-one-undo',
  midType === beforeDoc.width && afterDoc.width === 1280
  && afterDoc.states - beforeDoc.states === 1,
  `stage stayed at ${midType} through four keystrokes, then went to ${afterDoc.width} in ${afterDoc.states - beforeDoc.states} undo state(s)`);

/* And undo puts it back, which is the point of spending an undo state at all. */
await page.evaluate(() => window.editor.undoAction());
await page.waitForTimeout(600);
record('undo-puts-the-stage-back',
  (await page.evaluate(() => window.editor.project.width)) === beforeDoc.width,
  `width is ${await page.evaluate(() => window.editor.project.width)}, was ${beforeDoc.width} before the edit`);

/*
 * The stage colour, which is on this tab only because the compiler now emits a
 * SetBackgroundColor tag for it — before that it reached the editor's canvas and never the
 * .swf. Set through the panel and read back off the project, then serialized, because the
 * serialized string is what the compiler parses.
 */
await page.evaluate(() => window.editor.updateProjectSettings({ backgroundColor: 'rgba(17,34,51,1)' }));
await page.waitForTimeout(500);
const painted = await page.evaluate(() => ({
  onProject: window.editor.project.backgroundColor.rgba,
  isColor: window.editor.project.backgroundColor instanceof window.Wick.Color,
  serialized: window.editor.project.serialize().backgroundColor,
  onPanel: (document.querySelector('#background-input') || {}).value
    || (document.querySelector('[id^="inspector-project-background"]') || {}).textContent,
}));
/* `rgb(...)` not `rgba(...)`: paper.js toCSS drops the alpha when it is 1, so an opaque
 * colour normalizes on the way in. Asserted in the normalized form rather than the form it
 * was set with, because the normalized one is what lands in the file the compiler reads —
 * and `rgb(r,g,b)` is the shape that used to parse as black, since it is not a hex number. */
record('the-stage-colour-reaches-the-file',
  painted.isColor && painted.serialized === 'rgb(17,34,51)'
  && painted.onProject === painted.serialized,
  `project holds ${painted.onProject} as a Wick.Color, serialized as "${painted.serialized}"`);

/* Setting the colour it already has is not a change, and must not cost an undo state. */
const beforeRepaint = await page.evaluate(() => window.editor.project.history.numUndoStates);
await page.evaluate(() => window.editor.updateProjectSettings({ backgroundColor: 'rgba(17,34,51,1)' }));
await page.waitForTimeout(400);
record('repainting-the-same-colour-is-free',
  (await page.evaluate(() => window.editor.project.history.numUndoStates)) === beforeRepaint,
  `re-applying the colour already set added ${await page.evaluate(() => window.editor.project.history.numUndoStates) - beforeRepaint} undo state(s)`);

/* Arrow keys walk the rail, and selection follows focus. */
await tab('object').click();
await page.waitForTimeout(300);
await tab('object').focus();
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(300);
const afterRight = { tab: await activeTab(), focused: await page.evaluate(() => document.activeElement.textContent) };
await page.keyboard.press('Home');
await page.waitForTimeout(300);
record('arrows-walk-the-rail',
  afterRight.tab === 'Frame' && afterRight.focused === 'Frame' && (await activeTab()) === 'Object',
  `ArrowRight went to "${afterRight.tab}" and took focus with it, Home came back to "${await activeTab()}"`);

/* The project name in the menu bar was the handle for a modal; it is the handle for this tab
 * now, and it has to work when the panel is already showing something else. */
await tab('frame').click();
await page.waitForTimeout(300);
await page.locator('#menu-bar-project-name').click();
await page.waitForTimeout(500);
record('the-project-name-opens-doc',
  (await activeTab()) === 'Doc' && (await railContext()) === await page.evaluate(() => window.editor.project.name),
  `tab is "${await activeTab()}", rail says "${await railContext()}"`);

/* Asking for the tab you are already on still counts as asking — the request is a nonce for
 * exactly this. Switch away by hand, ask again, and it has to come back. */
await tab('object').click();
await page.waitForTimeout(300);
await page.locator('#menu-bar-project-name').click();
await page.waitForTimeout(500);
record('asking-twice-still-works',
  (await activeTab()) === 'Doc',
  `second click on the project name landed on "${await activeTab()}"`);

/* Nothing left that opens the deleted dialog. */
record('the-settings-dialog-is-gone',
  await page.evaluate(() => !document.querySelector('.simple-settings-modal-container')),
  'no SimpleProjectSettings in the DOM');

record('no-page-errors', errors.length === 0, errors.slice(0, 3).join(' | ') || 'clean');

await browser.close();

for (const r of results) console.log(`${(r.ok ? 'ok' : 'FAIL').padEnd(5)} ${r.name.padEnd(31)} ${r.detail}`);
const broke = results.filter((r) => !r.ok);
if (broke.length) {
  console.error(`\n${broke.length} failing: ${broke.map((r) => r.name).join(', ')}`);
  process.exit(1);
}
console.log('\nok — three subjects, one panel, and the selection survives the trip');
