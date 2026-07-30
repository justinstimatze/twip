/*
 * inspector-check.mjs — the Inspector's labels fit, at every width the sidebar has.
 *
 * The panel used to split each row 30% label / 70% field. Those are percentages of a sidebar
 * the user can only drag between 200px and 300px (Editor.jsx, the `sidebar` panel), so 30%
 * was never more than 85px and never less than 55px. Measured across all the label strings
 * Inspector.jsx can render, at 14px bold Archivo: ten overflowed 55px, and "Full Rotations"
 * (93px) and "Stroke Width" (86px) overflowed at every width the panel can be. Both were
 * clipped mid-word permanently, with no drag that could reveal them, while the same 30% was
 * spending 85px on a label reading "Y".
 *
 * Every one of the ten sat on a row with a single field. The two-label rows — Origin X/Y,
 * Width/Height, Fill/Opacity — never clipped, because their labels are short by construction
 * and there is no room in that shape to give anyway. So the label now sizes to its text with
 * the old 30% as a floor, and the field takes what is left.
 *
 * The label list is read out of Inspector.jsx rather than written down here, and the widths
 * come out of Editor.jsx. A label added tomorrow is covered by this the day it lands, which
 * is the only version of this check worth having: the failure it exists to catch is someone
 * writing a longer label than the column, and nobody looks at the panel at 200px.
 *
 * Two measurement notes, both learned the hard way while writing this:
 *
 * scrollWidth is useless here. The label is a flex column whose only child is an anonymous
 * text box, so scrollWidth reports the container and a clipped label looks like it fits.
 * Widths come from a Range over the text node, which is what layout actually did.
 *
 * canvas measureText disagrees with layout by up to a pixel and in both directions, which is
 * enough to invent a clip that is not there and to miss one that is. It is fine for ranking
 * strings, and it is not fine for deciding whether one fits.
 *
 *   node dev/inspector-check.mjs
 *   node dev/inspector-check.mjs --headed
 *
 * Env: SMOKE_URL (default http://localhost:3000), PLAYWRIGHT_CHANNEL (see dev/browser.mjs).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { launch, URL_ } from './browser.mjs';

const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'Editor');

/* Every string the panel can put in a label. tooltip is the single-label rows, tooltip1 and
 * tooltip2 the two-label ones — the prop is named for what it used to be.
 *
 * The whole Inspector tree, not just Inspector.jsx: the tabs moved the Document tab's rows
 * into their own file, and a check that reads one file only keeps its promise — "a label
 * added tomorrow is covered the day it lands" — until somebody adds a component. */
const LABELS = [...new Set(
  [...jsxUnder(join(src, 'Panels', 'Inspector'))]
    .flatMap((file) => [...readFileSync(file, 'utf8').matchAll(/tooltip[12]?="([^"]+)"/g)])
    .map((m) => m[1])
)];

function * jsxUnder (dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield * jsxUnder(path);
    else if (entry.name.endsWith('.jsx')) yield path;
  }
}
const LONGEST = LABELS.reduce((a, b) => (b.length > a.length ? b : a), '');

/* The sidebar's own range, so this tests the widths that exist rather than three guesses. */
const editorSource = readFileSync(join(src, 'Editor.jsx'), 'utf8');
const sidebar = editorSource.slice(editorSource.indexOf('id="sidebar"'), editorSource.indexOf('id="sidebar"') + 400);
const num = (prop, fallback) => {
  const m = sidebar.match(new RegExp(`${prop}=\\{(\\d+)\\}`));
  return m ? Number(m[1]) : fallback;
};
const WIDTHS = [...new Set([num('minSize', 200), num('defaultSize', 250), num('maxSize', 300)])];

const browser = await launch({ headless: !process.argv.includes('--headed') });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`[uncaught] ${e.message}`));

await page.goto(URL_, { waitUntil: 'networkidle', timeout: 60_000 });
await page.waitForFunction(() => window.editor && window.editor.project, null, { timeout: 30_000 });
await page.waitForTimeout(2500);

const results = [];
const record = (name, ok, detail) => results.push({ name, ok, detail });

