/*
 * tabs-check.mjs — every export tab has to show its own panel.
 *
 * `TabbedInterface` pairs a tab to its body by position. `ExportOptions` filters the tab
 * names but gates the bodies inline, so an excluded type leaves `false` sitting in the
 * children array: names arrive dense, bodies arrive sparse, and clicking a tab past the
 * first hole lands on a `false` and renders nothing. At full length the two lists line up
 * by luck, which is why the default install never showed it — only a platform narrowing
 * `window.allowedExportTypes` does.
 *
 * Checked here by narrowing that list and clicking every tab, because the failure is a panel
 * that renders empty while everything around it looks correct.
 *
 *   node dev/tabs-check.mjs
 *
 * Env: SMOKE_URL (default http://localhost:3000), PLAYWRIGHT_CHANNEL (see dev/browser.mjs).
 */
import { launch, URL_ } from './browser.mjs';

/* Every subset worth asking about: one hole, several holes, and a hole at the end. */
const CASES = [
  ['SWF', 'Images'],
  ['SWF', 'Audio', 'Images'],
  ['SWF', 'Animation'],
  ['SWF', 'Animation', 'Interactive', 'Audio', 'Images'],
];

const browser = await launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`[uncaught] ${e.message}`));

await page.goto(URL_, { waitUntil: 'networkidle', timeout: 60_000 });
await page.waitForFunction(() => window.editor && window.editor.openModal, null, { timeout: 30_000 });

const results = [];
for (const allowed of CASES) {
  const empty = await page.evaluate(async (allowedTypes) => {
    const sleep = (ms) => new Promise(res => setTimeout(res, ms));
    window.allowedExportTypes = allowedTypes.concat([]);
    window.editor.openModal('ExportOptions');
    await sleep(400);

    const tabs = Array.from(document.querySelectorAll('.tabbed-interface-main-tab'));
    const blank = [];
    for (const tab of tabs) {
      tab.click();
      await sleep(150);
      const body = document.querySelector('.tabbed-interface-body');
      // A panel with no elements in it is the symptom. Text alone is not enough to look
      // for — some panels are mostly controls.
      if (!body || body.children.length === 0) blank.push(tab.textContent.trim());
    }
    const names = tabs.map(t => t.textContent.trim());
    window.editor.closeActiveModal();
    await sleep(200);
    return { names, blank };
  }, allowed);
  results.push({ allowed, ...empty });
}

await browser.close();

for (const r of results) {
  console.log(`allowed [${r.allowed.join(', ')}] -> tabs [${r.names.join(', ')}]`
    + (r.blank.length ? `  BLANK: ${r.blank.join(', ')}` : '  all panels rendered'));
}

const fail = [];
for (const r of results) {
  if (r.names.length === 0) fail.push(`[${r.allowed.join(', ')}]: the export modal showed no tabs at all`);
  if (r.blank.length) fail.push(`[${r.allowed.join(', ')}]: empty panel behind ${r.blank.join(', ')}`);
}
// The narrowed cases are the point; if they stopped narrowing, this check stopped checking.
if (results[0] && results[0].names.length !== 2) {
  fail.push(`the first case should render 2 tabs, rendered ${results[0].names.length} — narrowing no longer works`);
}
if (errors.length) fail.push(...errors);

if (fail.length) { console.error('FAILED:\n  ' + fail.join('\n  ')); process.exit(1); }
console.log('ok — every tab shows its own panel, at every subset');
