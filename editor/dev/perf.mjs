/*
 * perf.mjs — the numbers that decide whether twip holds up on a document worth keeping.
 *
 * Lighthouse is the wrong primary tool here, and the reason is worth stating rather than
 * implying: it scores a document, and this is an application that has to boot a canvas editor
 * before it can do anything at all. It reads the engine as unused JS and charges blocking time
 * for work that must happen. Run it for `--only-categories=best-practices,accessibility`,
 * which are real and actionable, and measure the rest here.
 *
 * What matters for an editor is not when the page loaded. It is when a stroke lands, whether
 * the main thread stalls under the hand, and — the question that outlives every other one —
 * whether compiling stays affordable as the document grows. So six measurements, with one
 * split worth being explicit about:
 *
 *   BYTES ARE ASSERTED. MILLISECONDS ARE REPORTED.
 *
 * Transfer weight is the same on every machine, so it can carry a budget and fail a run.
 * Timings depend on the CPU, the network, and whatever else the box is compiling; a threshold
 * on them is either so loose it catches nothing or so tight it reds a build for reasons that
 * have nothing to do with the code. They print to be read, and to be compared against the
 * previous run on the same machine.
 *
 *   node dev/perf.mjs                          # against SMOKE_URL
 *   node dev/perf.mjs --headed
 *   node dev/perf.mjs --shapes 400             # ceiling for the scaling tests
 *   node dev/perf.mjs --max-transfer-kb 1600   # the one budget
 *   node dev/perf.mjs --write-fixture          # dump the largest document to tmp/ for hyperfine
 *   node dev/perf.mjs --json tmp/before.json   # record a baseline to diff a rewrite against
 *
 * `--json` exists for one job: capturing the numbers a rewrite has to beat, before the rewrite.
 * The record carries the commit and the machine's CPU count, because comparing a baseline to a
 * run on different hardware compares the hardware. Take the before and after on one box.
 *
 * Chrome only, deliberately: `performance.memory` and the CDP heap profiler are how you get
 * an honest retention number, and dev/browser.mjs already drives Chrome and nothing else.
 *
 * Env: SMOKE_URL (default http://localhost:3000), PLAYWRIGHT_CHANNEL (see dev/browser.mjs).
 */
import { launch, URL_ } from './browser.mjs';
import { writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { cpus } from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? dflt : Number(args[i + 1]);
};
const str = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : args[i + 1];
};
const JSON_OUT = str('json');

const MAX_SHAPES = opt('shapes', 200);
const MAX_TRANSFER_KB = opt('max-transfer-kb', 2048);
const ROOT = new URL('../../', import.meta.url).pathname;

/* Sizes to compile at. Geometric rather than linear: a cost that grows with the square of the
   document shows up as a straight line on doublings and is invisible on even steps. */
const STEPS = [10, 25, 50, 100, 200, 400, 800].filter((n) => n <= MAX_SHAPES);
if (STEPS.length < 2) { console.error('--shapes must be at least 25 for the curve to say anything'); process.exit(1); }

const kb = (n) => `${(n / 1024).toFixed(n < 100 * 1024 ? 1 : 0)}kB`;
const ms = (n) => `${n.toFixed(1)}ms`;
const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

const browser = await launch({ headless: !flag('headed') });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const cdp = await page.context().newCDPSession(page);
const errors = [];
page.on('pageerror', (e) => errors.push(`[uncaught] ${e.message}`));

const t0 = Date.now();
await page.goto(URL_, { waitUntil: 'networkidle', timeout: 60_000 });
await page.waitForFunction(() => window.editor && window.editor.project, null, { timeout: 30_000 });

/*
 * The interactive moment, which is not `load` and not any standard metric. The engine mounts
 * imperatively and the canvas is live some time after the bundle has run, so the only honest
 * question is when a stroke actually produces a path. Polled with real mouse events for the
 * same reason hero.mjs draws that way — an API call would answer a question nobody asked.
 */
