/*
 * visual.mjs — screenshot the chrome and diff it against a baseline.
 *
 * smoke.mjs reads the console, interact.mjs asserts behaviour, and the engine suite asserts
 * engine state. None of them measures geometry, which is how the Toolbox migration shipped
 * three regressions past all three: `.wick-input { width: 100% }` from un-migrated SCSS is
 * unlayered and so outranks `w-10` in @layer utilities, and the numeric fields rendered at
 * 111px instead of 40 with every check green. This is the check that would have caught it.
 *
 *   node dev/visual.mjs --bless     # capture the current build as the baseline
 *   node dev/visual.mjs             # capture again and report what moved
 *   node dev/visual.mjs --only toolbox-brush
 *   node dev/visual.mjs --list
 *
 * Baselines are per-machine and gitignored, not committed goldens. Browser text rendering
 * differs between this box and a CI runner, so a committed PNG would fail there for reasons
 * that have nothing to do with the change under test. The workflow is two builds on one
 * machine: bless the build you are changing away from, then compare.
 *
 * Headless for the same reason smoke.mjs is — headed Chrome under Wayland ignores requests
 * to resize, so only a headless page's viewport is exact and repeatable.
 */
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { launch, URL_ } from './browser.mjs';

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const value = (n) => { const i = args.indexOf(`--${n}`); return i === -1 ? null : args[i + 1]; };

const ROOT = new URL('./.visual/', import.meta.url).pathname;
const BASE = path.join(ROOT, 'base');
const HEAD = path.join(ROOT, 'head');

/*
 * Per pixel, per channel: |a-b| above TOLERANCE counts as one outlier, and the scene fails
 * above MAX_OUTLIERS. Same shape as the Rust golden-PNG oracle in tests/golden.rs.
 *
 * Both numbers are measured, not guessed. Running this against the build it was blessed
 * from, three times: two glyphs rasterize differently from one run to the next — the heart
 * on the support button at 50,24 and the line-tool icon at 234,10 — and they produce 8 and
 * 23 outliers at a maximum channel delta of 19. Never more, never anywhere else. So the
 * floor is 23 and 64 sits comfortably above it.
 *
 * For scale: the three regressions the Toolbox migration shipped past smoke, interact and
 * the engine suite measured 4,316, 4,450 and 12,852 outliers. A layout change is two orders
 * of magnitude clear of this threshold, which is why the threshold can absorb the jitter
 * without going blind. The count prints on passing scenes too, so the floor drifting is
 * visible rather than silent.
 */
const TOLERANCE = 2;
const MAX_OUTLIERS = 64;

const px = (n) => `${n}px`;

/*
 * Each scene: a viewport, an optional setup, and what to photograph. `target` null means the
 * whole page, which is what catches a change that moves everything at once. Element shots
 * are for the panels, where a full-page diff would report the panel and its neighbours
 * together and say nothing about which moved.
 */
