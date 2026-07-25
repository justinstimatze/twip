/*
 * probe.mjs — one-off DOM query against the running dev server, for finding selectors.
 *
 *   node dev/probe.mjs '.btn-color-picker' '#more-canvas-actions-popover-button'
 *
 * Prints how many of each selector exist and a little about the first one. Not a test;
 * dev/smoke.mjs and dev/interact.mjs are the tests.
 */
import { launch, URL_ } from './browser.mjs';

const selectors = process.argv.slice(2);

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(URL_, { waitUntil: 'networkidle', timeout: 60_000 });
await page.waitForTimeout(2500);

for (const sel of selectors) {
  const info = await page.evaluate((s) => {
    const nodes = [...document.querySelectorAll(s)];
    return {
      count: nodes.length,
      first: nodes[0] && {
        tag: nodes[0].tagName.toLowerCase(),
        id: nodes[0].id,
        cls: nodes[0].className?.toString?.().slice(0, 120),
        text: nodes[0].innerText?.trim().slice(0, 60),
        visible: nodes[0].getBoundingClientRect().width > 0,
      },
    };
  }, sel);
  console.log(`${sel}  ->  ${JSON.stringify(info)}`);
}

await browser.close();