await page.locator('#tool-button-brush').first().click();
let interactiveAt = null;
for (let i = 0; i < 60 && interactiveAt === null; i++) {
  await page.mouse.move(600, 400);
  await page.mouse.down();
  await page.mouse.move(660, 440, { steps: 4 });
  await page.mouse.up();
  const drew = await page.evaluate(() => {
    const f = window.editor.project && window.editor.project.activeFrame;
    return !!(f && f.paths.length > 0);
  });
  if (drew) interactiveAt = Date.now() - t0;
  else await page.waitForTimeout(100);
}

console.log(`\n${URL_}`);
console.log('\n== first load ==');
const nav = await page.evaluate(() => {
  const n = performance.getEntriesByType('navigation')[0];
  return n ? { response: n.responseEnd, dcl: n.domContentLoadedEventEnd, load: n.loadEventEnd } : null;
});
if (nav) {
  console.log(`  response end      ${ms(nav.response)}`);
  console.log(`  DOMContentLoaded  ${ms(nav.dcl)}`);
  console.log(`  load              ${ms(nav.load)}`);
}
console.log(`  stroke lands      ${interactiveAt === null ? 'NEVER — the canvas never took a stroke' : `${ms(interactiveAt)} (polled, ±100ms and one stroke's worth)`}`);

/*
 * Transfer weight from resource timing rather than from response headers, because
 * `transferSize` is what crossed the wire after content-encoding while `decodedBodySize` is
 * what the main thread then has to parse. The gap between them is the whole of what gzip buys
 * and none of what it costs.
 */
console.log('\n== transfer ==');
const res = await page.evaluate(() => performance.getEntriesByType('resource')
  .map((r) => ({ name: r.name, transfer: r.transferSize, decoded: r.decodedBodySize, type: r.initiatorType }))
  .filter((r) => r.transfer > 0));
const totalTransfer = res.reduce((a, r) => a + r.transfer, 0);
const totalDecoded = res.reduce((a, r) => a + r.decoded, 0);
console.log(`  over the wire     ${kb(totalTransfer)} across ${res.length} requests`);
console.log(`  after decoding    ${kb(totalDecoded)}  (${(totalDecoded / Math.max(1, totalTransfer)).toFixed(1)}x)`);
for (const r of res.sort((a, b) => b.transfer - a.transfer).slice(0, 5)) {
  console.log(`    ${kb(r.transfer).padStart(7)} → ${kb(r.decoded).padStart(7)}  ${new URL(r.name).pathname}`);
}

/*
 * Long tasks under a drawing hand. A stall here is the difference between a tool that feels
 * like a pencil and one that feels like a form. Total blocking time is the sum of each task's
 * overage past 50ms, which is the part a person can actually perceive.
 */
console.log('\n== drawing ==');
await page.evaluate(() => {
  window.__lt = [];
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(e.duration); })
    .observe({ entryTypes: ['longtask'] });
});
const STROKES = 12;
const strokeMs = [];
for (let i = 0; i < STROKES; i++) {
  const y = 300 + (i % 4) * 70;
  const s = Date.now();
  await page.mouse.move(420, y);
  await page.mouse.down();
  for (let x = 470; x <= 900; x += 70) await page.mouse.move(x, y + ((x / 70) % 2 ? 18 : -18), { steps: 3 });
  await page.mouse.up();
  strokeMs.push(Date.now() - s);
}
const lt = await page.evaluate(() => window.__lt);
console.log(`  ${STROKES} brush strokes    p50 ${ms(pct(strokeMs, 50))}  p95 ${ms(pct(strokeMs, 95))}`);
console.log(`  long tasks        ${lt.length}${lt.length ? `, worst ${ms(Math.max(...lt))}, blocking ${ms(lt.reduce((a, d) => a + Math.max(0, d - 50), 0))}` : ''}`);

/*
 * Render cost per playhead step, named for what it measures. A rAF sampler would report what
 * a person feels, which mixes React's re-render in with the engine's; timing view.render()
 * directly is attributable to one thing and reproducible across runs. Scrubbing is where a
 * heavy document stops being usable, and it is the cheapest early warning there is.
 */
