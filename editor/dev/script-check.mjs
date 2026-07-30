/*
 * script-check.mjs — a script typed into the editor is the script that compiles.
 *
 * src/script.rs proves a loop compiles and tests/goldens/script-logic.png proves it runs.
 * Neither touches the way a person gets a loop into a document, which is the gap that made
 * gradients look broken twice: a compiler that works and an authoring path nobody drove.
 *
 * The surface is CodeMirror 6 — a contenteditable, not a textarea — so `fill` does not reach
 * it and neither does setting `.value`. Typing is the only gesture that produces the
 * `docChanged` update the editor listens for, which is also why hotkeys-check has a case
 * about this same surface swallowing keys.
 *
 * The script is deliberately one the OLD compiler could not have handled. A `stop()` would
 * pass this check against a recogniser that only knows four statements; a `while` and a
 * comparison only reach the movie through a real parser.
 *
 *   node dev/script-check.mjs
 *   node dev/script-check.mjs --headed
 *
 * Env: SMOKE_URL (default http://localhost:3000), PLAYWRIGHT_CHANNEL (see dev/browser.mjs).
 */
import { launch, URL_ } from './browser.mjs';

const SOURCE = 'var n = 0;\nwhile (n < 3) { n++; }\nif (n == 3) { stop(); }';

const browser = await launch({ headless: !process.argv.includes('--headed') });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`[uncaught] ${e.message}`));

await page.goto(URL_, { waitUntil: 'networkidle', timeout: 60_000 });
await page.waitForFunction(() => window.editor && window.editor.project, null, { timeout: 30_000 });
await page.waitForTimeout(2500);

const results = [];
const record = (name, ok, detail) => results.push({ name, ok, detail });

/* Draw something, so the frame is a frame a person would be scripting. */
await page.locator('#tool-button-rectangle').first().click();
await page.waitForTimeout(200);
await page.mouse.move(450, 300);
await page.mouse.down();
await page.mouse.move(700, 500, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(600);

/* Open the script editor on the active frame, the way the editor's own action does. */
await page.evaluate(() => {
  const project = window.editor.project;
  project.selection.clear();
  project.selection.select(project.activeFrame);
  window.editor.editScript('default');
});
await page.waitForTimeout(1200);

const surface = page.locator('.wick-code-editor-surface .cm-content');
record('the-script-editor-opens', (await surface.count()) === 1,
  `${await surface.count()} CodeMirror surface(s) for the selected frame`);

/* Type it. CodeMirror 6 renders a contenteditable, so `fill` and setting `.value` both do
   nothing — only real keystrokes produce the docChanged update the editor listens for. */
await surface.click();
await page.waitForTimeout(300);
await page.keyboard.type(SOURCE, { delay: 8 });
await page.waitForTimeout(900);

const stored = await page.evaluate(() => {
  const frame = window.editor.project.activeFrame;
  const script = frame.scripts.find((s) => s.name === 'default');
  return script ? script.src : null;
});
// CodeMirror auto-closes brackets, so what lands in the document can carry extra `}`. What
// matters is that the statements arrived, not that the text is byte-identical to the input.
const arrived = stored !== null
  && stored.includes('var n = 0')
  && stored.includes('while (n < 3)')
  && stored.includes('n++')
  && stored.includes('stop()');
record('typing-reaches-the-document', arrived,
  stored === null ? 'no default script on the frame' : `the frame holds ${JSON.stringify(stored)}`);

/* And the document reaches the movie. A compile error here is the real answer about this
   script — the compiler refuses a whole script rather than half of it — so a thrown error
   means what was typed did not survive the trip. */
const compiled = await page.evaluate(async () => {
  try {
    const bytes = await new Promise((resolve) =>
      window.Wick.WickFile.toWickFile(window.editor.project, (file) =>
        file.arrayBuffer().then((b) => resolve(new Uint8Array(b))), 'blob'));
    const { blob, skipped } = await window.editor.compileWickToSWF(bytes);
    const head = new Uint8Array(await blob.slice(0, 3).arrayBuffer());
    return { size: blob.size, skipped, signature: String.fromCharCode(...head) };
  } catch (e) {
    return { error: String(e && e.message ? e.message : e) };
  }
});
record('the-typed-script-compiles',
  !compiled.error && ['FWS', 'CWS'].includes(compiled.signature) && compiled.skipped === '',
  compiled.error
    ? `the compiler refused it: ${compiled.error}`
    : `${compiled.size} bytes of ${compiled.signature}, nothing reported skipped`);

/* What the compiler cannot read, it says so about — through the same surface, so the report
   is reachable from where the script was written rather than only from a terminal. */
await surface.click();
await page.keyboard.press('Control+a');
await page.keyboard.type('frobnicate(9);', { delay: 8 });
await page.waitForTimeout(900);
const refused = await page.evaluate(async () => {
  const bytes = await new Promise((resolve) =>
    window.Wick.WickFile.toWickFile(window.editor.project, (file) =>
      file.arrayBuffer().then((b) => resolve(new Uint8Array(b))), 'blob'));
  try {
    const { skipped } = await window.editor.compileWickToSWF(bytes);
    return { skipped };
  } catch (e) {
    return { error: String(e && e.message ? e.message : e) };
  }
});
record('an-unreadable-script-is-named-not-dropped',
  !refused.error && /frobnicate/.test(refused.skipped || ''),
  refused.error ? `threw instead: ${refused.error}` : `the export reports ${JSON.stringify(refused.skipped)}`);

record('no-page-errors', errors.length === 0, errors.slice(0, 3).join(' | ') || 'clean');

await browser.close();

for (const r of results) console.log(`${(r.ok ? 'ok' : 'FAIL').padEnd(5)} ${r.name.padEnd(36)} ${r.detail}`);
const broke = results.filter((r) => !r.ok);
if (broke.length) {
  console.error(`\n${broke.length} failing: ${broke.map((r) => r.name).join(', ')}`);
  process.exit(1);
}
console.log('\nok — a script typed into the editor is the script that compiles');
