/*
 * Headless runner for the Wick engine's mocha suite.
 *
 * `tests/index.html` loads dist/wickengine.js plus ~69 test files as plain script tags and
 * calls mocha.run() on load. It has always been browser-only with no npm script, so the
 * 39k lines of tests in here were never part of any check. This runs the same page in
 * headless Chrome and exits non-zero on failure.
 *
 * Uses the system Chrome (channel: 'chrome') rather than a Playwright-managed browser, so
 * `pnpm test` needs no ~150MB browser download. CI has no system Chrome it can rely on and
 * sets PLAYWRIGHT_CHANNEL='' to get Playwright's own chromium instead.
 *
 * Seven cases fail in the committed dist/wickengine.js and always have. Exiting non-zero on
 * them means the other 540 gate nothing, so known-failures.json lists them by title and only
 * an unlisted failure is fatal. --strict ignores the list.
 *
 * Usage:  node tests/run.mjs [--headed] [--grep <pattern>] [--strict]
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ENGINE_ROOT = fileURLToPath(new URL('..', import.meta.url));

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.woff': 'font/woff',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.zip': 'application/zip',
};

// Serve engine/ as the root: tests/index.html reaches up to ../dist/wickengine.js.
const server = createServer(async (req, res) => {
  const rel = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  try {
    const body = await readFile(join(ENGINE_ROOT, rel));
    res.writeHead(200, { 'Content-Type': MIME[extname(rel)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});

// Wrap mocha.run() before the page's own scripts run, so the runner's events are
// observable. mocha.js assigns window.mocha, which this property trap intercepts.
const INSTRUMENT = () => {
  let instance;
  Object.defineProperty(window, 'mocha', {
    configurable: true,
    get: () => instance,
    set: (m) => {
      instance = m;
      const run = m.run.bind(m);
      m.run = (...args) => {
        const runner = run(...args);
        // Non-enumerable: the suite calls mocha.checkLeaks(), which walks Object.keys(global)
        // and would otherwise report the runner's own bookkeeping as a leaked global.
        const results = { passes: 0, failures: 0, failed: [] };
        const hide = (name, value) => Object.defineProperty(window, name, {
          value, enumerable: false, writable: true, configurable: true,
        });
        hide('__results', results);
        hide('__done', false);
        runner.on('pass', () => results.passes++);
        runner.on('fail', (test, err) => {
          results.failures++;
          results.failed.push({ title: test.fullTitle(), message: err && err.message });
        });
        runner.on('end', () => { window.__done = true; });
        return runner;
      };
    },
  });
};

const args = process.argv.slice(2);
const headed = args.includes('--headed');
const strict = args.includes('--strict');
const grepAt = args.indexOf('--grep');
const grep = grepAt === -1 ? null : args[grepAt + 1];

const allowed = strict ? [] : JSON.parse(
  await readFile(new URL('./known-failures.json', import.meta.url), 'utf8'),
).allowedFailures;
const allowedTitles = new Set(allowed.map(f => f.title));

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();

const channel = process.env.PLAYWRIGHT_CHANNEL ?? 'chrome';
const browser = await chromium.launch({ channel: channel || undefined, headless: !headed });
const url = `http://127.0.0.1:${port}/tests/index.html${grep ? `?grep=${encodeURIComponent(grep)}` : ''}`;

const runSuite = async () => {
  const page = await browser.newPage();
  page.on('pageerror', err => console.error('[page error]', err.message));
  await page.addInitScript(INSTRUMENT);
  await page.goto(url);
  // The whole suite runs in ~10s on this box, so 120s is 12x headroom. Deliberately not
  // larger: this timeout is also what catches a bundle that fails to load and never calls
  // mocha.run(), and a 10-minute hang there is worse than a fast, wrong-looking failure.
  await page.waitForFunction(() => window.__done === true, null, { timeout: 120_000 });
  const r = await page.evaluate(() => window.__results);
  await page.close();
  return r;
};

const results = await runSuite();
let unexpected = results.failed.filter(f => !allowedTitles.has(f.title));
const known = results.failed.filter(f => allowedTitles.has(f.title));

/*
 * Several cases here time out under load rather than failing on their merits — mocha's
 * default is 2000ms and a busy box blows it. Rather than allowlist each one and lose the
 * assertion, run the suite a second time when something unexpected failed and keep only what
 * failed both times. A real regression fails twice; a loaded runner does not go red.
 * Costs ~10s, and only on a run that was going to be red anyway.
 */
if (unexpected.length > 0) {
  console.error(`retrying — ${unexpected.length} unexpected failure(s), keeping only what fails twice`);
  const second = await runSuite();
  const failedAgain = new Set(second.failed.map(f => f.title));
  for (const f of unexpected) {
    if (!failedAgain.has(f.title)) console.error('FLAKY', `${f.title} :: ${f.message} (passed on retry)`);
  }
  unexpected = unexpected.filter(f => failedAgain.has(f.title));
}

for (const f of unexpected) console.error('FAIL', `${f.title} :: ${f.message}`);
for (const f of known) console.error('known', `${f.title} :: ${f.message}`);

/*
 * A listed failure that passed means the list is stale — the entry should come out, or the
 * test will rot back to failing without anyone noticing. Reported, not fatal. Entries marked
 * `intermittent` are exempt: some fail only under load, others only where the machine differs
 * (audio sample rate), and passing is their normal case. Meaningless under --grep, which
 * decides what ran.
 */
if (!strict && !grep) {
  const failedTitles = new Set(results.failed.map(f => f.title));
  for (const f of allowed) {
    if (!f.intermittent && !failedTitles.has(f.title)) console.error('STALE', `${f.title} — passes now; drop it from known-failures.json`);
  }
}

console.log(`${results.passes} passed, ${unexpected.length} failed, ${known.length} known`);
process.exit(unexpected.length > 0 ? 1 : 0);
