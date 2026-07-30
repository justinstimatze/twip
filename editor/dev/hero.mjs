/*
 * hero.mjs — the screenshot at the top of the README.
 *
 *   pnpm preview --port 4180 & SMOKE_URL=http://localhost:4180 node dev/hero.mjs
 *
 * It draws with the real tools through real mouse events rather than loading a prepared
 * document, for the same reason dev/make-fixture.mjs does: a picture of the editor holding
 * something it cannot actually produce would be a lie that no test would catch. Everything on
 * this canvas came out of the toolbar.
 *
 * Writes docs/hero.png, which is committed and is the one image in the README — not into
 * dev/.visual/ with the throwaway captures. Re-run it when the chrome changes, and look at
 * the result before committing it.
 */
import { launch } from './browser.mjs';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';

const URL_ = process.env.SMOKE_URL || 'http://localhost:3000';
const OUT = new URL('../../docs/', import.meta.url).pathname;

const browser = await launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(URL_, { waitUntil: 'networkidle', timeout: 60_000 });
await page.waitForSelector('#animation-timeline', { timeout: 30_000 });

const tool = async (id) => { await page.click(`#${id}`); await page.waitForTimeout(120); };

/* Paper.js needs the pointer to travel, not teleport — a down/up at one point is a click and
   draws nothing. `steps` is what turns each of these into a real drag. */
const drag = async (from, to, steps = 12) => {
  await page.mouse.move(...from);
  await page.mouse.down();
  await page.mouse.move(...to, { steps });
  await page.mouse.up();
  await page.waitForTimeout(160);
};

const stroke = async (points) => {
  await page.mouse.move(...points[0]);
  await page.mouse.down();
  for (const p of points.slice(1)) await page.mouse.move(...p, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);
};

/*
 * Set the fill colour the way a user does: open the swatch, type a hex, close. Everything
 * defaults to black otherwise, and a photograph of three black shapes says nothing about a
 * program whose whole subject is drawing.
 *
 * Closing is the part worth spelling out. After typing in the hex field, the first Escape is
 * eaten by the text input and only blurs it — the popover is still up. A mousedown that lands
 * on a popover dismisses it instead of starting a stroke, so a single Escape here silently
 * costs the next shape, and the screenshot still comes out looking plausible. Press until the
 * thing is actually gone rather than guessing how many it takes.
 */
const fill = async (hex) => {
  await page.locator('#tool-box-fill-color').first().click();
  await page.waitForSelector('.wick-color-picker', { timeout: 5000 });
  // Opens on swatches, which has no hex field; spectrum is the mode that does, and it sticks.
  if (!(await page.locator('.wick-color-picker-hex').count())) {
    await page.click('#color-picker-spectrum-button');
  }
  const field = page.locator('.wick-color-picker-hex').first();
  await field.fill(hex.replace('#', ''));
  await field.press('Enter');
  await page.waitForTimeout(150);
  for (let i = 0; i < 4 && (await page.locator('.wick-color-picker').count()); i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
  }
  await page.waitForSelector('.wick-color-picker', { state: 'detached', timeout: 5000 });
  await page.waitForTimeout(250);
};

await tool('tool-button-ellipse');
await fill('#EF4A2F');
await drag([500, 320], [700, 520]);

await tool('tool-button-rectangle');
await fill('#F2B54A');
await drag([730, 430], [880, 530]);

await tool('tool-button-brush');
await fill('#64B6DF');
await stroke([[520, 600], [600, 560], [690, 620], [780, 570], [860, 610]]);

/*
 * Two assets, drawn here rather than shipped, so the library photographs as a grid of
 * pictures instead of as its empty state. It is a panel whose whole point is that you can
 * tell one sprite from another at a glance, and a screenshot of the drop-files prompt makes
 * that point exactly backwards.
 */
await page.evaluate(async () => {
  const png = (name, colour) => {
    const c = document.createElement('canvas');
    c.width = c.height = 48;
    const g = c.getContext('2d');
    g.fillStyle = colour;
    g.beginPath(); g.arc(24, 24, 18, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#110f0e';
    g.fillRect(14, 20, 6, 6); g.fillRect(28, 20, 6, 6);
    return new Promise((r) => c.toBlob((b) => r(new File([b], name, { type: 'image/png' }))));
  };
  const files = await Promise.all([png('frame_01.png', '#ef4a2f'), png('frame_02.png', '#64b6df')]);
  await new Promise((resolve) => {
    window.editor.createAssets(files, [], resolve);
    setTimeout(resolve, 10_000);
  });
});
await page.waitForTimeout(1200);

/*
 * Land on the cursor with the ellipse selected. The old shot deselected first, for a clean
 * stage — but the Inspector is a tabbed panel now and an empty one photographs as its
 * nothing-selected message, which is a picture of the editor doing nothing. A selection
 * rectangle is what an editor in use looks like.
 */
await tool('tool-button-cursor');
await page.mouse.click(600, 420);
await page.waitForTimeout(400);

/* Count what actually landed. A dropped shape is invisible in a green run — the script
   finishes, the PNG is written, and the picture is just missing something. Ask the engine. */
const drawn = await page.evaluate(() =>
  (window.editor.project.activeFrame.paths || [])
    .map((p) => (p.fillColor && p.fillColor.toCSS && p.fillColor.toCSS(true)) || '?'));
if (drawn.length !== 3) {
  console.error(`expected 3 paths on the frame, got ${drawn.length}: ${JSON.stringify(drawn)}`);
  await browser.close();
  process.exit(1);
}
console.log(`3 paths: ${drawn.join(' ')}`);

await mkdir(OUT, { recursive: true });
await page.screenshot({ path: path.join(OUT, 'hero.png') });
await browser.close();
console.log('hero -> docs/hero.png');
