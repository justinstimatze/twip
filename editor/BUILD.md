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

To stage it, download a Ruffle **selfhosted** nightly and drop its contents here:

```
# https://github.com/ruffle-rs/ruffle/releases -> ruffle-nightly-*-web-selfhosted.zip
unzip ruffle-nightly-*-web-selfhosted.zip -d public/corelibs/ruffle
```

The current dev build uses a stock nightly. The golden-PNG test oracle later pins a specific
Ruffle revision; the preview player does not need to match it.

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
