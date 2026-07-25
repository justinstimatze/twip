# Building the twip editor fork

Fork of [StickmanRed/wick-editor](https://github.com/StickmanRed/wick-editor). Originally a
Create React App (react-scripts 2.0.5 / webpack 4, Node-14-only); **migrated to Vite 6 + pnpm**
when it was vendored into the twip monorepo, so it builds on current Node. React stays at 16 —
the ~40 vendored UI libraries predate React 18.

## Prerequisites

- **pnpm** — pinned as `pnpm@10.34.4` via `package.json` `packageManager` (`corepack enable`
  fetches the right version).
- **Node 20+** — `.nvmrc` → 22.

## Install & run

```
pnpm install          # honors .npmrc (see the hoist note below)
pnpm dev              # Vite dev server on http://localhost:3000
pnpm build            # production build -> build/
pnpm preview          # serve the built build/ locally
```

`.npmrc` sets `shamefully-hoist=true`: this legacy app imports a few transitive deps directly
(e.g. `brace` via `react-ace`), so it needs the flat `node_modules` layout it was written for.
SCSS compiles via `sass` (dart-sass) — no native binding, no Node-ABI pin.

## The committed engine bundle

`public/corelibs/wick-engine/wickengine.js` (~2.3MB) is a **committed prebuilt** engine bundle
kept current by upstream. The gulp engine build is skippable for editor work — the editor
consumes this file directly.

## The Ruffle preview runtime (not committed)

`public/corelibs/ruffle/` holds Ruffle's self-hosted runtime — a `ruffle.js` loader plus two
`core.ruffle.*.js` cores and their `*.wasm` (~28MB total). It plays the compiled `.swf` in the
SWF Preview modal. It is **gitignored** because it is a fetched third-party dependency, not
source, and 28MB of wasm does not belong in history.

To stage it:

```
dev/fetch-ruffle.sh
```

The script pins a tagged release (**v0.4.1**) rather than a nightly, and is idempotent — it
reads the version out of the staged `package.json` and exits early if it already matches.
Nightlies were the earlier instruction and are the wrong thing to depend on: Ruffle prunes old
nightly assets, so the URL that works today 404s in a few months. CI runs the same script, so
a local checkout and a CI run play the same player. `--force` restages regardless.

The golden-PNG test oracle pins a specific Ruffle *revision* for rendering comparisons; the
preview player does not need to match it.

## SWF export in dev (the twip bridge)

The **SWF** button turns the editor's `.wick` document into a playable `.swf` via the `twip`
compiler. The browser can't shell out, so the dev path POSTs the `.wick` to a throwaway local
bridge that runs the CLI and hands back the `.swf`:

```
cargo build --release --bin twip     # once, from the twip crate root (the parent dir)
python3 dev/twip_bridge.py           # serves on http://127.0.0.1:8752
```

The bridge locates the release binary itself — vendored layout `../target/release/twip` first,
then a sibling `../twip/target/release/twip` — or set `TWIP_BIN` to override. The desktop target
links the compiler as an in-process Rust call instead (`invoke('compile_swf', …)` under a Tauri 2
shell); see the twip HANDOFF for the integration decisions.

## Serving a build

`pnpm build` emits `build/` with root-absolute asset paths (`/assets/…`); serve it from a domain
or path root (the Tauri shell and `pnpm preview` both do). To serve under a sub-path, set `base`
in `vite.config.mjs`.

## Checks

```
pnpm notices:check    # notices-npm.json still matches the lockfile
pnpm test-engine      # the engine's 547-case mocha suite, headless
pnpm build
pnpm smoke --sweep    # load the page at every breakpoint, read the console
pnpm interact         # click through the popovers, tooltips, code editor, view-only mode
```

`smoke` and `interact` need a server — `pnpm dev` (port 3000, the default) or `pnpm preview`
with `SMOKE_URL` pointed at it. `.github/workflows/editor.yml` runs all five against a
`pnpm preview` of the production build, path-filtered to commits that touch `editor/`.

Every script drives the system Chrome so nobody pays a ~150MB browser download. CI has no
system Chrome it can rely on, installs Playwright's chromium, and selects it with
`PLAYWRIGHT_CHANNEL=''` — empty string, since unset means `chrome`.

Seven engine cases fail in the committed `dist/wickengine.js` and always have.
`engine/tests/known-failures.json` lists them so the other 540 can act as a gate; an unlisted
failure is fatal. Several cases here time out under load rather than on their merits, so an
unexpected failure re-runs the suite once and only what fails twice is fatal. `--strict`
ignores the list entirely.