console.log('\n== scrubbing ==');
const scrub = await page.evaluate(() => {
  const p = window.editor.project;
  const f = p.activeFrame;
  f.end = 48;
  const per = [];
  for (let pass = 0; pass < 3; pass++) {
    for (let n = 1; n <= 48; n++) {
      p.activeTimeline.playheadPosition = n;
      const t = performance.now();
      p.view.render();
      per.push(performance.now() - t);
    }
  }
  return per;
});
console.log(`  ${scrub.length} playhead steps  p50 ${ms(pct(scrub, 50))}  p95 ${ms(pct(scrub, 95))}  worst ${ms(Math.max(...scrub))}`);
console.log(`  over one frame    ${scrub.filter((d) => d > 16.7).length} steps past 16.7ms, ${scrub.filter((d) => d > 50).length} past 50ms`);

/*
 * What the timeline costs to draw, which is a different question from what the stage costs
 * and was not being asked. The section above times `view.render()` — the stage — and the
 * timeline is a separate surface: 3,733 lines of canvas GUI under `engine/src/gui/`, mounted
 * by Timeline.jsx and redrawn by `guiElement.draw()`, which clears the whole canvas and walks
 * the element tree from the root every time anything changes.
 *
 * So the cost scales with layers × frames whether or not anything moved, and that is the
 * number a DOM rewrite has to answer for. Recorded here BEFORE the rewrite, at sizes that
 * bracket a real document, because a redraw that is comfortable at 4×32 and quadratic at
 * 20×400 looks identical from a chair.
 *
 * Rows are built up and never torn down, so each measures a timeline holding exactly that
 * much. Per-cell is the column to read: flat is linear, rising is the shape that eventually
 * makes a long document unscrollable.
 */
console.log('\n== timeline redraw ==');
const TIMELINE_SIZES = [[2, 32], [4, 64], [8, 128], [16, 256], [24, 400]];
const timelineRows = [];
for (const [layers, frames] of TIMELINE_SIZES) {
  const row = await page.evaluate(([wantLayers, wantFrames]) => {
    const p = window.editor.project;
    const t = p.activeTimeline;
    while (t.layers.length < wantLayers) t.addLayer(new window.Wick.Layer());
    for (const layer of t.layers) {
      const frame = layer.frames[0];
      if (frame && frame.end < wantFrames) frame.end = wantFrames;
    }
    p.guiElement.draw();               // once to settle any lazy build, then measure
    const per = [];
    for (let i = 0; i < 12; i++) {
      const t0 = performance.now();
      p.guiElement.draw();
      per.push(performance.now() - t0);
    }
    per.sort((a, b) => a - b);
    return { layers: t.layers.length, frames: wantFrames, median: per[Math.floor(per.length / 2)], worst: per[per.length - 1] };
  }, [layers, frames]);
  row.cells = row.layers * row.frames;
  timelineRows.push(row);
  console.log(`  ${String(row.layers).padStart(2)} layers x ${String(row.frames).padStart(3)} frames`
    + `  = ${String(row.cells).padStart(5)} cells   median ${ms(row.median).padStart(7)}`
    + `  worst ${ms(row.worst).padStart(7)}   ${(row.median * 1000 / row.cells).toFixed(2)}us per cell`);
}
{
  const last = timelineRows[timelineRows.length - 1];
  const budget = last.median > 16.7 ? `past one frame at ${last.cells} cells` : `inside one frame at ${last.cells} cells`;
  console.log(`  a redraw is ${budget} — every edit, every playhead step, every scroll`);
}

/*
 * Retention per shape, measured either side of an explicit collection. Reading
 * usedJSHeapSize without forcing GC measures how lazy the collector was feeling, not what the
 * document holds — and a leak that only shows after an hour of drawing is exactly the kind
 * this number is here to catch.
 */
