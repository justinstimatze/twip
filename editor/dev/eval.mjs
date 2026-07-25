/*
 * eval.mjs — run one expression in the page and print the result. Scratch tool for
 * inspecting engine state (project.view.fitMode, paper zoom, ...) while debugging.
 *
 *   node dev/eval.mjs --width 375 'window.project.view.fitMode'
 */
import { launch, URL_ } from './browser.mjs';

const args = process.argv.slice(2);
const value = (n) => { const i = args.indexOf(`--${n}`); return i === -1 ? null : args[i + 1]; };
const width = Number(value('width') ?? 1440);
const expr = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--width').join(' ');

const browser = await launch();
const page = await browser.newPage({ viewport: { width, height: 900 } });
page.on('pageerror', (e) => console.log(`[uncaught] ${e.message}`));
await page.goto(URL_, { waitUntil: 'networkidle', timeout: 60_000 });
await page.waitForTimeout(2500);
console.log(JSON.stringify(await page.evaluate(expr), null, 2));
await browser.close();
