/*
 * hotkeys-check.mjs — the behaviours a keyboard-shortcut library has to reproduce.
 *
 * This exists to be written BEFORE react-hotkeys is replaced, not after. `hotKeyMap.js` holds
 * 61 actions whose sequence strings are simultaneously the bindings and the labels rendered in
 * tooltips and the shortcuts settings, so the swap is judged entirely on behavioural parity and
 * there was nothing to compare against. Every case below was measured against react-hotkeys
 * first, so a disagreement after the swap is a real difference rather than a guess about one.
 *
 * Two of them are worth reading before touching the map:
 *
 * `meta` is not the Meta key. Nothing in this tree maps platform modifiers — every clipboard,
 * undo and save binding is `meta+…` and there is no isMac anywhere — and the obvious conclusion
 * is that undo by keyboard has never worked off a Mac. It is wrong: react-hotkeys resolves
 * `meta` to Control on Linux, and Ctrl+Z undoes. Anything replacing it has to keep doing that,
 * which is what tinykeys' `$mod` is for.
 *
 * Typing into a text field must not fire shortcuts. react-hotkeys ignores keystrokes inside
 * input, select and textarea for free. tinykeys does not, so this filter has to be rebuilt
 * rather than inherited, and `types-in-a-field` below is the case that catches its absence —
 * without it, naming a layer "background" would activate brush, eraser, and the cursor.
 *
 * KNOWN-FAILING: `button-focus`. Pick a tool, then press Ctrl+Z, and nothing happens, because
 * focus is on the toolbar button rather than the canvas. That is the single most common order of
 * operations in the editor — pick tool, draw, undo — and it is broken today. It is asserted as
 * it should behave, so this check is red until the swap fixes it. That is the contract: the
 * swap is done when this file passes, and it joins editor.yml then and not before.
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
await clear();
await draw();
await page.locator('#tool-button-cursor').first().click();
await page.waitForTimeout(250);
before = await paths();
await page.keyboard.press('Control+z');
await page.waitForTimeout(700);
record('button-focus', (await paths()) < before,
  `Ctrl+Z with #tool-button-cursor focused: ${before} paths -> ${await paths()}`,
  'pick a tool then undo — broken under react-hotkeys, the swap must fix it');

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
