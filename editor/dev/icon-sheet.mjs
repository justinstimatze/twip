/*
 * icon-sheet.mjs — render every icon in src/ui/icon.jsx to one page and screenshot it.
 *
 * 126 drawings went in from a text editor. Shipping them on the strength of "the build
 * passed" would mean shipping whatever a mistyped arc flag produces, on a control nobody
 * clicks often enough to notice. A contact sheet is the only check that actually looks.
 *
 *   node dev/icon-sheet.mjs            # writes dev/.visual/icons.png
 *   node dev/icon-sheet.mjs --html     # keep the intermediate page for poking at
 *
 * It reads the source rather than importing it, because the registry is JSX and this is a
 * plain Node script. That is a real limitation: the parser below understands the subset of
 * JSX the registry actually uses, and a shape written some other way would silently not
 * appear. The name count is printed for exactly that reason — compare it against the
 * registry before believing the picture.
 */
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { launch } from './browser.mjs';

const keep = process.argv.includes('--html');
const check = process.argv.includes('--check');
const OUT = new URL('./.visual/', import.meta.url).pathname;
const src = await readFile(new URL('../src/ui/icon.jsx', import.meta.url), 'utf8');

const iconBlock = src.slice(src.indexOf('export const ICONS'), src.indexOf('const ALIAS'));

/*
 * JSX to SVG. The registry uses camelCase attribute names (React's spelling) and one spread,
 * `{...S}`, which is always `fill="currentColor"`. Everything else is already SVG.
 */
const CONST = { A: 'M4 4h11v11H4Z', B: 'M9 9h11v11H9Z' };

