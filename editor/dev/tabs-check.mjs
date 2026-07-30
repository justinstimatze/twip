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
 * And the rail's roles, which had the same shape of problem: it carried role="tablist" over a
 * row of plain buttons. A tablist whose children are not tabs is invalid on its own terms, and
 * what a screen reader got out of it was a group of buttons with no notion of which one was
 * current or how many there were — while the tab bar looked, to a sighted mouse user, exactly
 * as it does now. The keyboard case is the other half: without a roving tabindex there was no
 * way through the rail but Tab-and-Enter through every tab in it.
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
    const unwired = [];
    for (const tab of tabs) {
      tab.click();
      await sleep(150);
      const body = document.querySelector('.tabbed-interface-body');
      // A panel with no elements in it is the symptom. Text alone is not enough to look
      // for — some panels are mostly controls.
      if (!body || body.children.length === 0) blank.push(tab.textContent.trim());
      // And the panel on screen has to be the one this tab claims to control. A tablist
      // whose aria-controls points elsewhere reads correct and navigates wrong.
      if (!body || body.id !== tab.getAttribute('aria-controls')
        || tab.getAttribute('aria-selected') !== 'true'
        || body.getAttribute('aria-labelledby') !== tab.id) {
        unwired.push(tab.textContent.trim());
      }
    }
    const list = document.querySelector('.tabbed-interface-main-tab-container');
    const aria = {
      listRole: list && list.getAttribute('role'),
      listNamed: !!(list && list.getAttribute('aria-label')),
      allTabs: tabs.every(t => t.getAttribute('role') === 'tab'),
      oneStop: tabs.filter(t => t.tabIndex === 0).length,
    };
    const names = tabs.map(t => t.textContent.trim());
    window.editor.closeActiveModal();
    await sleep(200);
    return { names, blank, unwired, aria };
  }, allowed);
  results.push({ allowed, ...empty });
}

/*
 * Arrows, and the roving tabindex that makes them the only way in. The rail carried
 * role="tablist" over plain buttons for years — invalid on its own terms, since a tablist's
 * children have to be tabs, and unusable from a keyboard beyond Tab-and-Enter through every
 * one of them.
 */
const keyboard = await page.evaluate(async () => {
  const sleep = (ms) => new Promise(res => setTimeout(res, ms));
  window.allowedExportTypes = ['SWF', 'Animation', 'Audio'];
  window.editor.openModal('ExportOptions');
  await sleep(400);
  const first = document.querySelector('.tabbed-interface-main-tab');
  first.focus();
  const press = (key) => document.activeElement.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true }));
  press('ArrowRight');
  await sleep(200);
  const afterRight = { selected: document.activeElement.textContent.trim(),
    isSelected: document.activeElement.getAttribute('aria-selected') === 'true' };
  press('End');
  await sleep(200);
  const afterEnd = document.activeElement.textContent.trim();
  const tabs = Array.from(document.querySelectorAll('.tabbed-interface-main-tab'));
  window.editor.closeActiveModal();
  await sleep(200);
  return { afterRight, afterEnd, last: tabs[tabs.length - 1].textContent.trim() };
});

await browser.close();

for (const r of results) {
  console.log(`allowed [${r.allowed.join(', ')}] -> tabs [${r.names.join(', ')}]`
    + (r.blank.length ? `  BLANK: ${r.blank.join(', ')}` : '  all panels rendered')
    + (r.unwired.length ? `  UNWIRED: ${r.unwired.join(', ')}` : '  each tab names its own panel'));
}
console.log(`keyboard: ArrowRight selected "${keyboard.afterRight.selected}" and took focus with it, `
  + `End landed on "${keyboard.afterEnd}" (last tab is "${keyboard.last}")`);

const fail = [];
for (const r of results) {
  if (r.names.length === 0) fail.push(`[${r.allowed.join(', ')}]: the export modal showed no tabs at all`);
  if (r.blank.length) fail.push(`[${r.allowed.join(', ')}]: empty panel behind ${r.blank.join(', ')}`);
  if (r.unwired.length) fail.push(`[${r.allowed.join(', ')}]: tab and panel not wired to each other behind ${r.unwired.join(', ')}`);
  if (r.aria.listRole !== 'tablist') fail.push(`[${r.allowed.join(', ')}]: the rail is not a tablist`);
  if (!r.aria.listNamed) fail.push(`[${r.allowed.join(', ')}]: the tablist has no accessible name`);
  if (!r.aria.allTabs) fail.push(`[${r.allowed.join(', ')}]: a child of the tablist is not a tab`);
  if (r.aria.oneStop !== 1) fail.push(`[${r.allowed.join(', ')}]: ${r.aria.oneStop} tab stops in the rail, want exactly 1`);
}
if (!keyboard.afterRight.isSelected || keyboard.afterEnd !== keyboard.last) {
  fail.push(`arrows do not walk the rail: right gave "${keyboard.afterRight.selected}" `
    + `(selected: ${keyboard.afterRight.isSelected}), End gave "${keyboard.afterEnd}" not "${keyboard.last}"`);
}
// The narrowed cases are the point; if they stopped narrowing, this check stopped checking.
if (results[0] && results[0].names.length !== 2) {
  fail.push(`the first case should render 2 tabs, rendered ${results[0].names.length} — narrowing no longer works`);
}
if (errors.length) fail.push(...errors);

if (fail.length) { console.error('FAILED:\n  ' + fail.join('\n  ')); process.exit(1); }
console.log('ok — every tab shows its own panel, at every subset');
