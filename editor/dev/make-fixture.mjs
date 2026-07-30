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
  'dark-stage': { easingType: 'none' },
};

/*
 * Per-fixture project settings. `dark-stage` is the one that needs them: every other fixture
 * in the tree has the default white stage, which is also what a player shows when a movie
 * carries no SetBackgroundColor tag — so a compiler that dropped the colour entirely, as this
 * one did until the tag landed, rendered pixel-identical to one that kept it. A dark stage is
 * the only way the golden oracle can tell those two apart. The fill is set with it so the
 * shape stays visible against the stage rather than the fixture proving only that the
 * background changed.
 */
const PROJECT = {
  'dark-stage': { backgroundColor: '#1b1917', fill: '#ef4a2f' },
};

/*
 * `gradients` is a different shape of fixture and takes a different path below: three
 * rectangles, no tween. paper.js states a gradient as a ramp plus two points and means
 * something different by the points per kind — for a linear one they are the ends of the
 * ramp, for a radial one the centre and a point on the circle — so the three cases here are
 * exactly the three conversions, and a matrix that muddles them renders visibly wrong rather
 * than subtly so. The third adds a highlight, which is paper's name for what SWF calls a
 * focal point and can only carry on a DefineShape4.
 */
const GRADIENTS = [
  { at: [60, 60, 180, 180], radial: false, origin: [60, 60], destination: [240, 240] },
  { at: [280, 60, 180, 180], radial: true, origin: [370, 150], destination: [460, 150] },
  { at: [500, 60, 180, 180], radial: true, origin: [590, 150], destination: [680, 150],
    highlight: [550, 110] },
];

const name = process.argv[2] || 'editor-tween';
const out = path.join(new URL('../../fixtures/', import.meta.url).pathname, `${name}.wick`);

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', (m) => { if (m.type() === 'error') console.log('  page error:', m.text()); });

await page.goto(URL_, { waitUntil: 'networkidle', timeout: 60_000 });
// The engine mounts imperatively from componentDidMount, same wait the other dev scripts use.
await page.waitForTimeout(2500);

if (name === 'gradients') {
  const built = await page.evaluate((specs) => {
    const paper = window.paper;
    const frame = window.editor.project.activeFrame;
    if (!frame) return { error: 'no active frame' };
    for (const spec of specs) {
      const item = new paper.Path.Rectangle(new paper.Rectangle(...spec.at));
      const color = new paper.Color({
        gradient: { stops: [['#ef4a2f', 0], ['#f2b54a', 0.5], ['#64b6df', 1]], radial: spec.radial },
        origin: new paper.Point(...spec.origin),
        destination: new paper.Point(...spec.destination),
      });
      if (spec.highlight) color.highlight = new paper.Point(...spec.highlight);
      item.fillColor = color;
      frame.addPath(new window.Wick.Path({ path: item }));
    }
    window.editor.project.view.render();
    return { paths: frame.paths.length };
  }, GRADIENTS);
  if (built.error) { console.error(built.error); await browser.close(); process.exit(1); }
  const b64 = await page.evaluate(() => new Promise((resolve) =>
    window.Wick.WickFile.toWickFile(window.editor.project, resolve, 'base64')));
  const comma = b64.indexOf(',');
  await writeFile(out, Buffer.from(comma === -1 ? b64 : b64.slice(comma + 1), 'base64'));
  console.log(`${built.paths} gradient-filled paths -> ${out}`);
  await browser.close();
  process.exit(0);
}

// Draw with the actual tool. page.mouse drives the same paper.js path the user would get.
await page.locator('#tool-button-rectangle').first().click();
await page.waitForTimeout(200);
await page.mouse.move(400, 300);
await page.mouse.down();
await page.mouse.move(560, 420, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(600);

const built = await page.evaluate(([easing, settings]) => {
  const e = window.editor;
  const project = e.project;
  const frame = project.activeFrame;
  if (!frame) return { error: 'no active frame' };
  if (frame.paths.length === 0) return { error: 'the rectangle tool drew nothing' };

  if (settings) {
    if (settings.backgroundColor) project.backgroundColor = new window.Wick.Color(settings.backgroundColor);
    // A CSS string, not a Wick.Color: the setter assigns straight through to the paper item,
    // and paper coerces an object it does not recognize to black rather than refusing it.
    if (settings.fill) frame.paths[0].fillColor = settings.fill;
  }

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
    background: project.backgroundColor.rgba,
    framerate: project.framerate,
    width: project.width,
    height: project.height,
    paths: frame.paths.length,
    clips: frame.clips.length,
    tweens: frame.tweens.map((t) => ({ at: t.playheadPosition, easing: t.easingType, bezier: t.bezier })),
    frameSpan: [frame.start, frame.end],
  };
}, [EASING[name] || EASING['editor-tween'], PROJECT[name] || null]);

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
