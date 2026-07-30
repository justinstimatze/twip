/*
 * toolbar-check.mjs — the toolbar says what its controls do, and shows all of them.
 *
 * docs/ui-research.md calls the old one a "cryptic right-side icon strip". Probing it
 * turned up something past cryptic. `#settings-panel-container`.innerText was the empty
 * string for every one of the twelve tools — there was not one word anywhere in the group
 * — and no control in the whole toolbar had an accessible name, so eighteen buttons and
 * every settings field announced themselves as "button" and "edit text, blank". The
 * tooltips are not names: Radix wires them as aria-describedby, which is read after the
 * name that was not there.
 *
 * And the right-hand side was not cryptic at a laptop width, it was gone. At a 1024px
 * window the row had 774px and its contents wanted 1058; `overflow: hidden` painted the
 * last 284px off the edge, taking delete, copy, paste, undo, redo and the last two brush
 * settings with them. nothing-is-clipped is the case that would have caught that, and it
 * is deliberately geometric — every control measured against the toolbar's own box, at
 * four widths, for every tool — rather than an assertion about rows or breakpoints, since
 * how many rows the toolbar takes is the browser's business now and no number in the
 * source says.
 *
 *   node dev/toolbar-check.mjs
 *   node dev/toolbar-check.mjs --headed
 *
 * Env: SMOKE_URL (default http://localhost:3000), PLAYWRIGHT_CHANNEL (see dev/browser.mjs).
 */
import { launch, URL_ } from './browser.mjs';

const TOOLS = [
  'cursor', 'brush', 'pencil', 'eraser', 'rectangle', 'ellipse',
  'line', 'pathcursor', 'text', 'fillbucket', 'eyedropper', 'gradienttool',
];

/* Wide enough for one row, the two that used to clip, and the narrowest authoring width. */
const WIDTHS = [1920, 1440, 1200, 1024, 768];

const browser = await launch({ headless: !process.argv.includes('--headed') });
const errors = [];
const results = [];
const record = (name, ok, detail) => results.push({ name, ok, detail });

async function open (width) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  page.on('pageerror', (e) => errors.push(`[uncaught @${width}] ${e.message}`));
  await page.goto(URL_, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForFunction(() => window.editor && window.editor.project, null, { timeout: 30_000 });
  await page.waitForTimeout(2000);
  return page;
}

const pick = async (page, tool) => {
  await page.evaluate((name) => window.editor.setActiveTool(name), tool);
  await page.waitForTimeout(250);
};

/* ---- nothing-is-clipped, and every control is named ---------------------------------- */

const spills = [];
const unnamed = [];
let measured = 0;

for (const width of WIDTHS) {
  const page = await open(width);
  for (const tool of TOOLS) {
    await pick(page, tool);
    const bad = await page.evaluate((tool) => {
      /* The accessible name as a screen reader would build it, for the shapes this
         toolbar uses: an explicit aria-label, a <label for>, or the control's own text. */
      const nameOf = (node) => {
        const label = node.getAttribute('aria-label');
        if (label) return label.trim();
        const by = node.getAttribute('aria-labelledby');
        if (by) return by.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim();
        if (node.id) {
          const tag = document.querySelector('label[for="' + CSS.escape(node.id) + '"]');
          if (tag) return tag.textContent.trim();
        }
        return (node.textContent ?? '').trim();
      };
      const box = document.querySelector('.tool-box-container');
      const bounds = box.getBoundingClientRect();
      const controls = Array.from(box.querySelectorAll('button, input, [role="switch"]'));
      const out = { spilled: [], unnamed: [], count: controls.length };
      for (const control of controls) {
        const r = control.getBoundingClientRect();
        /* One pixel of slack: borders and subpixel layout put a control's edge a hair
           past its container's without any of it being hidden. */
        if (r.right > bounds.right + 1 || r.bottom > bounds.bottom + 1
            || r.left < bounds.left - 1 || r.width === 0) {
          out.spilled.push(`${tool}:${control.id || control.className.split(' ')[0] || control.tagName}`);
        }
        if (!nameOf(control)) {
          out.unnamed.push(`${tool}:${control.id || control.tagName}`);
        }
      }
      return out;
    }, tool);

    measured += bad.count;
    for (const s of bad.spilled) spills.push(`${width}px ${s}`);
    for (const u of bad.unnamed) unnamed.push(`${width}px ${u}`);
  }
  await page.close();
}

record('nothing-is-clipped', spills.length === 0,
  spills.length ? spills.slice(0, 6).join(', ')
    : `${measured} controls measured against the toolbar's box across ${WIDTHS.length} widths, all inside it`);

record('every-control-is-named', unnamed.length === 0,
  unnamed.length ? `${unnamed.length} unnamed, e.g. ${unnamed.slice(0, 5).join(', ')}`
    : `all ${measured} announce themselves`);

/* ---- what the strip says ------------------------------------------------------------- */

const page = await open(1440);
const settingsText = async () => page.evaluate(() => {
  const el = document.querySelector('#settings-panel-container');
  return el ? el.innerText.replace(/\s+/g, ' ').trim() : '';
});

await pick(page, 'brush');
const brush = await settingsText();
record('the-options-say-what-they-set',
  ['Size', 'Smooth', 'Pressure', 'Relative', 'Mode'].every((word) => brush.includes(word)),
  `brush reads "${brush}" — it read "" for every tool before this`);

await pick(page, 'rectangle');
const rectangle = await settingsText();
await pick(page, 'ellipse');
const ellipse = await settingsText();
await pick(page, 'text');
const text = await settingsText();
record('the-strip-follows-the-tool',
  rectangle.includes('Corners') && !ellipse.includes('Corners')
  && ellipse.includes('Stroke') && text === '',
  `rectangle "${rectangle}", ellipse "${ellipse}", text has no options at all`);

