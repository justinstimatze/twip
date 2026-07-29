/*
 * autosave-check.mjs — the restore prompt has to restore the work it offered.
 *
 * The bug this pins: `doesAutoSavedProjectExist` and `loadAutosavedProject` each read the
 * autosave list independently and each took entry [0]. Between the prompt appearing and the
 * click landing — seconds, in a real session — startup would autosave the blank canvas it
 * hands you, and that write is newer than the work being offered. The click then restored
 * the blank one. Every layer reported success: the load found data, the project was real,
 * the canvas was empty.
 *
 * Reproduced here without timing: seed a good autosave, then a blank one stamped newer, and
 * require the prompt to still restore the good one. Then check the other direction, that a
 * blank at the head of the list does not hide work underneath it.
 *
 *   node dev/autosave-check.mjs
 *
 * Env: SMOKE_URL (default http://localhost:3000), PLAYWRIGHT_CHANNEL (see dev/browser.mjs).
 */
import { launch, URL_ } from './browser.mjs';

const browser = await launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`[uncaught] ${e.message}`));

await page.goto(URL_, { waitUntil: 'networkidle', timeout: 60_000 });
await page.waitForFunction(
  () => window.editor && window.editor.doesAutoSavedProjectExist && window.Wick,
  null, { timeout: 30_000 });

/*
 * Everything below goes through what the editor exposes to a user's click, never through a
 * helper the fix introduced. A check that reaches for `projectHasContent` cannot be run
 * against the code it is supposed to fail on — it dies on a missing method and reports
 * nothing about the bug.
 */
const result = await page.evaluate(async () => {
  const { Wick, editor } = window;
  const save = (project) => new Promise(res => Wick.AutoSave.save(project, res));
  const list = () => new Promise(res => Wick.AutoSave.getAutosavesList(res));
  const exists = () => new Promise(res => editor.doesAutoSavedProjectExist(res));
  const load = () => new Promise(res => editor.loadAutosavedProject(res));
  // autoSaveProject returns without calling back when it declines, so waiting on the
  // callback alone would hang. Declining is one of the answers being measured.
  const tryAutosave = () => new Promise(res => {
    let done = false;
    editor.autoSaveProject(() => { done = true; res('saved'); });
    setTimeout(() => { if (!done) res('declined'); }, 1500);
  });
  const clear = async () => {
    for (const item of await list()) {
      await new Promise(res => Wick.AutoSave.delete(item.uuid, res));
    }
  };

  /* Does an untouched project get a slot? One blank per launch is what buried the work. */
  await clear();
  const blankVerdict = await tryAutosave();       // editor.project is the startup blank
  const afterBlank = (await list()).length;

  /* Now the race, seeded rather than timed. */
  await clear();

  // A second layer is the cheapest thing that is not the untouched skeleton, and needs no
  // drawing API to build.
  const work = new Wick.Project();
  work.activeTimeline.addLayer(new Wick.Layer());
  await save(work);

  // The blank the old code wrote at every launch, stamped newer so it sorts to the head.
  const blank = new Wick.Project();
  const blankData = Wick.AutoSave.generateAutosaveData(blank);
  blankData.lastModified = Date.now() + 60_000;
  await new Promise(res => Wick.AutoSave.addAutosaveToList(blankData, res));
  await new Promise(res => Wick.AutoSave.writeAutosaveData(blankData, res));

  const head = (await list())[0];
  const offered = await exists();

  await load();
  const restored = editor.project;

  return {
    headIsBlank: head && head.uuid === blank.uuid,
    blankVerdict,
    autosavesAfterBlank: afterBlank,
    offered,
    restoredLayers: restored ? restored.activeTimeline.layers.length : 0,
  };
});

await browser.close();

console.log(JSON.stringify(result, null, 2));

const fail = [];
if (!result.headIsBlank) fail.push('setup is wrong: the blank autosave is not at the head of the list');
if (result.blankVerdict !== 'declined') fail.push('an untouched project was autosaved');
if (result.autosavesAfterBlank !== 0) {
  fail.push(`${result.autosavesAfterBlank} autosaves exist after autosaving nothing, expected 0`);
}
if (!result.offered) fail.push('no autosave was offered, though one holds a second layer');
if (result.restoredLayers !== 2) {
  fail.push(`Load restored a project with ${result.restoredLayers} layers, expected the 2 it offered`);
}
if (errors.length) fail.push(...errors);

if (fail.length) { console.error('FAILED:\n  ' + fail.join('\n  ')); process.exit(1); }
console.log('ok — the prompt restores the work it offered, past a newer blank');
