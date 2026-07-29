/*
 * make-icons.mjs — every app icon twip ships, from one drawing.
 *
 *   node dev/make-icons.mjs           # write them all
 *   node dev/make-icons.mjs --sheet   # ...and a contact sheet to look at first
 *
 * The drawing is the playhead from src/ui/mark.jsx, plus one thing that mark does not need:
 * a rule to ride.
 *
 * That addition was not a preference. The mark alone was rendered at 512 and it reads as a
 * trowel — five cuts of it were tried (wider flag, narrower, shallower taper, longer stem)
 * and every one reads as some hand tool, because a playhead is only a playhead when there is
 * a timeline under it. In the menu bar the app supplies that context and the wordmark sits
 * alongside; in a dock or a tab strip the icon is alone and has to supply it itself. So the
 * icon carries a number line and the in-app mark does not, and they are the same object seen
 * with and without its stage.
 *
 * The rule is ash-300 rather than the ash-600 it would be in the UI. At 16px a rule at UI
 * contrast against this tile is a grey smudge; at ash-300 it stays a separate form, which is
 * the whole reason it is there.
 *
 * Rendering goes through headless Chromium rather than ImageMagick's SVG delegate: this box's
 * ImageMagick has no librsvg and falls back to its own MSVG renderer, which mangles the `rx`
 * on the tile. Chromium is the renderer the favicon will actually be seen in anyway.
 *
 * ICO is assembled by ImageMagick. ICNS is written here by hand — ImageMagick on this box has
 * no ICNS coder and png2icns is not installed, and the container is a 8-byte header plus one
 * length-prefixed PNG per size. (The icns this replaces was a bare 512px PNG with the
 * extension changed, which macOS would have refused; nothing had checked because release.yml
 * only builds a .deb.)
 */