// A path selection is the densest the panel gets: eight rows, both row shapes, a slider.
await page.locator('#tool-button-rectangle').click();
await page.waitForTimeout(250);
await page.mouse.move(400, 300);
await page.mouse.down();
await page.mouse.move(560, 420, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(800);
await page.locator('#tool-button-cursor').click();
await page.waitForTimeout(250);
await page.mouse.click(480, 360);
await page.waitForTimeout(800);

const selection = await page.evaluate(() => window.editor.getSelectionType());
record('panel-has-rows', selection === 'path', `selected a ${selection}, which renders both row shapes`);

/* The sidebar is a resizable pane with no handle worth driving from a script, so pin its
 * element instead. What is under test is the row CSS at a width, not the drag. */
const pin = (px) => page.evaluate((width) => {
  let el = document.querySelector('[aria-label="Inspector Panel"]');
  while (el && el.parentElement) {
    if (el.parentElement.getBoundingClientRect().width > 1000) break;
    el = el.parentElement;
  }
  if (!el) return null;
  el.style.setProperty('flex', `0 0 ${width}px`, 'important');
  el.style.setProperty('width', `${width}px`, 'important');
  return Math.round(el.getBoundingClientRect().width);
}, px);

const audit = (longest) => page.evaluate((LONG) => {
  const textWidth = (el) => {
    const node = [...el.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
    if (!node) return 0;
    const r = document.createRange();
    r.selectNodeContents(node);
    return r.getBoundingClientRect().width;
  };
  const inner = (el) => {
    const cs = getComputedStyle(el);
    return el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  };
  const rows = [...document.querySelectorAll('.inspector-content .flex.flex-row')]
    .filter((r) => r.querySelector('label'));

  const read = () => {
    const clipped = [];
    const overflowed = [];
    const columns = [];
    for (const row of rows) {
      const width = row.getBoundingClientRect().width;
      let children = 0;
      for (const kid of row.children) children += kid.getBoundingClientRect().width;
      // Half a pixel of slop: layout rounds, and a row that is over by less than that is
      // not a row anyone can see is over.
      if (children - width > 0.5) {
        overflowed.push(`${row.textContent.trim().slice(0, 20)} by ${(children - width).toFixed(1)}px`);
      }
      for (const l of row.querySelectorAll('label')) {
        const need = textWidth(l);
        const have = inner(l);
        if (need - have > 0.5) clipped.push(`${l.textContent.trim()} short ${(need - have).toFixed(1)}px`);
        columns.push({ text: l.textContent.trim(), box: l.clientWidth, needs: need + (l.clientWidth - have) });
      }
    }
    return { clipped, overflowed, columns, rows: rows.length };
  };

  const real = read();

  // The long labels live on tween and text selections this cannot build. The CSS that has to
  // hold for them is the CSS on the rows already here, so write the longest one into them.
  const singles = rows.filter((r) => r.querySelectorAll('label').length === 1);
  const originals = singles.map((r) => { const l = r.querySelector('label'); return [l, l.textContent]; });
  for (const [l] of originals) l.textContent = LONG;
  const stressed = read();
  for (const [l, text] of originals) l.textContent = text;

  return { real, stressed, singles: singles.length };
}, longest);

const clipped = [];
const overflowed = [];
const stressClipped = [];
const misaligned = [];
const seen = [];

for (const width of WIDTHS) {
  const actual = await pin(width);
  await page.waitForTimeout(350);
  const { real, stressed, singles } = await audit(LONGEST);
  seen.push(`${actual}px:${real.rows} rows/${singles} single`);
  clipped.push(...real.clipped.map((c) => `${width}px ${c}`));
  overflowed.push(...real.overflowed.map((o) => `${width}px ${o}`));
  stressClipped.push(...stressed.clipped.map((c) => `${width}px ${c}`),
                     ...stressed.overflowed.map((o) => `${width}px ${o}`));

  /* The percentage split gave every row the same label column for free. An intrinsic one has
   * to earn it, and the promise it can actually keep is narrower: a label that fits the floor
   * sits exactly on it, and only a label that does not fit takes more. `needs` is the whole
   * box the text wants, gutter included — comparing bare text against a padded floor is what
   * made this case fail on a label that was behaving. */
  const floor = Math.min(...real.columns.map((c) => c.box));
  const odd = real.columns.filter((c) => c.needs <= floor && Math.abs(c.box - floor) > 0.5);
  if (odd.length) misaligned.push(`${width}px: ${odd.map((c) => `${c.text} ${c.box}`).join(', ')} against ${floor}`);
  const spread = Math.max(...real.columns.map((c) => c.box)) - floor;
  if (spread > 0.5) seen.push(`${width}px label column ${floor}-${floor + spread}`);
}

record('reads-the-real-widths', WIDTHS.length === 3,
  `sidebar range from Editor.jsx: ${WIDTHS.join(', ')}px — ${seen.join('  ')}`);
record('knows-every-label', LABELS.length > 30,
  `${LABELS.length} label strings across the Inspector, longest "${LONGEST}"`);
record('nothing-clips', clipped.length === 0,
  clipped.join(' | ') || `every rendered label fits at ${WIDTHS.join('/')}px`);
record('nothing-overflows', overflowed.length === 0,
  overflowed.join(' | ') || 'no row is wider than the panel it is in');
record('longest-label-fits', stressClipped.length === 0,
  stressClipped.join(' | ') || `single-field rows relabelled "${LONGEST}" still fit at ${WIDTHS.join('/')}px`);
record('short-labels-align', misaligned.length === 0,
  misaligned.join(' | ') || 'labels that fit the floor all share one column');
record('no-page-errors', errors.length === 0, errors.join(' | ') || 'clean');

await browser.close();

for (const r of results) {
  console.log(`${(r.ok ? 'ok' : 'FAIL').padEnd(5)} ${r.name.padEnd(22)} ${r.detail}`);
}

const broke = results.filter((r) => !r.ok);
if (broke.length) {
  console.error(`\n${broke.length} failing: ${broke.map((r) => r.name).join(', ')}`);
  process.exit(1);
}
console.log('\nok — every Inspector label fits its row');
