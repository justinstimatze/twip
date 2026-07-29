/*
 * framerate-check.mjs — what a new project starts at, and what the export does with it.
 *
 * Three separate facts have to line up before a project drawn at 12 plays back smoothly, and
 * they live in three different places: the authoring default in EditorCore.newProject, the
 * upsampling in the Rust compiler, and the localStorage escape hatch that turns it off.
 * Each is covered on its own — cargo tests the compiler, and the default is one line — but
 * "one line" is exactly the kind of thing that gets edited back to 30 by someone tidying up,
 * with no test anywhere noticing.
 *
 * The desktop shell serves this same build/ and shares every line of this path except the
 * final Tauri invoke, so running it against a served build is most of a desktop check that
 * this box cannot otherwise perform: there is no input injection here, so nothing can press
 * the shell's own buttons.
 *
 *   node dev/framerate-check.mjs           # against SMOKE_URL (default localhost:3000)
 *
 * Env: SMOKE_URL, PLAYWRIGHT_CHANNEL (see dev/browser.mjs).
 */
import { launch, URL_ } from './browser.mjs';

/** SWF header: signature, version, length, then a bit-packed stage rect, rate and count. */
function readHeader (bytes) {
  let i = 8;
  const nbits = bytes[i] >> 3;
  i += Math.ceil((5 + 4 * nbits) / 8);
  const rate = (bytes[i] | (bytes[i + 1] << 8)) / 256;
  const frames = bytes[i + 2] | (bytes[i + 3] << 8);
  return { rate, frames };
}

const browser = await launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`[uncaught] ${e.message}`));

await page.goto(URL_, { waitUntil: 'networkidle', timeout: 60_000 });
await page.waitForFunction(() => window.editor && window.editor.newProject, null, { timeout: 30_000 });

/*
 * Drive newProject() rather than reading the project already on screen: what a *new* document
 * starts at is the claim, and the mounted one could have come from an autosave.
 */
/*
 * Exports go through compileProjectToSWFBlob, the same call the SWF button makes, so a
 * mistake in the route-picking or the serialization fails here rather than passing. The
 * project on screen is the one exported: a blank document is still a document, and its
 * one frame is enough to read a header off.
 */
const probe = await page.evaluate(async () => {
  const authoring = window.editor.newProject().framerate;

  const swfAt = async (upsample) => {
    if (upsample) window.localStorage.removeItem('twip:upsample');
    else window.localStorage.setItem('twip:upsample', 'off');
    window.editor.project.framerate = authoring;
    const blob = await window.editor.compileProjectToSWFBlob();
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  };

  return { authoring, on: await swfAt(true), off: await swfAt(false) };
});

await browser.close();

const on = readHeader(probe.on);
const off = readHeader(probe.off);
console.log(`new project: ${probe.authoring}fps`);
console.log(`  upsample on:  ${on.rate}fps, ${on.frames} frames`);
console.log(`  upsample off: ${off.rate}fps, ${off.frames} frames`);

const fail = [];
if (probe.authoring !== 12) fail.push(`a new project starts at ${probe.authoring}fps, expected 12`);
if (on.rate !== 60) fail.push(`a 12fps project exported at ${on.rate}fps, expected 60`);
if (off.rate !== 12) fail.push(`twip:upsample=off exported at ${off.rate}fps, expected 12`);
if (on.frames !== off.frames * 5) {
  fail.push(`${on.frames} upsampled frames against ${off.frames} flat — expected a factor of 5`);
}
if (errors.length) fail.push(...errors);

if (fail.length) { console.error('FAILED:\n  ' + fail.join('\n  ')); process.exit(1); }
console.log(`ok — 12fps in, 60 out, and the page's own off switch brings it back to 12`);
