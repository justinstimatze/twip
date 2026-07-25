/*
 * smoke.mjs — load the running dev server in headless Chrome and report what the console
 * says. The editor has no unit tests for its chrome, so this is the fast feedback loop for
 * the redesign: it catches a blank white screen, a React error, or a dead import in a few
 * seconds instead of after a manual click-through.
 *
 * Headless deliberately. resize_window through a headed Chrome is a no-op under Wayland —
 * the compositor owns the geometry — whereas a headless page's `viewport` is exact and
 * repeatable, which is what makes the responsive sweep meaningful.
 *
 *   node dev/smoke.mjs                    # default 1440x900
 *   node dev/smoke.mjs --sweep            # every breakpoint in WIDTHS
 *   node dev/smoke.mjs --width 768        # one specific width
 *   node dev/smoke.mjs --shot out.png     # also write a screenshot
 */
import { launch, URL_ } from './browser.mjs';

const WIDTHS = [1920, 1440, 1280, 1024, 768, 375];

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name) => { const i = args.indexOf(`--${name}`); return i === -1 ? null : args[i + 1]; };

/*
 * Noise that predates this work and would otherwise drown the signal. Keep this list
 * SHORT and each entry justified — an ignore list is how a real regression gets missed.
 */
const IGNORE = [
  /Download the React DevTools/,
  /\[vite\] connect(ing|ed)/,
  /Wick Engine version/,
  // Ruffle tears its audio context down after its own instance is gone. Third-party,
  // fires on unload, predates the redesign.
  /AudioContext|audioContext/i,
];

const widths = flag('sweep') ? WIDTHS : [Number(value('width') ?? 1440)];

const browser = await launch();
let failed = false;

for (const width of widths) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const errors = [];
  const warnings = [];
  const pending = [];
  /*
   * React logs through console.error with printf-style format strings ("Invalid DOM
   * property `%s`"), and Playwright's m.text() hands back the template with the %s intact
   * — which is unreadable and, worse, makes two different warnings look identical. Resolve
   * the args instead. Async, so collect the promises and await them before reporting.
   */
  const resolve = async (m) => {
    const args = await Promise.all(m.args().map((a) => a.jsonValue().catch(() => null)));
    const [head, ...rest] = args;
    let i = 0;
    const text = typeof head === 'string' && /%[sdioOfc]/.test(head)
      ? head.replace(/%[sdioOfc]/g, () => String(rest[i++])) + rest.slice(i).map((r) => ` ${r}`).join('')
      : args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    if (IGNORE.some((re) => re.test(text))) return;
    if (m.type() === 'error') errors.push(text);
    else if (m.type() === 'warning') warnings.push(text);
  };
  page.on('console', (m) => {
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    pending.push(resolve(m).catch(() => {}));
  });
  page.on('pageerror', (e) => errors.push(`[uncaught] ${e.message}\n${(e.stack ?? '').split('\n').slice(1, 5).join('\n')}`));

  await page.goto(URL_, { waitUntil: 'networkidle', timeout: 60_000 });
  // The engine mounts imperatively from componentDidMount; give it a beat to settle.
  await page.waitForTimeout(2500);
  await Promise.all(pending);

  // A blank screen still "loads" — assert something actually rendered.
  const rendered = await page.evaluate(() => {
    const root = document.getElementById('root');
    return { children: root?.children.length ?? 0, text: (root?.innerText ?? '').trim().length };
  });
  // Horizontal overflow is the responsive failure that a screenshot alone hides.
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);

  const shot = value('shot');
  if (shot) await page.screenshot({ path: widths.length > 1 ? shot.replace(/\.png$/, `-${width}.png`) : shot });

  const ok = errors.length === 0 && rendered.children > 0 && overflow <= 0;
  if (!ok) failed = true;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${String(width).padStart(4)}px  ` +
    `root-children=${rendered.children} text=${rendered.text} overflow=${overflow}px ` +
    `errors=${errors.length} warnings=${warnings.length}`);
  for (const e of errors) console.log(`       error: ${e.slice(0, 300)}`);
  if (flag('warnings')) for (const w of warnings) console.log(`       warn:  ${w.slice(0, 300)}`);

  await page.close();
}

await browser.close();
process.exit(failed ? 1 : 0);
