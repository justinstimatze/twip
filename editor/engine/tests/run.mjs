/*
 * Headless runner for the Wick engine's mocha suite.
 *
 * `tests/index.html` loads dist/wickengine.js plus ~69 test files as plain script tags and
 * calls mocha.run() on load. It has always been browser-only with no npm script, so the
 * 39k lines of tests in here were never part of any check. This runs the same page in
 * headless Chrome and exits non-zero on failure.
 *
 * Uses the system Chrome (channel: 'chrome') rather than a Playwright-managed browser, so
 * `pnpm test` needs no ~150MB browser download.
 *
 * Usage:  node tests/run.mjs [--headed] [--grep <pattern>]
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
          results.failed.push(`${test.fullTitle()} :: ${err && err.message}`);
        });
        runner.on('end', () => { window.__done = true; });
        return runner;
      };
    },
  });
};

const args = process.argv.slice(2);
const headed = args.includes('--headed');
const grepAt = args.indexOf('--grep');
const grep = grepAt === -1 ? null : args[grepAt + 1];

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();

const browser = await chromium.launch({ channel: 'chrome', headless: !headed });
const page = await browser.newPage();
page.on('pageerror', err => console.error('[page error]', err.message));

const url = `http://127.0.0.1:${port}/tests/index.html${grep ? `?grep=${encodeURIComponent(grep)}` : ''}`;
await page.addInitScript(INSTRUMENT);
await page.goto(url);

// The whole suite runs in ~10s on this box, so 120s is 12x headroom. Deliberately not
// larger: this timeout is also what catches a bundle that fails to load and never calls
// mocha.run(), and a 10-minute hang there is worse than a fast, wrong-looking failure.
await page.waitForFunction(() => window.__done === true, null, { timeout: 120_000 });
const results = await page.evaluate(() => window.__results);

await browser.close();
server.close();

for (const failure of results.failed) console.error('FAIL', failure);
console.log(`${results.passes} passed, ${results.failures} failed`);
process.exit(results.failures > 0 ? 1 : 0);