const SCENES = [
  // Whole-page, one per layout the editor actually has. The 375 case is the view-only player.
  { name: 'page-1440', width: 1440 },
  { name: 'page-1024', width: 1024 },
  { name: 'page-768', width: 768 },
  { name: 'page-375', width: 375 },

  // Toolbox. The settings row changes shape per tool, so each tool is its own scene.
  { name: 'toolbox-cursor', width: 1440, target: '.tool-box-container' },
  { name: 'toolbox-brush', width: 1440, target: '.tool-box-container',
    prepare: (p) => p.locator('#tool-button-brush').first().click() },
  { name: 'toolbox-rect', width: 1440, target: '.tool-box-container',
    prepare: (p) => p.locator('#tool-button-rectangle').first().click() },
  { name: 'toolbox-medium', width: 1000, target: '.tool-box-container',
    prepare: (p) => p.locator('#tool-button-brush').first().click() },
  { name: 'toolbox-brushmodes', width: 1440, target: '.tool-box-container',
    async prepare (p) {
      await p.locator('#tool-button-brush').first().click();
      await p.waitForTimeout(200);
      await p.locator('#brush-modes-popover-button button').first().click();
      await p.waitForSelector('#brush-modes-popover-button', { timeout: 5000 });
    } },
  { name: 'toolbox-canvasactions', width: 1440, target: '.tool-box-container',
    async prepare (p) {
      await p.locator('#more-canvas-actions-popover-button button').first().click();
      await p.waitForSelector('.canvas-actions-widget', { timeout: 5000 });
    } },

  /*
   * Inspector. `.inspector-content` is the row list, which is 0px tall with nothing
   * selected — that is the empty state, and worth a shot of its own.
   */
  { name: 'inspector-path', width: 1440, target: '.inspector-content',
    prepare: (p) => drawRect(p) },
  { name: 'inspector-frame', width: 1440, target: '.inspector-content',
    async prepare (p) {
      await p.evaluate(() => {
        const e = window.editor;
        e.project.selection.clear();
        e.project.selection.select(e.project.activeFrame);
        e.projectDidChange();
      });
      await p.waitForTimeout(500);
    } },

  // The rest of the chrome, one shot each — enough to notice a change that moves everything.
  { name: 'menubar', width: 1440, target: '#menu-bar-container' },
  { name: 'assets', width: 1440, target: '#asset-library' },
  { name: 'canvas-transforms', width: 1440, target: '.canvas-transforms-widget' },
  { name: 'timeline', width: 1440, target: '#animation-timeline' },
  { name: 'outliner-open', width: 1440,
    async prepare (p) {
      await p.locator('#outliner-toggle').first().click();
      await p.waitForTimeout(600);
    } },

  // Overlays, each on a different primitive: a popover and a Radix dialog.
  { name: 'colorpicker', width: 1440,
    async prepare (p) {
      await p.locator('#tool-box-fill-color').first().click();
      await p.waitForSelector('.wick-color-picker', { timeout: 5000 });
      await p.waitForTimeout(400);
    } },
  { name: 'settings-modal', width: 1440,
    async prepare (p) {
      await p.evaluate(() => window.editor.openModal('SettingsModal'));
      await p.waitForTimeout(800);
    } },
  { name: 'export-modal', width: 1440,
    async prepare (p) {
      await p.evaluate(() => window.editor.openModal('ExportOptions'));
      await p.waitForTimeout(800);
    } },
];

async function drawRect (p) {
  await p.locator('#tool-button-rectangle').first().click();
  await p.waitForTimeout(200);
  await p.mouse.move(400, 300);
  await p.mouse.down();
  await p.mouse.move(560, 420, { steps: 10 });
  await p.mouse.up();
  await p.waitForTimeout(400);
  await p.locator('#tool-button-cursor').first().click();
  await p.waitForTimeout(200);
  await p.mouse.click(480, 360);
  await p.waitForTimeout(500);
}

if (flag('list')) {
  for (const s of SCENES) console.log(`${s.name.padEnd(22)} ${s.width}px  ${s.target ?? '<page>'}`);
  process.exit(0);
}

const only = value('only');
const scenes = only ? SCENES.filter((s) => s.name === only) : SCENES;
if (scenes.length === 0) {
  console.error(`no scene named ${only} — try --list`);
  process.exit(2);
}

const blessing = flag('bless');
const outdir = blessing ? BASE : HEAD;
await rm(outdir, { recursive: true, force: true }).catch(() => {});
await mkdir(outdir, { recursive: true });

const browser = await launch();

