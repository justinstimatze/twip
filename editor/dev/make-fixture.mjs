/*
 * make-fixture.mjs — author a .wick with the engine that actually ships, and write it to
 * ../fixtures/.
 *
 * Every fixture in the crate was authored by wickengine 2021.1.22 on wickeditor.com, five
 * years before the engine vendored here. So the parser has only ever been tested against a
 * serialization format nothing in this repo produces, and drift in Path.json or the tween
 * fields would be invisible: real saves would mis-parse while every test stayed green.
 *
 * The shape drawn here comes from the real Rectangle tool through real mouse events, and the
 * tween from the engine's own createTween, so the output is what a user's save contains rather
 * than what someone believed it should contain. Hand-built JSON is what brush-donut.wick and
 * skew-tween.wick did, and it cannot catch drift by construction.
 *
 *   node dev/make-fixture.mjs [name]      # default: editor-tween
 *
 * Needs a server: pnpm dev, or pnpm preview with SMOKE_URL set.
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launch, URL_ } from './browser.mjs';

/*
 * What easing the first key gets, per fixture. `custom-easing` is the one that exercises the
 * divergence: `bezier` is a field wickeditor.com has never written, so the only way to get a
 * .wick containing one is to author it here, with the engine that ships. The control points
 * are deliberately lopsided — a symmetric curve would agree with linear at the midpoint,
 * which is the one sample a compiler test is most likely to take.
 */
const EASING = {
  'editor-tween': { easingType: 'out-bounce' },
  'custom-easing': { easingType: 'custom', bezier: [0.9, 0.05, 0.95, 0.4] },
};

const name = process.argv[2] || 'editor-tween';
const out = path.join(new URL('../../fixtures/', import.meta.url).pathname, `${name}.wick`);

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', (m) => { if (m.type() === 'error') console.log('  page error:', m.text()); });

await page.goto(URL_, { waitUntil: 'networkidle', timeout: 60_000 });
// The engine mounts imperatively from componentDidMount, same wait the other dev scripts use.
await page.waitForTimeout(2500);

// Draw with the actual tool. page.mouse drives the same paper.js path the user would get.
await page.locator('#tool-button-rectangle').first().click();
await page.waitForTimeout(200);
await page.mouse.move(400, 300);
await page.mouse.down();
await page.mouse.move(560, 420, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(600);

const built = await page.evaluate(([easing]) => {
  const e = window.editor;
  const project = e.project;
  const frame = project.activeFrame;
  if (!frame) return { error: 'no active frame' };
  if (frame.paths.length === 0) return { error: 'the rectangle tool drew nothing' };

  // Two seconds at the default 12fps.
  frame.end = 24;

  // createTween wraps a lone path into a Clip and keys the clip's current transform, which
  // is exactly what pressing Shift+T in the UI does.
  project.activeTimeline.playheadPosition = 1;
  frame.createTween();
  if (frame.tweens.length === 0) return { error: 'no tween created' };
  frame.tweens[0].easingType = easing.easingType;
  if (easing.bezier) frame.tweens[0].bezier = easing.bezier;

  // Second key: move the clip, then capture. Order matters — createTween copies the
  // transform as it finds it.
  project.activeTimeline.playheadPosition = 24;
  const clip = frame.clips[0];
  if (!clip) return { error: 'createTween did not produce a clip' };
  clip.transformation.x += 320;
  clip.transformation.scaleX = 1.5;
  clip.transformation.scaleY = 1.5;
  frame.createTween();

  project.view.render();
  return {
    engine: project.metadata ? project.metadata.wickengine : '(no metadata yet)',
    framerate: project.framerate,
    width: project.width,
    height: project.height,
    paths: frame.paths.length,
    clips: frame.clips.length,
    tweens: frame.tweens.map((t) => ({ at: t.playheadPosition, easing: t.easingType, bezier: t.bezier })),
    frameSpan: [frame.start, frame.end],
  };
}, [EASING[name] || EASING['editor-tween']]);

if (built.error) {
  console.error('could not build the project:', built.error);
  await browser.close();
  process.exit(1);
}
console.log('built:', JSON.stringify(built, null, 2));

// base64 rather than a blob download: the Tauri webview has no download handler, and going
// through the browser's save path would only test FileSaver.
const b64 = await page.evaluate(() => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('toWickFile did not call back')), 30_000);
  window.Wick.WickFile.toWickFile(window.editor.project, (data) => {
    clearTimeout(t);
    resolve(data);
  }, 'base64');
}));

// toWickFile hands back a data URL in base64 mode.
const comma = b64.indexOf(',');
const bytes = Buffer.from(comma === -1 ? b64 : b64.slice(comma + 1), 'base64');
await writeFile(out, bytes);
console.log(`wrote ${out} (${bytes.length} bytes)`);

await browser.close();