console.log('\n== memory ==');
const addShapes = async (n) => page.evaluate((count) => {
  const p = window.editor.project;
  const f = p.activeFrame;
  const t = performance.now();
  for (let i = 0; i < count; i++) {
    const r = new window.paper.Path.Rectangle({
      point: [20 + (i % 40) * 17, 20 + Math.floor(i / 40) * 13],
      size: [14, 10],
      insert: false,
    });
    r.fillColor = i % 3 === 0 ? '#ef4a2f' : i % 3 === 1 ? '#f2b54a' : '#64b6df';
    f.addPath(new window.Wick.Path({ path: r, project: p }));
  }
  p.view.render();
  return performance.now() - t;
}, n);

/* Start from an empty frame. The drawing and scrubbing sections above left twelve brush
   strokes and three render passes behind, and a delta measured over those attributes their
   garbage to the shapes added here — which is how the first version of this reported a
   NEGATIVE cost per path. */
const clearFrame = () => page.evaluate(() => {
  const f = window.editor.project.activeFrame;
  for (const p of [...f.paths]) p.remove();
  window.editor.project.view.render();
});
await clearFrame();

await cdp.send('HeapProfiler.collectGarbage');
const heapBefore = await page.evaluate(() => performance.memory.usedJSHeapSize);
const buildMs = await addShapes(STEPS[STEPS.length - 1]);
await cdp.send('HeapProfiler.collectGarbage');
const heapAfter = await page.evaluate(() => performance.memory.usedJSHeapSize);
const shapesNow = await page.evaluate(() => window.editor.project.activeFrame.paths.length);
const heapDelta = heapAfter - heapBefore;
console.log(`  ${shapesNow} paths on the frame`);
console.log(`  heap              ${kb(heapBefore)} → ${kb(heapAfter)}  (${heapDelta >= 0 ? '+' : ''}${kb(heapDelta)}`
  + `${heapDelta > 0 ? `, ${(heapDelta / shapesNow / 1024).toFixed(1)}kB per path` : ' — below the noise floor, read it as no measurable retention'})`);
console.log(`  build + render    ${ms(buildMs)}`);

/*
 * The one that answers "will this survive a real document". Save and compile at each size,
 * and print the per-shape cost alongside the total — a flat per-shape column is linear and
 * fine, a rising one is the curve that eventually makes the export button unusable, and it is
 * far easier to read off this table than off the totals.
 *
 * Built up incrementally so every row measures a document holding exactly that many shapes
 * with no teardown in between, and so a slow row cannot be blamed on the row before it.
 */
console.log('\n== compile, by document size ==');
await clearFrame();

/* One throwaway compile first. The wasm module instantiates on the first call to
   compileWickToSWF, and without this that cost lands entirely on the smallest row — the first
   run of this harness reported 288ms for ten shapes and 3.4ms for twenty-five, which reads as
   a compiler that gets faster with more work. It does not; it was paying for the module. */
const warmupMs = await page.evaluate(async () => {
  const b64 = await new Promise((resolve) => window.Wick.WickFile.toWickFile(window.editor.project, resolve, 'base64'));
  const comma = b64.indexOf(',');
  const raw = atob(comma === -1 ? b64 : b64.slice(comma + 1));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  const t = performance.now();
  await window.editor.compileWickToSWF(bytes);
  return performance.now() - t;
});
console.log(`  wasm warm-up      ${ms(warmupMs)} on an empty document, excluded from the rows below`);

const rows = [];
let at = 0;
let lastWick = null;
for (const n of STEPS) {
  await addShapes(n - at);
  at = n;
  const r = await page.evaluate(async () => {
    const t0 = performance.now();
    const b64 = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('toWickFile never called back')), 60_000);
      window.Wick.WickFile.toWickFile(window.editor.project, (d) => { clearTimeout(timer); resolve(d); }, 'base64');
    });
    const saveMs = performance.now() - t0;
    const comma = b64.indexOf(',');
    const raw = atob(comma === -1 ? b64 : b64.slice(comma + 1));
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);

    const t1 = performance.now();
    const blob = await window.editor.compileWickToSWF(bytes);
    const compileMs = performance.now() - t1;
    return { saveMs, compileMs, wick: bytes.length, swf: blob.size, b64 };
  });
  lastWick = r.b64;
  rows.push({ n, ...r });
  console.log(`  ${String(n).padStart(4)} shapes   save ${ms(r.saveMs).padStart(9)}  compile ${ms(r.compileMs).padStart(9)}`
    + `  (${(r.compileMs / n).toFixed(2)}ms/shape)  .wick ${kb(r.wick).padStart(7)} → .swf ${kb(r.swf).padStart(7)}`);
}