/* The tools with nothing to set must not leave the rule that separates the group hanging
   off the colour swatches with nothing after it. */
const rules = async () => page.evaluate(() =>
  document.querySelectorAll('.tool-box-container .bg-line-strong').length);
const rulesWithText = await rules();
await pick(page, 'brush');
const rulesWithBrush = await rules();
record('no-rule-with-nothing-after-it', rulesWithText === rulesWithBrush - 1,
  `${rulesWithText} separators with the text tool, ${rulesWithBrush} with the brush`);

/* ---- the mode picker ------------------------------------------------------------------ */

const modeSetting = () => page.evaluate(() => window.editor.getToolSetting('brushMode'));
const trigger = page.locator('#settings-panel-container [aria-haspopup="dialog"]');

const before = await trigger.innerText();
await trigger.click();
await page.waitForTimeout(300);
const offered = await page.evaluate(() =>
  Array.from(document.querySelectorAll('[role="menuitemradio"]')).map((b) => b.innerText.trim()));
await page.keyboard.press('ArrowRight');
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
record('a-mode-is-picked-by-name',
  offered.join(',') === 'None,Inside,Outside,Merge'
  && (await modeSetting()) === 'inside'
  && (await trigger.innerText()).includes('Inside'),
  `offered ${offered.join(' / ')}; arrow-then-Enter moved "${before.replace(/\s+/g, ' ')}" `
  + `to brushMode=${await modeSetting()}`);

await page.evaluate(() => window.editor.setToolSetting('brushMode', 'none'));
await page.waitForTimeout(200);

/* ---- the toggles ---------------------------------------------------------------------- */

const pressure = page.locator('#settings-panel-container [role="switch"]').first();
const settingsSnapshot = () => page.evaluate(() => ({
  pressure: window.editor.getToolSetting('pressureEnabled'),
  relative: window.editor.getToolSetting('relativeBrushSize'),
  size: window.editor.getToolSetting('brushSize'),
}));
const wasOn = await settingsSnapshot();
await pressure.click();
await page.waitForTimeout(300);
const nowOn = await settingsSnapshot();
record('a-switch-flips-one-setting',
  nowOn.pressure === !wasOn.pressure && nowOn.relative === wasOn.relative && nowOn.size === wasOn.size
  && (await pressure.getAttribute('aria-checked')) === String(nowOn.pressure),
  `pressureEnabled ${wasOn.pressure} → ${nowOn.pressure}, and aria-checked says so`);
await pressure.click();
await page.waitForTimeout(200);

/* ---- the number still slides ----------------------------------------------------------- */

const size = page.locator('#tool-setting-brushSize');
await size.click();
await page.waitForTimeout(400);
const slid = await page.evaluate(() => ({
  open: !!document.querySelector('.settings-numeric-slider-container'),
  keptFocus: document.activeElement?.id === 'tool-setting-brushSize',
}));
await size.fill('42');
await page.keyboard.press('Tab');
await page.waitForTimeout(300);
record('the-number-still-slides-and-types',
  slid.open && slid.keptFocus && (await settingsSnapshot()).size === 42,
  `clicking the field opened the slider without taking focus off it, and typing set brushSize=42`);
await page.evaluate(() => window.editor.setToolSetting('brushSize', 10));

/* ---- the canvas follows the toolbar when it takes another row -------------------------- */

/*
 * The heights used to be two SCSS constants and a `calc(100% - 40px)`, so a toolbar that
 * grew would have grown OVER the canvas. They are column-flex now, which means the canvas
 * has to give the row back — and paper.js does not reflow on its own, so the engine has to
 * be told. Measured at a width where picking the brush costs a row, which is the only place
 * this can be observed at all.
 */
const narrow = await open(1280);
const stack = async (tool) => {
  await pick(narrow, tool);
  await narrow.waitForTimeout(600);
  return narrow.evaluate(() => {
    const bar = document.querySelector('.tool-box-container').getBoundingClientRect();
    const host = document.querySelector('#wick-canvas-container').getBoundingClientRect();
    return {
      bar: Math.round(bar.height),
      top: Math.round(host.top),
      barBottom: Math.round(bar.bottom),
      host: Math.round(host.height),
      paper: Math.round(window.paper.view.viewSize.height),
    };
  });
};
const oneRow = await stack('cursor');
const twoRows = await stack('brush');
record('the-canvas-gives-back-the-row',
  twoRows.bar > oneRow.bar
  && oneRow.top === oneRow.barBottom && twoRows.top === twoRows.barBottom
  && oneRow.host - twoRows.host === twoRows.bar - oneRow.bar
  && twoRows.paper === twoRows.host && oneRow.paper === oneRow.host,
  `the brush costs a row at 1280 (${oneRow.bar}px → ${twoRows.bar}px) and the canvas gives back `
  + `exactly that (${oneRow.host}px → ${twoRows.host}px), paper's view with it`);
await narrow.close();

record('no-page-errors', errors.length === 0, errors.slice(0, 3).join(' | ') || 'clean');

await page.close();
await browser.close();

for (const r of results) console.log(`${(r.ok ? 'ok' : 'FAIL').padEnd(5)} ${r.name.padEnd(34)} ${r.detail}`);
const broke = results.filter((r) => !r.ok);
if (broke.length) {
  console.error(`\n${broke.length} failing: ${broke.map((r) => r.name).join(', ')}`);
  process.exit(1);
}
console.log('\nok — the toolbar names what it holds, and holds all of it');
