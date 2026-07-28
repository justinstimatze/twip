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

## The desktop build

```
pnpm build                                    # the frontend first; the shell embeds build/
cd src-tauri && ~/.cargo/bin/cargo-tauri build --bundles deb
```

Run `cargo-tauri` by path rather than as `cargo tauri`. Putting `~/.cargo/bin` on `PATH` makes
`cargo` resolve to rustup's toolchain instead of the system one, and building the same tree under
two rustc versions invalidates every artifact.

`--bundles deb` because only `dpkg-deb` is present here; `appimagetool` and `rpmbuild` are not, and
Tauri fetches the AppImage tooling over the network. `targets` stays `"all"` in `tauri.conf.json`
so a runner with the full toolchain produces everything.

`mainBinaryName` is `twip` while the cargo package is `twip-editor`. The package cannot be named
`twip`: it depends on the compiler crate, which already holds that name, and two packages sharing
one name break the dependency graph. Without the override the executable installs as
`/usr/bin/twip-editor` inside a package called `twip`.

`tauri.conf.json` rejects unknown properties, so it cannot carry `//`-prefixed comment keys — the
config fails to parse rather than ignoring them. Rationale for its fields belongs here.

Costs measured on this box at `-j 2`, chosen to stay inside ~2GB of available RAM: 25m00s for a
cold `cargo build --release`, then 7m05s for the bundler. The bundler recompiles `tauri`,
`tauri-macros` and the shell crate no matter what the release build already produced, because the
CLI adds `tauri/custom-protocol` for a production bundle — that feature is what makes the binary
serve its embedded assets instead of expecting a dev server. One `cargo-tauri build` from cold is
cheaper than a `cargo build --release` followed by a bundle.

`cargo tauri dev` does not work: there is no `devUrl` or `beforeDevCommand`, so it has nothing to
serve. Run `pnpm dev` and the debug binary separately, or fix the config first.

`src-tauri/run-shell-check.sh` launches the built binary, screenshots its window and closes it. It
forces `GDK_BACKEND=x11` because under Wayland the compositor owns window geometry and `import(1)`
cannot address another client's surface.

## Checks

```
pnpm notices:check    # notices-npm.json still matches the lockfile
pnpm test-engine      # the engine's 547-case mocha suite, headless
pnpm build
pnpm smoke --sweep    # load the page at every breakpoint, read the console
pnpm interact         # click through the popovers, tooltips, code editor, view-only mode
pnpm visual           # screenshot 20 scenes and diff against a blessed baseline
```

`visual` is the only one that measures geometry, and it is the check to reach for before and
after any CSS change. The others do not: the Toolbox migration shipped three regressions —
numeric fields rendered at 111px instead of 40 — with `smoke`, `interact` and the engine
suite all green, because none of them looks at where anything is.

It compares against a baseline you capture, not a committed golden:

```
node dev/visual.mjs --bless    # capture the build you are changing away from
# ...make the change, pnpm build...
node dev/visual.mjs            # capture again, report what moved
node dev/visual.mjs --list     # the scenes
node dev/visual.mjs --only toolbox-brush
```

Baselines live in `dev/.visual/` and are gitignored on purpose: browser text rendering
differs between this box and a CI runner, so a committed PNG would fail there for reasons
unrelated to the change under test. Two builds on one machine is the workflow, which is also
why `editor.yml` does not run it.

A pixel counts as an outlier when a channel differs by more than 2, and a scene fails above
64 outliers. Both numbers are measured — see the comment at the top of `dev/visual.mjs`. Two
glyphs rasterize differently between runs of the *same* build and produce 8 and 23 outliers;
the regressions above measured 4,316 to 12,852.

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
