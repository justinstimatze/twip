/*
 * hotkeys-check.mjs — the behaviours a keyboard-shortcut library has to reproduce.
 *
 * Written BEFORE react-hotkeys was replaced, not after. `hotKeyMap.js` holds 61 actions whose
 * sequence strings are simultaneously the bindings and the labels rendered in tooltips and the
 * shortcuts settings, so the swap was judged entirely on behavioural parity and there was nothing
 * to compare against. Thirteen of the fourteen cases were measured against react-hotkeys first and
 * pass identically under tinykeys, which is what a dependency swap should look like.
 *
 * `records-a-new-key` is the exception and the one thing that changed. Under react-hotkeys,
 * recording Ctrl+Shift+. in the settings modal produced `. + control + shift` — key first,
 * modifiers after, in the order it noticed them — and the sequence it stored bound nothing.
 *
 * One case earned this whole order of work on its own. `button-focus` first went in asserting that
 * Ctrl+Z undoes with a toolbar button focused, and it was red — pick a tool, draw, undo, and the
 * drawing stayed. It reads like a focus bug and it is not one: picking a tool is itself an
 * undoable action, so the undo landed on the tool change and the second press removed the
 * drawing. The case now presses a key that has no history of its own, and passes on both sides.
 *
 * Two facts about the map are worth reading before touching it:
 *
 * `meta` is not the Meta key, and no library is what makes that true. Every clipboard, undo and
 * save binding in hotKeyMap.js is `meta+…`, which reads like undo by keyboard has never worked
 * off a Mac. It works: `modifyKeyMap` rewrites `meta` to `ctrl` on every platform but a Mac
 * before any library sees a sequence, so what gets bound is `ctrl+z` and Ctrl+Z undoes. The two
 * cases below pin that down from the outside, because the rewrite is one `String.replace` in the
 * middle of a keymap deep-copy and nothing else records that twenty shortcuts depend on it.
 *
 * Typing into a text field must not fire shortcuts. Two separate filters cover this today —
 * react-hotkeys skips input, select and textarea, and `wrapHotkeyFunction` skips INPUT and
 * TEXTAREA again on its own — and only the second one survives a swap. `types-in-a-field` and
 * `code-editor-swallows-keys` below are the pair that catch a hole: without them, naming a layer
 * "background" activates brush, eraser and the cursor, and writing `if (b) {` in a script does
 * the same. The script editor is the harder half, since CodeMirror's surface is a
 * contenteditable div that no tag filter mentions.
 *
 *   node dev/hotkeys-check.mjs
 *   node dev/hotkeys-check.mjs --headed
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
const record = (name, ok, detail, known) => results.push({ name, ok, detail, known });

const tool = () => page.evaluate(() => window.editor.project.activeTool.name);
const paths = () => page.evaluate(() => window.editor.project.activeFrame.paths.length);
const frame = () => page.evaluate(() => {
  const f = window.editor.project.activeFrame;
  return { start: f.start, length: f.length };
});
const selectedFrame = () => page.evaluate(() => {
  const f = window.editor.project.selection.getSelectedObjects('Frame')[0];
  return f ? { start: f.start, length: f.length } : { start: -1, length: -1 };
});
const playhead = () => page.evaluate(() => window.editor.project.activeTimeline.playheadPosition);
/* extend-frame and move-frame-right act on the selection, so give them one. */
const selectFrame = async () => {
  await page.evaluate(() => {
    const p = window.editor.project;
    p.selection.clear();
    p.selection.select(p.activeFrame);
    p.guiElement.draw();
  });
  await page.waitForTimeout(300);
};
const clear = async () => {
  await page.evaluate(() => {
    const f = window.editor.project.activeFrame;
    for (const p of [...f.paths]) p.remove();
    window.editor.project.view.render();
  });
  await page.waitForTimeout(250);
};
/* A rectangle, drawn with the tool, so undo has something of the document's own to remove. */
const draw = async () => {
  await page.locator('#tool-button-rectangle').first().click();
  await page.waitForTimeout(150);
  await page.mouse.move(500, 350);
  await page.mouse.down();
  await page.mouse.move(640, 460, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(500);
};
const focusCanvas = () => page.mouse.click(300, 700);

// ---- single keys select tools ----
await focusCanvas();
const switches = [];
for (const [key, want] of [['b', 'brush'], ['e', 'eraser'], ['r', 'rectangle'], ['v', 'cursor']]) {
  await page.keyboard.press(key);
  await page.waitForTimeout(350);
  switches.push(`${key}->${await tool()}`);
}
record('single-keys', switches.join(' ') === 'b->brush e->eraser r->rectangle v->cursor', switches.join(' '));

// ---- `meta` resolves to Control off a Mac ----
await clear();
await draw();
await focusCanvas();
let before = await paths();
await page.keyboard.press('Control+z');
await page.waitForTimeout(700);
record('meta-is-ctrl', (await paths()) < before, `Ctrl+Z with the canvas focused: ${before} paths -> ${await paths()}`);

// ---- and the literal Meta key does not, on this platform ----
await clear();
await draw();
await focusCanvas();
before = await paths();
await page.keyboard.press('Meta+z');
await page.waitForTimeout(700);
record('bare-meta-inert', (await paths()) === before,
  `Super+Z left ${await paths()} paths — correct off a Mac, and the reason $mod exists`);

// ---- a shortcut still fires with focus on a toolbar button ----
// Deliberately a tool switch and not undo. Reading the path count here measures the wrong thing:
// clicking a tool button is itself an undoable action, so the Ctrl+Z lands on the tool change and
// the drawing survives — which looks exactly like a shortcut that failed to fire, and is not.
await clear();
await page.locator('#tool-button-cursor').first().click();
await page.waitForTimeout(250);
const focused = await page.evaluate(() => document.activeElement.id);
await page.keyboard.press('b');
await page.waitForTimeout(350);
record('button-focus', (await tool()) === 'brush' && focused === 'tool-button-cursor',
  `b with #${focused} focused selected ${await tool()}`);

// ---- typing in a field fires nothing ----
await clear();
const field = page.locator('input[type=text], input:not([type])').first();
const haveField = (await field.count()) > 0;
if (haveField) {
  await page.locator('#tool-button-cursor').first().click();
  await page.waitForTimeout(150);
  const toolBefore = await tool();
  await field.click();
  await field.type('bervr', { delay: 60 });
  await page.waitForTimeout(400);
  const toolAfter = await tool();
  const typed = await field.inputValue();
  record('types-in-a-field', toolAfter === toolBefore,
    `typed "bervr" into an input: tool stayed ${toolAfter}, field holds "${typed}"`);
} else {
  record('types-in-a-field', false, 'no text input was visible to type into');
}

// ---- and undo does not fire from inside one either ----
await clear();
await draw();
if (haveField) {
  await field.click();
  await page.waitForTimeout(150);
  before = await paths();
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(700);
  record('undo-skips-fields', (await paths()) === before,
    `Ctrl+Z inside an input left ${await paths()} paths — the field owns its own undo`);
}

// ---- a keyup sequence puts the previous tool back ----
// `x` activates pan on keydown and `{sequence:'x', action:'keyup'}` restores on release. It is
// the only pair of its kind in the map, and a keydown-only binding drops the second half
// silently: pan would latch on and the editor would look broken in a way no error reports.
await focusCanvas();
await page.keyboard.press('b');
await page.waitForTimeout(300);
const beforeHold = await tool();
await page.keyboard.down('x');
await page.waitForTimeout(400);
const held = await tool();
await page.keyboard.up('x');
await page.waitForTimeout(400);
const released = await tool();
record('keyup-restores-tool', beforeHold === 'brush' && held === 'pan' && released === 'brush',
  `${beforeHold} -> hold x: ${held} -> release: ${released}`);

// ---- a shifted punctuation key ----
// `shift+.` is where a naive translation breaks without ever throwing: with shift held the
// browser reports event.key '>' and only event.code stays 'Period', so a matcher that reads
// key alone quietly binds nothing.
await focusCanvas();
await selectFrame();
const frameBefore = await frame();
await page.keyboard.press('Shift+.');
await page.waitForTimeout(500);
const frameExtended = await frame();
record('shift-punctuation', frameExtended.length > frameBefore.length,
  `Shift+. extended the frame ${frameBefore.length} -> ${frameExtended.length}`);

// ---- three parts in one chord ----
// Read the selected frame rather than activeFrame: once the frame moves off the playhead,
// activeFrame is whatever sits at the playhead instead, and the frame that moved is elsewhere.
await focusCanvas();
await selectFrame();
const beforeMove = await selectedFrame();
await page.keyboard.press('Control+Shift+.');
await page.waitForTimeout(500);
const afterMove = await selectedFrame();
record('three-part-chord', afterMove.start > beforeMove.start,
  `Ctrl+Shift+. moved the selected frame from ${beforeMove.start} to ${afterMove.start}`);

// ---- holding a repeatable key keeps firing ----
// The repeat is the map's own setTimeout/setInterval rather than the library's, and the timers
// are cleared by a keyup binding. A swap that loses the keyup leaves the playhead running.
await focusCanvas();
const playBefore = await playhead();
await page.keyboard.down('.');
await page.waitForTimeout(900);
await page.keyboard.up('.');
await page.waitForTimeout(400);
const playHeld = await playhead();
await page.waitForTimeout(600);
const playSettled = await playhead();
record('repeat-then-stops', playHeld > playBefore + 1 && playSettled === playHeld,
  `held . : ${playBefore} -> ${playHeld}, and stopped there (${playSettled})`);

// ---- the backquote opens the script editor ----
// Only the opening direction is asserted, deliberately. Pressing it a second time does nothing,
// because opening the panel moves focus into CodeMirror and the case below is why that is right.
await focusCanvas();
const codeOpen = () => page.evaluate(() => window.editor.state.codeEditorOpen);
const codeBefore = await codeOpen();
await page.keyboard.press('`');
await page.waitForTimeout(800);
record('backquote-opens-code', codeBefore === false && (await codeOpen()) === true,
  `codeEditorOpen ${codeBefore} -> ${await codeOpen()}`);

// ---- and typing in it fires nothing ----
// The script editor is CodeMirror, whose editable surface is a contenteditable div rather than a
// textarea, so the input/select/textarea filter every keyboard library ships does not cover it.
// react-hotkeys happens to leave these keystrokes alone; nothing in this repo arranges that, so
// it has to be arranged deliberately on the way out. Without it, writing `if (b) {` in a script
// would pick up the brush and drop the frame.
const codeArea = page.locator('.cm-content').first();
if ((await codeArea.count()) > 0) {
  await codeArea.click();
  await page.waitForTimeout(200);
  const toolWas = await tool();
  await page.keyboard.type('be', { delay: 80 });
  await page.keyboard.press('`');
  await page.waitForTimeout(600);
  const typed = await page.evaluate(() => window.editor.project.selection.getSelectedObject()?.scripts?.[0]?.src ?? '');
  record('code-editor-swallows-keys',
    (await tool()) === toolWas && (await codeOpen()) === true,
    `typed "be\`" into .cm-content: tool stayed ${await tool()}, panel stayed open, script holds ${JSON.stringify(typed)}`);
} else {
  record('code-editor-swallows-keys', false, 'the script editor never opened, so nothing was typed into it');
}

// ---- recording a new shortcut, all the way through ----
// Last, because it rebinds the brush away from `b` and every case above assumes the defaults.
//
// The settings table renders a sequence string as the shortcut's own label, and the conflict
// check compares recorded strings against the default map's with nothing but toLowerCase, so the
// recorder cannot spell a key however it likes: `Control+Shift+Period` would display as three
// wrong words and would silently fail to notice it had stolen move-frame-right's chord. That the
// row below goes red is the whole reason this walks the modal rather than calling the recorder.
await page.evaluate(() => window.editor.openModal('SettingsModal'));
await page.waitForTimeout(1000);
await page.locator('text=Shortcuts').first().click();
await page.waitForTimeout(500);
await page.locator('.hotkey-header-column', { hasText: 'Drawing Tools' }).first().click();
await page.waitForTimeout(500);

const cell = page.locator('#keyboard-shortcuts-body td.hotkey-column').first();
const cellWas = (await cell.textContent()).trim();
await cell.click();
await page.waitForTimeout(300);
await page.keyboard.press('Control+Shift+.');
await page.waitForTimeout(600);
const cellNow = (await cell.textContent()).trim();

await page.locator('#keyboard-shorcuts-apply-button').first().click();
await page.waitForTimeout(1000);
const stored = await page.evaluate(() => window.editor.state.customHotKeys);

await focusCanvas();
await page.keyboard.press('v');
await page.waitForTimeout(300);
await page.keyboard.press('Control+Shift+.');
await page.waitForTimeout(500);
record('records-a-new-key',
  cellWas === 'b' && cellNow === 'ctrl + shift + .'
    && stored['activate-brush']?.[0] === 'ctrl+shift+.'
    && stored['move-frame-right']?.[0] === ''
    && (await tool()) === 'brush',
  `recorded over "${cellWas}", row reads "${cellNow}", it took move-frame-right's chord away, and it selects ${await tool()}`);

record('no-page-errors', errors.length === 0, errors.join(' | ') || 'clean');

await browser.close();

for (const r of results) {
  const tag = r.ok ? 'ok  ' : r.known ? 'KNOWN' : 'FAIL';
  console.log(`${tag.padEnd(5)} ${r.name.padEnd(19)} ${r.detail}`);
  if (!r.ok && r.known) console.log(`      ^ ${r.known}`);
}

const broke = results.filter((r) => !r.ok);
if (broke.length) {
  const onlyKnown = broke.every((r) => r.known);
  console.error(`\n${broke.length} failing (${onlyKnown ? 'all known' : 'some unexpected'}): ${broke.map((r) => r.name).join(', ')}`);
  process.exit(1);
}
console.log('\nok — every shortcut behaviour holds');
