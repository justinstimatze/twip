# Building the twip editor fork

This is a fork of [StickmanRed/wick-editor](https://github.com/StickmanRed/wick-editor),
a Create React App (react-scripts 2.0.5 / webpack 4). It builds **only on Node 14**. Do not
attempt a modern-Node migration — upstream's own `upgrading-react` branch died in Feb 2021,
and the +54 StickmanRed commits changed zero build config.

## Prerequisites

- `nvm` (the repo pins Node via `.nvmrc` → 14)
- Node 14 brings npm 6, which is required: npm 7+ rewrites the webpack-4 lockfile and breaks
  the build.

## First build

```
nvm install 14        # once
nvm use               # reads .nvmrc
npm install --ignore-scripts   # --ignore-scripts skips the electron-builder postinstall
npm run build         # CRA production build -> build/
```

`node-sass` 4.14.1 downloads a prebuilt binding for the Node 14 ABI (module version 83);
this is the specific reason Node 14 is pinned. `--ignore-scripts` is safe for browser-only
work — the only postinstall is `electron-builder install-app-deps`, which is desktop-packaging
only.

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

## Serving a build

CRA sets `homepage` so built assets use absolute `/wick-editor/` paths. Either serve the parent
directory, or rebuild with `homepage: "."` for a relocatable bundle.

## Where the twip compiler plugs in

The Export button shells to / calls the `twip` compiler to turn the editor's `.wick` document
into a playable `.swf`. This editor is being vendored into the twip repo (monorepo, editor under
`twip/editor/`). The dev path posts the `.wick` to a throwaway local bridge (`dev/twip_bridge.py`)
that runs the `twip` CLI; the desktop target is a Tauri 2 shell that links the compiler as an
in-process Rust call. See the twip HANDOFF for the integration decisions.
