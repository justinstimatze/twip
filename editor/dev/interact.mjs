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
import { launch, URL_ } from './browser.mjs';

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const value = (n) => { const i = args.indexOf(`--${n}`); return i === -1 ? null : args[i + 1]; };

const browser = await launch({ headless: !flag('headed') });
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
    name: 'color-swatches',
    what: 'Picking a swatch changes the tool colour (was react-color)',
    async run () {
      const before = await page.evaluate(() => window.editor.project.toolSettings.getSetting('fillColor').rgba);
      await realClick('#tool-box-fill-color');
      await page.waitForSelector('.column-swatch', { timeout: 3000 });
      // Anything but the current colour, so a no-op cannot pass as a change.
      const swatches = page.locator('.column-swatch');
      const count = await swatches.count();
      if (count < 10) throw new Error(`swatchbook rendered ${count} swatches`);
      await swatches.nth(3).click();
      await page.waitForTimeout(400);
      const after = await page.evaluate(() => window.editor.project.toolSettings.getSetting('fillColor').rgba);
      if (after === before) throw new Error(`fillColor unchanged (${before})`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    },
  },
  {
    name: 'color-spectrum',
    what: 'Spectrum tab: hue/alpha sliders are reachable by keyboard',
    async run () {
      await realClick('#tool-box-fill-color');
      await page.waitForSelector('.wick-color-picker', { timeout: 3000 });
      await realClick('#color-picker-spectrum-button');
      await page.waitForSelector('.react-colorful', { timeout: 3000 });

      // react-color's saturation/hue/alpha were mouse-only. These are sliders.
      const sliders = await page.evaluate(() =>
        [...document.querySelectorAll('.react-colorful [role="slider"]')].map((el) => ({
          label: el.getAttribute('aria-label'), tabindex: el.getAttribute('tabindex'),
        })));
      if (sliders.length !== 3) throw new Error(`expected 3 sliders, found ${sliders.length}`);
      if (sliders.some((s) => s.tabindex !== '0')) throw new Error('a slider is not tabbable');

      const before = await page.evaluate(() => window.editor.project.toolSettings.getSetting('fillColor').rgba);
      await page.evaluate(() => document.querySelector('.react-colorful__hue [role="slider"]').focus());
      for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(400);
      const after = await page.evaluate(() => window.editor.project.toolSettings.getSetting('fillColor').rgba);
      if (after === before) throw new Error(`arrow keys on the hue slider did nothing (${before})`);

      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    },
  },
  {
    name: 'toast',
    what: 'Toasts appear, recolour on update, and dismiss (was react-toastify)',
    async run () {
      // Editor.jsx assigns window.editor, so the real toast()/updateToast() pair can be
      // driven directly. Going through a hotkey would only test the hotkey.
      await page.evaluate(() => {
        window.__toastId = window.editor.toast('Exporting…', 'info', { autoClose: false });
      });
      await page.waitForSelector('[data-sonner-toast]', { timeout: 3000 });
      const text = (await page.locator('[data-sonner-toast]').first().innerText()).trim();
      if (!text.includes('Exporting')) throw new Error(`unexpected toast text: ${text}`);

      // The type has to reach the DOM as a colour, not just sit in an options object —
      // that was the whole of the old `<type>-toast-background` plumbing.
      const read = () => page.evaluate(() => {
        const el = document.querySelector('[data-sonner-toast]');
        return { bg: getComputedStyle(el).backgroundColor, text: el.innerText.trim() };
      });
      const info = await read();
      if (!info.bg || info.bg === 'rgba(0, 0, 0, 0)') throw new Error('toast has no background');

      // updateToast has to replace the same toast rather than stack a second one.
      await page.evaluate(() => window.editor.updateToast(window.__toastId, { type: 'success', text: 'Done.' }));
      await page.waitForTimeout(400);
      if (await page.locator('[data-sonner-toast]').count() !== 1) throw new Error('update stacked a second toast');
      const done = await read();
      if (!done.text.includes('Done')) throw new Error(`update did not change the text: ${done.text}`);
      if (done.bg === info.bg) throw new Error(`update did not change the colour (still ${done.bg})`);

      const closer = page.locator('[data-sonner-toast] [data-close-button]').first();
      if (await closer.count()) await closer.click();
      else await page.evaluate(() => window.editor && document.querySelector('[data-sonner-toast]').click());
      await page.waitForTimeout(700);
      if (!(await gone('[data-sonner-toast]'))) throw new Error('toast would not dismiss');
    },
  },
  {
    name: 'code-editor',
    what: 'CodeMirror opens, edits, and shows an error diagnostic (was react-ace)',
    async run () {
      // Open the popout and give it something scriptable to edit: with no selection the
      // editor is read-only and typing would prove nothing.
      await page.evaluate(() => {
        // A frame is scriptable and one already exists, so selecting it is the shortest
        // route to a writable editor. Without a scriptable selection the pane renders
        // "No Scriptable Object Selected" read-only and typing would prove nothing.
        const project = window.editor.project;
        project.selection.clear();
        project.selection.select(project.activeFrame);
        window.editor.projectDidChange();
        window.editor.toggleCodeEditor(true);
        window.editor.editScript('default');
      });
      await page.waitForSelector('.cm-editor', { timeout: 5000 });
      const line = page.locator('.cm-content').first();
      await line.click();
      await page.keyboard.type('var x = 1;');
      await page.waitForTimeout(500);

      const doc = await page.evaluate(() => document.querySelector('.cm-content').innerText);
      if (!doc.includes('var x = 1;')) throw new Error(`typing did not land: ${doc.slice(0, 80)}`);

      // The gutter marker and the underline were two props describing the same error; one
      // diagnostic does both, so assert the diagnostic reaches the DOM.
      await page.evaluate(() => window.editor.setState({ codeError: { lineNumber: 1, message: 'boom' } }));
      await page.waitForTimeout(600);
      const marks = await page.evaluate(() =>
        document.querySelectorAll('.cm-lintRange-error, .cm-lint-marker-error').length);
      if (marks === 0) throw new Error('no error diagnostic rendered');

      await page.evaluate(() => { window.editor.clearCodeEditorError(); window.editor.toggleCodeEditor(false); });
      await page.waitForTimeout(400);
    },
  },
  {
    /*
     * Resizes the live page rather than opening a second one at 375px, because the
     * interesting part is the transition: the editor and the viewer are different trees
     * over the same Wick.Project, and going back has to restore what going there changed.
     */
    name: 'view-only',
    what: 'Below 768 the editor becomes a player, and coming back restores the editor',
    async run () {
      await page.setViewportSize({ width: 375, height: 740 });
      await page.waitForTimeout(900); // onWindowResize is throttled at 300ms.

      if (await page.locator('.tool-box-container').count()) throw new Error('toolbox still mounted');
      if (await page.locator('#animation-timeline').count()) throw new Error('timeline still mounted');
      if (!(await visible('#view-only-play'))) throw new Error('no play button');

      // The engine must be holding a tool that cannot draw or select.
      const tool = await page.evaluate(() => window.editor.project.activeTool.name);
      if (tool !== 'none') throw new Error(`viewer left the ${tool} tool active`);

      // The stage has to be fitted to the container, not left at whatever zoom the
      // authoring layout had. 0.4 is well below the desktop zoom and above collapsed.
      const zoom = await page.evaluate(() => window.editor.project.zoom);
      if (!(zoom > 0.4 && zoom < 0.7)) throw new Error(`stage zoom is ${zoom}`);

      await page.locator('#view-only-play').click();
      await page.waitForTimeout(500);
      if (!(await page.evaluate(() => window.editor.project.playing))) throw new Error('play did nothing');
      if ((await page.locator('#view-only-play').getAttribute('aria-label')) !== 'Stop') {
        throw new Error('button did not become a stop button');
      }

      await page.locator('#view-only-play').click();
      await page.waitForTimeout(500);
      if (await page.evaluate(() => window.editor.project.playing)) throw new Error('stop did nothing');

      await page.setViewportSize({ width: 1440, height: 900 });
      await page.waitForTimeout(900);
      if (!(await visible('.tool-box-container'))) throw new Error('toolbox did not come back');
      const restored = await page.evaluate(() => window.editor.project.activeTool.name);
      if (restored === 'none') throw new Error('authoring tool was not restored');
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

const only = value('only')?.split(',');
let failed = false;

/**
 * Run one step, returning its error or null. Every assertion here is a bounded wait on
 * something appearing, so a loaded machine can miss a 3000ms window on a step that is fine —
 * seen on this box, and CI is a smaller machine. A step that fails gets one retry, and only
 * a second failure counts. Same bargain as engine/tests/run.mjs: a real break fails twice.
 */
const attempt = async (step) => {
  const before = errors.length;
  try {
    await step.run();
    const newErrors = errors.slice(before);
    if (newErrors.length) throw new Error(`console errors: ${newErrors.join(' | ').slice(0, 200)}`);
    return null;
  } catch (e) {
    // Leave no dismissable layer open, or the retry starts from a different page state.
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(500);
    return e;
  }
};

for (const step of STEPS) {
  if (only && !only.includes(step.name)) continue;
  let error = await attempt(step);
  if (error) {
    const retried = await attempt(step);
    if (!retried) {
      console.log(`ok   ${step.name.padEnd(16)} ${step.what} (flaked once: ${error.message.split('\n')[0].slice(0, 80)})`);
      continue;
    }
    error = retried;
  }
  if (error) {
    failed = true;
    console.log(`FAIL ${step.name.padEnd(16)} ${step.what}`);
    console.log(`       ${error.message.split('\n')[0].slice(0, 240)}`);
  } else {
    console.log(`ok   ${step.name.padEnd(16)} ${step.what}`);
  }
}

await browser.close();
process.exit(failed ? 1 : 0);