import { writeFile, mkdir, readFile, unlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { launch } from './browser.mjs';

const run = promisify(execFile);
const sheet = process.argv.includes('--sheet');
const HERE = new URL('.', import.meta.url).pathname;
const PUBLIC = path.join(HERE, '../public');
const TAURI = path.join(HERE, '../src-tauri');
const TMP = path.join(HERE, '.icons');

/* The tokens, by value. This script runs in Node with no CSS engine to read them from, so
   they are written out — and they are the only place in the tree where that is true, which is
   why they are named against index.css here rather than left as bare hex. */
const GROUND = '#110f0e'; // --color-surface-void
const MARK = '#ef4a2f'; // --color-accent
const LINE = '#b9b5b0'; // --color-ash-300, two steps brighter than this rule would be in the UI

/* On the same 24 grid src/ui/mark.jsx draws on, so the two stay comparable. The rule spans
   nearly the full width, which is what makes it a timeline rather than an underline. */
const RULE = { x: 1, y: 12.4, w: 22, h: 1.6, r: 0.8 };
const HEAD = 'M6 5h12v5.2l-6 3.8-6-3.8z';
const STEM = { x: 11.1, y: 12, w: 1.8, h: 7, r: 0.9 };

/* How much of the tile the glyph takes. 0.78 is high for an app icon; it can be, because
   every form here is solid with no interior detail, and being large is what keeps the stem
   above one physical pixel at 16. */
const COVER = 0.78;
/* Squircle-ish, matching the app's own --radius scale extended to tile size. */
const CORNER = 0.219;

function svg (size) {
  const s = (size * COVER) / 24;
  const t = size / 2 - 12 * s;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${size * CORNER}" fill="${GROUND}"/>
  <g transform="translate(${t} ${t}) scale(${s})">
    <rect x="${RULE.x}" y="${RULE.y}" width="${RULE.w}" height="${RULE.h}" rx="${RULE.r}" fill="${LINE}"/>
    <path d="${HEAD}" fill="${MARK}"/>
    <rect x="${STEM.x}" y="${STEM.y}" width="${STEM.w}" height="${STEM.h}" rx="${STEM.r}" fill="${MARK}"/>
  </g>
</svg>`;
}

// Every size anything downstream asks for, rendered once and reused across the containers.
const SIZES = [16, 24, 32, 48, 64, 128, 180, 192, 256, 512, 1024];

await mkdir(TMP, { recursive: true });
const browser = await launch({ headless: true });
const png = {};
for (const size of SIZES) {
  const tab = await browser.newPage({ viewport: { width: size, height: size } });
  await tab.setContent(`<style>html,body{margin:0}</style>${svg(size)}`);
  const file = path.join(TMP, `${size}.png`);
  // omitBackground so the tile's rounded corners come out transparent rather than white.
  await tab.screenshot({ path: file, omitBackground: true });
  await tab.close();
  png[size] = file;
}

if (sheet) {
  const page = path.join(TMP, 'sheet.html');
  const at = (n) => `<figure><img src="${n}.png" width="${n}"><figcaption>${n}</figcaption></figure>`;
  await writeFile(page, `<!doctype html><meta charset="utf-8"><title>twip icon</title>
<style>
  body{margin:0;padding:28px;background:#24211f;color:#e7e4e0;
       font:12px/1.3 ui-sans-serif,system-ui,sans-serif}
  h1{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#9c9792;margin:0 0 16px;font-weight:600}
  .row{display:flex;align-items:flex-end;gap:20px;flex-wrap:wrap;padding:16px;border-radius:4px}
  figure{margin:0;display:flex;flex-direction:column;align-items:center;gap:6px}
  figcaption{font-size:9px;color:#817c77}
  .light{background:#f6f3f0;color:#44403c}
  .dark{background:#110f0e}
</style>
<h1>on the app's own surface</h1>
<div class="row">${SIZES.map(at).join('')}</div>
<h1 style="margin-top:24px">on a light tab strip</h1>
<div class="row light">${SIZES.map(at).join('')}</div>
<h1 style="margin-top:24px">on a dark one — the tile disappears, the mark is what reads</h1>
<div class="row dark">${SIZES.map(at).join('')}</div>`);
  const tab = await browser.newPage({ viewport: { width: 1240, height: 900 } });
  await tab.goto(`file://${page}`);
  await tab.screenshot({ path: path.join(TMP, 'sheet.png'), fullPage: true });
  await tab.close();
  console.log(`contact sheet -> dev/.icons/sheet.png`);
}

await browser.close();

/* ICO: ImageMagick packs the frames. 48 is Windows' large-tile size and 256 is the one
   Explorer shows in the details pane; below 48 the browser tab is the only consumer. */
const ico = async (out, sizes) =>
  run('magick', [...sizes.map((s) => png[s]), '-colors', '256', out]);

/*
 * ICNS. Header is 'icns' + total byte length as big-endian u32, then one entry per size:
 * a 4-byte OSType, a big-endian u32 length that COUNTS ITS OWN 8-byte header, then the PNG.
 * The types below are the PNG-carrying ones; the older icp4/icp5 slots also accept PNG.
 */
const ICNS_TYPE = { 16: 'icp4', 32: 'icp5', 64: 'icp6', 128: 'ic07', 256: 'ic08', 512: 'ic09', 1024: 'ic10' };
async function icns (out, sizes) {
  const parts = [];
  for (const size of sizes) {
    const data = await readFile(png[size]);
    const head = Buffer.alloc(8);
    head.write(ICNS_TYPE[size], 0, 'ascii');
    head.writeUInt32BE(data.length + 8, 4);
    parts.push(head, data);
  }
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(8);
  head.write('icns', 0, 'ascii');
  head.writeUInt32BE(body.length + 8, 4);
  await writeFile(out, Buffer.concat([head, body]));
}

const copy = async (size, out) => writeFile(out, await readFile(png[size]));

// The browser: a favicon for the tab, a 180 for iOS's home screen, and the two PWA sizes
// the install prompt reads out of manifest.json.
await ico(path.join(PUBLIC, 'favicon.ico'), [16, 32, 48]);
await copy(180, path.join(PUBLIC, 'apple-touch-icon.png'));
await copy(192, path.join(PUBLIC, 'icon-192.png'));
await copy(512, path.join(PUBLIC, 'icon-512.png'));

// The desktop shell. These filenames are what tauri.conf.json's `icon` array names.
await mkdir(path.join(TAURI, 'icons'), { recursive: true });
await copy(32, path.join(TAURI, 'icons/32x32.png'));
await copy(128, path.join(TAURI, 'icons/128x128.png'));
await copy(256, path.join(TAURI, 'icons/128x128@2x.png'));
await copy(512, path.join(TAURI, 'icons/icon.png'));
await ico(path.join(TAURI, 'icons/icon.ico'), [16, 24, 32, 48, 64, 256]);
await icns(path.join(TAURI, 'icons/icon.icns'), [16, 32, 64, 128, 256, 512, 1024]);
await copy(1024, path.join(TAURI, 'app-icon.png'));

if (!sheet) for (const f of Object.values(png)) await unlink(f);

console.log('icons written: public/{favicon.ico,apple-touch-icon.png,icon-192.png,icon-512.png}');
console.log('               src-tauri/{app-icon.png,icons/*}');