const toSvg = (jsx) => jsx
  .replace(/\{\.\.\.S\}/g, 'fill="currentColor"')
  .replace(/<>|<\/>/g, '')
  .replace(/fillRule=/g, 'fill-rule=')
  .replace(/strokeWidth=/g, 'stroke-width=')
  .replace(/strokeDasharray=/g, 'stroke-dasharray=')
  .replace(/textAnchor=/g, 'text-anchor=')
  .replace(/fontSize=/g, 'font-size=')
  .replace(/fontWeight=/g, 'font-weight=')
  .replace(/fontFamily=/g, 'font-family=')
  // `d={`${A}M9 9h6v6H9Z`}` and `d={A}` — the boolean-op shapes share their rectangles
  // through consts, so those have to be substituted or the path attribute becomes the
  // literal string "A" and the shape silently vanishes from the sheet.
  .replace(/d=\{`([^`]*)`\}/g, (_, s) => `d="${s.replace(/\$\{(\w+)\}/g, (_2, k) => CONST[k] ?? '')}"`)
  .replace(/d=\{(\w+)\}/g, (_, k) => `d="${CONST[k] ?? ''}"`);

// Split the registry on top-level `name: <shape>,` entries. Entries are two-space indented and
// each ends at the next two-space-indented key or the closing brace.
const entries = [];
const re = /^ {2}('?)([A-Za-z0-9_-]+)\1:\s*([\s\S]*?)(?=^ {2}(?:'?[A-Za-z0-9_-]+'?:)|^};)/gm;
for (const m of iconBlock.matchAll(re)) {
  // A multi-line entry is wrapped in parens; the fragment form is not. Strip either.
  const body = m[3].replace(/,\s*$/, '').trim().replace(/^\(([\s\S]*)\)$/, '$1').trim();
  if (!body.startsWith('<')) {
    console.warn(`skipped ${m[2]}: not a shape this parser understands`);
    continue;
  }
  entries.push([m[2], toSvg(body)]);
}

/*
 * --check: every icon name the source asks for resolves to a drawing.
 *
 * Worth having because the failure it catches is silent in both directions. The old ToolIcon
 * answered an unknown name with a question-mark glyph, which is how `asset`, `svg` and
 * `animated` went years without anyone noticing they were never in the table; the new one
 * renders nothing at all, which is quieter still. This is the thing that notices.
 */
if (check) {
  const names = new Set();
  const PATTERNS = [
    /(?:<ToolIcon|<Icon)\b[^>]*?\bname=["']([A-Za-z0-9_-]+)["']/g,
    /\bicon=["']([A-Za-z0-9_-]+)["']/g,
    /\bicon:\s*["']([A-Za-z0-9_-]+)["']/g,
    /iconDataUri\(\s*["']([A-Za-z0-9_-]+)["']/g,
  ];
  const walk = async (dir) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { await walk(p); continue; }
      if (!/\.(jsx?|tsx?)$/.test(e.name)) continue;
      const text = await readFile(p, 'utf8');
      for (const re of PATTERNS) for (const m of text.matchAll(re)) names.add(m[1]);
    }
  };
  await walk(new URL('../src/', import.meta.url).pathname);

  /*
   * The patterns above only see names written at the call site. Two places compute one:
   * Asset.jsx maps an asset's classname to a name in a chain of returns, and
   * OutlinerObject.jsx keys a lookup by `data.classname.toLowerCase()`. Both are listed here
   * by hand, which is the honest version of "this check covers everything" — if either
   * function grows a case, this list has to grow with it, and nothing will remind you.
   */
  ['image', 'sound', 'clip', 'button', 'font', 'svg', 'asset',
    'layer-object', 'frame', 'path-object', 'button-object', 'clip-object',
    'text-object', 'image-object'].forEach((n) => names.add(n));

  // Names the icon set deliberately does not own: Wick's mascot, and the short words
  // ToolSettings passes as `default` text for controls that never had a drawing.
  const NOT_ICONS = new Set(['mascot', 'mascotmark', 'Font', 'Freescale', 'Inside', 'Merge',
    'None', 'Outside', 'Pixel', 'Skew', 'Uniform']);

  const drawn = new Set([...iconBlock.matchAll(/^ {2}('?)([A-Za-z0-9_-]+)\1:/gm)].map((m) => m[2]));
  const aliasBlock = src.slice(src.indexOf('const ALIAS'), src.indexOf('/** Resolves'));
  const alias = new Map([...aliasBlock.matchAll(/^ {2}'?([A-Za-z0-9_-]+)'?:\s*'([A-Za-z0-9_-]+)'/gm)]
    .map((m) => [m[1], m[2]]));

  const missing = [...names].filter((n) => !NOT_ICONS.has(n) && !drawn.has(alias.get(n) ?? n));
  const dangling = [...alias.entries()].filter(([, v]) => !drawn.has(v));

  if (missing.length || dangling.length) {
    if (missing.length) console.error(`no icon for: ${missing.sort().join(' ')}`);
    for (const [k, v] of dangling) console.error(`alias ${k} -> ${v}, which is not drawn`);
    process.exit(1);
  }
  console.log(`${names.size} names referenced, all resolve (${drawn.size} drawn, ${alias.size} aliased)`);
  process.exit(0);
}

const cell = ([name, body]) => `
  <figure>
    <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor"
         stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${body}</svg>
    <figcaption>${name}</figcaption>
  </figure>`;

const html = `<!doctype html><meta charset="utf-8"><title>twip icons</title>
<style>
  :root { color-scheme: dark }
  body { margin:0; padding:24px; background:#24211f; color:#e7e4e0;
         font:12px/1.3 ui-sans-serif, system-ui, sans-serif }
  h1 { font-size:13px; letter-spacing:.08em; text-transform:uppercase; color:#9c9792;
       margin:0 0 20px; font-weight:600 }
  .grid { display:grid; grid-template-columns:repeat(12, 1fr); gap:4px 8px }
  figure { margin:0; display:flex; flex-direction:column; align-items:center; gap:4px;
           padding:8px 2px; background:#2c2a26; border:1px solid #373330; border-radius:3px }
  figcaption { font-size:8.5px; color:#817c77; text-align:center; word-break:break-all;
               line-height:1.15 }
  /* Second pass at 16px on the accent, which is the size and colour most of them live at. */
  .small figure { background:#1b1917 }
  .small svg { width:16px; height:16px }
  .small figure:nth-child(3n) { color:#ef4a2f }
</style>
<h1>twip icons — ${entries.length} drawn, at 34px</h1>
<div class="grid">${entries.map(cell).join('')}</div>
<h1 style="margin-top:28px">the same set at 16px, every third one on the accent</h1>
<div class="grid small">${entries.map(cell).join('')}</div>`;

await mkdir(OUT, { recursive: true });
const page = path.join(OUT, 'icons.html');
await writeFile(page, html);

const browser = await launch({ headless: true });
const tab = await browser.newPage({ viewport: { width: 1240, height: 800 } });
await tab.goto(`file://${page}`);
await tab.screenshot({ path: path.join(OUT, 'icons.png'), fullPage: true });
await browser.close();
if (!keep) await writeFile(page, '');

console.log(`${entries.length} icons -> dev/.visual/icons.png`);
