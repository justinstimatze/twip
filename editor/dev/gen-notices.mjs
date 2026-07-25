/*
 * gen-notices.mjs — regenerate the npm half of the open-source notices modal.
 *
 *   node dev/gen-notices.mjs           # rewrite notices-npm.json
 *   node dev/gen-notices.mjs --check   # exit 1 if it is out of date
 *
 * The modal used to be 492 lines of hand-written JSX with 56 library entries and their
 * licence texts inline. It had drifted badly: it still listed react-aria-menubutton, which
 * this project has not depended on for years, and the Phase 1 dependency swaps would have
 * left nine more entries describing libraries that are no longer installed while twelve
 * new ones went unlisted. A notice that names the wrong libraries is worse than one that
 * is merely incomplete, and hand-maintaining it clearly does not hold.
 *
 * The engine's libraries are vendored under corelibs rather than installed, so nothing
 * here can see them; those stay hand-maintained in notices-vendored.json.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'src/Editor/Modals/OpenSourceNotices/notices-npm.json');

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const direct = Object.keys(pkg.dependencies ?? {}).sort();

// --prod so devDependencies (vite, sass, playwright) stay out — they ship nothing.
const raw = execFileSync('pnpm', ['licenses', 'list', '--prod', '--json'], { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 });
const index = new Map();
for (const group of Object.values(JSON.parse(raw))) {
  for (const entry of group) index.set(entry.name, entry);
}

const LICENSE_FILES = /^(LICENSE|LICENCE|COPYING)(\.(md|txt))?$/i;

/** The real licence text if the package ships one, otherwise just the SPDX id. */
function licenseText (entry) {
  for (const path of entry.paths ?? []) {
    if (!existsSync(path)) continue;
    const file = readdirSync(path).find((f) => LICENSE_FILES.test(f));
    if (file) return readFileSync(join(path, file), 'utf8').trim();
  }
  return `Distributed under the ${entry.license} licence. See ${entry.homepage ?? entry.name} for the full text.`;
}

const missing = [];
const notices = direct.map((name) => {
  const entry = index.get(name);
  if (!entry) { missing.push(name); return null; }
  return {
    name,
    license: entry.license,
    homepage: entry.homepage ?? `https://www.npmjs.com/package/${name}`,
    usedIn: 'Editor interface',
    text: licenseText(entry),
  };
}).filter(Boolean);

if (missing.length) {
  console.error(`not found in the lockfile (skipped): ${missing.join(', ')}`);
}

const json = JSON.stringify(notices, null, 2) + '\n';

if (process.argv.includes('--check')) {
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (current !== json) {
    console.error('notices-npm.json is out of date — run `node dev/gen-notices.mjs`');
    process.exit(1);
  }
  console.log(`notices-npm.json is up to date (${notices.length} packages)`);
} else {
  writeFileSync(OUT, json);
  console.log(`wrote ${notices.length} packages to notices-npm.json`);
}