for (const scene of scenes) {
  const page = await browser.newPage({
    viewport: { width: scene.width, height: 900 },
    reducedMotion: 'reduce',
  });
  await page.goto(URL_, { waitUntil: 'networkidle', timeout: 60_000 });
  // The engine mounts imperatively from componentDidMount, same wait smoke.mjs uses.
  await page.waitForTimeout(2500);
  try {
    if (scene.prepare) await scene.prepare(page);
    /*
     * Freeze anything still moving. `animations: 'disabled'` fast-forwards finite CSS
     * animations to their end and pauses infinite ones; the style tag covers transitions and
     * the text caret, which blinks and would otherwise differ between two runs of the same
     * build. Without this the full-page shots disagree with themselves.
     */
    await page.addStyleTag({ content: `*, *::before, *::after {
      animation-duration: 0s !important; animation-delay: 0s !important;
      transition-duration: 0s !important; transition-delay: 0s !important;
      caret-color: transparent !important;
    }` });
    await page.waitForTimeout(400);
    const shot = path.join(outdir, `${scene.name}.png`);
    const opts = { path: shot, animations: 'disabled' };
    if (scene.target) {
      const el = page.locator(scene.target).first();
      if (await el.count() === 0) throw new Error(`no element matching ${scene.target}`);
      await el.screenshot(opts);
    } else {
      await page.screenshot(opts);
    }
  } catch (e) {
    console.log(`SKIP ${scene.name.padEnd(22)} ${e.message}`);
    await writeFile(path.join(outdir, `${scene.name}.missing`), String(e.message));
  }
  await page.close();
}

await browser.close();

if (blessing) {
  const n = (await readdir(BASE)).filter((f) => f.endsWith('.png')).length;
  console.log(`blessed ${n} scenes into dev/.visual/base`);
  process.exit(0);
}

if (!existsSync(BASE)) {
  console.error('no baseline — run `node dev/visual.mjs --bless` on the build you are comparing against');
  process.exit(2);
}

/*
 * Per pixel, per channel: |a-b| above TOLERANCE is one outlier. Ported from ruffle's image
 * comparison, the same fifteen lines tests/golden.rs uses, so both halves of the repo judge
 * a rendering difference the same way.
 */
const { createReadStream } = await import('node:fs');
const read = (f) => new Promise((res, rej) => {
  createReadStream(f).pipe(new PNG()).on('parsed', function () { res(this); }).on('error', rej);
});

let failed = false;
for (const scene of scenes) {
  const a = path.join(BASE, `${scene.name}.png`);
  const b = path.join(HEAD, `${scene.name}.png`);
  if (!existsSync(a) || !existsSync(b)) {
    console.log(`SKIP ${scene.name.padEnd(22)} not captured in both runs`);
    continue;
  }
  const [x, y] = await Promise.all([read(a), read(b)]);
  if (x.width !== y.width || x.height !== y.height) {
    failed = true;
    console.log(`FAIL ${scene.name.padEnd(22)} ${px(x.width)}x${px(x.height)} -> ${px(y.width)}x${px(y.height)}`);
    continue;
  }
  let outliers = 0;
  let worst = 0;
  let minX = x.width; let minY = x.height; let maxX = -1; let maxY = -1;
  for (let i = 0; i < x.data.length; i += 4) {
    let hit = false;
    for (let c = 0; c < 4; c++) {
      const d = Math.abs(x.data[i + c] - y.data[i + c]);
      if (d > worst) worst = d;
      if (d > TOLERANCE) hit = true;
    }
    if (!hit) continue;
    outliers++;
    const p = (i / 4) | 0;
    const pxX = p % x.width; const pxY = (p / x.width) | 0;
    if (pxX < minX) minX = pxX;
    if (pxX > maxX) maxX = pxX;
    if (pxY < minY) minY = pxY;
    if (pxY > maxY) maxY = pxY;
  }
  const ok = outliers <= MAX_OUTLIERS;
  if (!ok) failed = true;
  const where = maxX < 0 ? '' : ` at ${minX},${minY}-${maxX},${maxY}`;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${scene.name.padEnd(22)} ${String(x.width)}x${x.height}  ` +
    `outliers=${outliers} maxdelta=${worst}${ok ? '' : where}`);
}

if (failed) console.log('\nbaseline dev/.visual/base, this run dev/.visual/head — open both to see what moved');
process.exit(failed ? 1 : 0);
