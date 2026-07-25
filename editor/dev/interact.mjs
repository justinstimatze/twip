/*
 * interact.mjs — click through the chrome that smoke.mjs only proves renders.
 *
 * smoke.mjs loads the page and reads the console; it never opens anything. Every control
 * replaced during the redesign is a popover, a listbox, or a tooltip that is absent from
 * the DOM until something opens it, so a green smoke run says nothing about whether they
 * still work. This drives each one and asserts the content appears, then that it closes.
 *
 *   node dev/interact.mjs           # run every step
 *   node dev/interact.mjs --only color
 *   node dev/interact.mjs --headed  # watch it
 *
 * A step fails loudly rather than throwing, so one broken control does not hide the rest.
 */
import { chromium } from 'playwright';

const URL_ = process.env.SMOKE_URL ?? 'http://localhost:3000';
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const value = (n) => { const i = args.indexOf(`--${n}`); return i === -1 ? null : args[i + 1]; };

const browser = await chromium.launch({ channel: 'chrome', headless: !flag('headed') });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const errors = [];
page.on('pageerror', (e) => errors.push(`[uncaught] ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(URL_, { waitUntil: 'networkidle', timeout: 60_000 });
await page.waitForTimeout(2500);

const visible = async (sel) => page.locator(sel).first().isVisible().catch(() => false);
const gone = async (sel) => (await page.locator(sel).count()) === 0 || !(await visible(sel));

/*
 * Move the pointer along a path rather than teleporting.
 *
 * Radix keeps a tooltip open while the pointer is inside a grace polygon between trigger
 * and content, and it decides the pointer has left by watching pointermove. A one-shot
 * mouse.move produces no intermediate events, so the tooltip never closes, and a stale
 * tooltip is a dismissable layer sitting above the popover — which makes Escape close the
 * tooltip and look like the popover ignored it. The bug is in the test, not the app.
 */
const away = async () => { await page.mouse.move(720, 520, { steps: 20 }); await page.waitForTimeout(350); };
const realClick = async (sel) => {
  await page.locator(sel).first().hover();
  await page.waitForTimeout(250);
  await page.locator(sel).first().click();
  await away();
};

/**
 * Each step: open something, assert it appeared, dismiss it, assert it went away.
 * `open` may return a cleanup, otherwise Escape is used.
 */
const STEPS = [
  {
    name: 'color',
    what: 'ColorPicker popover (was reactstrap)',
    async run () {
      await realClick('#tool-box-fill-color');
      await page.waitForSelector('.wick-color-picker', { timeout: 3000 });
      if (!(await visible('.wick-color-picker'))) throw new Error('picker not visible');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      if (!(await gone('.wick-color-picker'))) throw new Error('Escape did not close it');
    },
  },
  {
    name: 'canvas-actions',
    what: 'PopupMenu anchored by id (was reactstrap target=)',
    async run () {
      await realClick('#more-canvas-actions-popover-button button');
      await page.waitForSelector('.canvas-actions-widget', { timeout: 3000 });
      if (!(await visible('.canvas-actions-widget'))) throw new Error('menu not visible');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      if (!(await gone('.canvas-actions-widget'))) throw new Error('Escape did not close it');
    },
  },
  {
    name: 'slider',
    what: 'SettingsNumericSlider popover (was react-popover)',
    async run () {
      await realClick('#tool-button-brush');
      await page.waitForSelector('.settings-numeric-input', { timeout: 3000 });
      await realClick('.settings-numeric-input');
      await page.waitForSelector('.settings-numeric-slider-container', { timeout: 3000 });
      // The number field must keep focus — the popover exists to be typed alongside.
      const focusedIsInput = await page.evaluate(() =>
        document.activeElement?.classList.contains('settings-numeric-input') ?? false);
      if (!focusedIsInput) throw new Error('popover stole focus from the number field');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      if (!(await gone('.settings-numeric-slider-container'))) throw new Error('Escape did not close it');
    },
  },
  {
    name: 'tooltip-hover',
    what: 'Tooltip opens on hover and closes when the pointer leaves',
    async run () {
      await page.locator('#tool-button-brush').first().hover();
      await page.waitForSelector('[role="tooltip"]', { timeout: 3000 });
      const text = (await page.locator('[role="tooltip"]').first().innerText()).trim();
      if (!text) throw new Error('tooltip rendered with no text');
      await away();
      if (!(await gone('[role="tooltip"]'))) throw new Error('tooltip stayed open after the pointer left');
    },
  },
  {
    name: 'tooltip-keyboard',
    what: 'Tooltip still opens on Tab focus (react-tooltip never did)',
    async run () {
      // Tabbing is the only way to test this: the trigger opens on :focus-visible, and
      // element.focus() from a script deliberately does not qualify.
      await page.locator('#editor').click({ position: { x: 2, y: 2 } });
      for (let i = 0; i < 40; i++) {
        await page.keyboard.press('Tab');
        await page.waitForTimeout(60);
        if (await visible('[role="tooltip"]')) return;
      }
      throw new Error('40 tabs and no tooltip ever appeared');
    },
  },
  {
    name: 'ids-unique',
    what: 'no duplicate element ids (ActionButton now forwards id)',
    async run () {
      const dupes = await page.evaluate(() => {
        const seen = new Map();
        for (const el of document.querySelectorAll('[id]')) seen.set(el.id, (seen.get(el.id) ?? 0) + 1);
        return [...seen].filter(([, n]) => n > 1).map(([id, n]) => `${id}×${n}`);
      });
      if (dupes.length) throw new Error(dupes.join(', '));
    },
  },
];

const only = value('only');
let failed = false;
for (const step of STEPS) {
  if (only && step.name !== only) continue;
  const before = errors.length;
  try {
    await step.run();
    const newErrors = errors.slice(before);
    if (newErrors.length) throw new Error(`console errors: ${newErrors.join(' | ').slice(0, 200)}`);
    console.log(`ok   ${step.name.padEnd(16)} ${step.what}`);
  } catch (e) {
    failed = true;
    console.log(`FAIL ${step.name.padEnd(16)} ${step.what}`);
    console.log(`       ${e.message.split('\n')[0].slice(0, 240)}`);
    await page.keyboard.press('Escape').catch(() => {});
  }
}

await browser.close();
process.exit(failed ? 1 : 0);