/* Read the trend off the rows big enough to mean something. Below ~50 shapes a compile is
   almost entirely fixed cost, so a 25-shape row can come in slower than a 50-shape one and
   including it turns the summary into a coin flip. */
const trend = rows.filter((r) => r.n >= 50);
if (trend.length >= 2) {
  const first = trend[0];
  const last = trend[trend.length - 1];
  const growth = (last.compileMs / last.n) / (first.compileMs / first.n);
  const verdict = growth < 0.8 ? 'FALLING — fixed cost still dominates'
    : growth < 1.5 ? 'flat — linear in the document'
    : growth < 3 ? 'rising'
    : 'RISING SHARPLY — superlinear, look at this';
  console.log(`  per-shape cost ${verdict}, ${first.n}→${last.n} shapes (${growth.toFixed(2)}x)`);
} else {
  console.log('  per-shape trend needs --shapes 100 or more to say anything');
}

if (flag('write-fixture')) {
  const comma = lastWick.indexOf(',');
  const bytes = Buffer.from(comma === -1 ? lastWick : lastWick.slice(comma + 1), 'base64');
  const out = path.join(ROOT, 'tmp', `perf-${last.n}-shapes.wick`);
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, bytes);
  // tmp/ is gitignored: this is a generated benchmark input, not a fixture anything asserts on.
  console.log(`\nwrote ${out} (${bytes.length} bytes)`);
  console.log(`  hyperfine 'target/release/twip ${path.relative(ROOT, out)} /dev/null'`);
}

if (JSON_OUT) {
  let commit = null;
  try { commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT }).toString().trim(); }
  catch { /* not a checkout, or no git — the record is still useful, just unanchored */ }
  const record = {
    url: URL_,
    commit,
    cpus: cpus().length,
    node: process.version,
    // Not Date.now() for cleverness — a baseline you cannot date is a baseline you stop trusting.
    at: new Date().toISOString(),
    firstLoad: { ...(nav || {}), strokeLandsMs: interactiveAt },
    transfer: { wireBytes: totalTransfer, decodedBytes: totalDecoded, requests: res.length },
    drawing: { strokes: STROKES, p50: pct(strokeMs, 50), p95: pct(strokeMs, 95), longTasks: lt },
    scrubbing: { steps: scrub.length, p50: pct(scrub, 50), p95: pct(scrub, 95), worst: Math.max(...scrub) },
    timelineRedraw: { rows: timelineRows },
    memory: { beforeBytes: heapBefore, afterBytes: heapAfter, paths: shapesNow, buildMs },
    compile: { warmupMs, rows: rows.map(({ b64, ...r }) => r) },
  };
  await mkdir(path.dirname(path.resolve(ROOT, JSON_OUT)), { recursive: true });
  await writeFile(path.resolve(ROOT, JSON_OUT), JSON.stringify(record, null, 2));
  console.log(`\nwrote ${JSON_OUT} at ${commit ?? 'unknown commit'}, ${record.cpus} cpus`);
}

await browser.close();

const failures = [];
if (interactiveAt === null) failures.push('the canvas never accepted a stroke');
if (totalTransfer > MAX_TRANSFER_KB * 1024) {
  failures.push(`first load is ${kb(totalTransfer)}, over the ${MAX_TRANSFER_KB}kB budget`);
}
if (errors.length) failures.push(`uncaught page errors:\n    ${errors.join('\n    ')}`);

if (failures.length) { console.error(`\nfailed:\n  ${failures.join('\n  ')}`); process.exit(1); }
console.log('\nok — within the byte budget, no uncaught errors; timings above are for reading');
