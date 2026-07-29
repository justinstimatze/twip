/*
 * wasm-check.mjs — press the browser's compile path and check it against the native one.
 *
 * The SWF button has three routes (EditorCore.compileWickToSWF) and until now only two of
 * them were ever exercised: the desktop shell by hand, the dev bridge by hand. The browser
 * route is the one a stranger gets, and it is the one nothing watched.
 *
 * The assertion is byte-for-byte agreement between the wasm build and `cargo build --bin
 * twip`, on the same input. Weaker checks — "starts with CWS", "is more than 200 bytes" —
 * pass for a compiler that has quietly diverged, and quiet divergence is the whole risk of
 * shipping the same source through two very different backends.
 *
 *   node dev/wasm-check.mjs
 *   node dev/wasm-check.mjs --headed
 *
 * Env: SMOKE_URL (default http://localhost:3000), TWIP_BIN (default ../target/release/twip),
 *      PLAYWRIGHT_CHANNEL (see dev/browser.mjs).
 */
import { launch, URL_ } from './browser.mjs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const args = process.argv.slice(2);
const ROOT = path.dirname(path.dirname(fileURLToPath(new URL('.', import.meta.url))));
const FIXTURE = path.join(ROOT, 'fixtures', 'editor-tween.wick');
const TWIP_BIN = process.env.TWIP_BIN ?? path.join(ROOT, 'target', 'release', 'twip');

for (const [what, p, fix] of [
  ['fixture', FIXTURE, 'run `pnpm fixture` from editor/'],
  ['twip binary', TWIP_BIN, 'run `cargo build --release --bin twip` from the repo root, or set TWIP_BIN'],
]) {
  if (!existsSync(p)) { console.error(`no ${what} at ${p} — ${fix}`); process.exit(1); }
}

const wick = readFileSync(FIXTURE);

// The native answer first: if this fails there is no point starting a browser.
const out = path.join(mkdtempSync(path.join(tmpdir(), 'twip-wasm-check-')), 'native.swf');
execFileSync(TWIP_BIN, [FIXTURE, out], { stdio: 'inherit' });
const native = readFileSync(out);
console.log(`native: ${native.length} bytes from ${path.basename(FIXTURE)}`);

const browser = await launch({ headless: !args.includes('--headed') });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`[uncaught] ${e.message}`));

await page.goto(URL_, { waitUntil: 'networkidle', timeout: 60_000 });
await page.waitForFunction(() => window.editor && window.editor.compileWickToSWF, null, { timeout: 30_000 });

/*
 * Go through compileWickToSWF rather than importing the wasm module directly, so a wiring
 * mistake in the branch that chooses a route fails here too. The bridge is not running, so
 * a fallback surfaces as its own error rather than as a passing test.
 */
const result = await page.evaluate(async (bytes) => {
  try {
    const blob = await window.editor.compileWickToSWF(new Uint8Array(bytes));
    const buf = await blob.arrayBuffer();
    return { ok: true, bytes: Array.from(new Uint8Array(buf)) };
  } catch (e) {
    return { ok: false, message: String(e && e.message ? e.message : e) };
  }
}, Array.from(wick));

await browser.close();

if (!result.ok) { console.error(`compile failed in the page: ${result.message}`); process.exit(1); }

const wasm = Buffer.from(result.bytes);
console.log(`wasm:   ${wasm.length} bytes`);

if (!wasm.equals(native)) {
  const at = native.findIndex((b, i) => wasm[i] !== b);
  console.error(wasm.length !== native.length
    ? `length differs: wasm ${wasm.length}, native ${native.length}`
    : `bytes differ at offset ${at}: wasm 0x${wasm[at].toString(16)}, native 0x${native[at].toString(16)}`);
  process.exit(1);
}

if (errors.length) { console.error('console errors:\n  ' + errors.join('\n  ')); process.exit(1); }

console.log(`ok — the tab and the binary produced the same ${native.length} bytes`);
