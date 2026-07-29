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

## SWF export: three routes

The **SWF** button turns the editor's `.wick` document into a playable `.swf` via the `twip`
compiler. `EditorCore.compileWickToSWF` picks whichever route exists, in this order.

**1. The desktop shell.** Under Tauri the compile is an in-process Rust call —
`invoke('compile_swf', …)` into `src-tauri/src/lib.rs`. Nothing to set up; it is linked in.

**2. The browser, in the tab.** The same compiler built for `wasm32-unknown-unknown`:

```
rustup target add wasm32-unknown-unknown     # once
cargo install wasm-bindgen-cli --locked      # once
pnpm wasm                                    # ~20s, writes src/wasm-pkg/
```

`dev/build-wasm.sh` builds `wasm/` (a cdylib shell over `twip::compile_wick`) and runs
`wasm-bindgen --target web`. The output is gitignored generated code, ~480KB of wasm, ~199KB
over the wire. It is a *lazy* import: nothing loads until the first export, so the cost falls
on the session that uses it.

`vite.config.mjs` resolves `virtual:twip-wasm` to that package when it is on disk and to a
stub that names this command when it is not — so `pnpm build` still works on a checkout with
no Rust toolchain, and generating the package while a dev server is running needs a restart.

**3. The dev bridge**, if the wasm package was never built. The browser can't shell out, so
this POSTs the `.wick` to a throwaway local server that runs the CLI:

```
cargo build --release --bin twip     # once, from the twip crate root (the parent dir)
python3 dev/twip_bridge.py           # serves on http://127.0.0.1:8752
```

The bridge locates the release binary itself — vendored layout `../target/release/twip` first,
then a sibling `../twip/target/release/twip` — or set `TWIP_BIN` to override.

The fallback fires only when the wasm module cannot be loaded or instantiated. A compile
*error* from a loaded module is the compiler's real answer about that document and
propagates; asking the bridge would produce the same message twice.

### Turning off upsampling

By default the compiler resamples each document frame into as many movie frames as fit in
60fps, so a project drawn at 12 exports as a 60fps movie. To export one movie frame per
document frame instead:

```
localStorage['twip:upsample'] = 'off'     # in the editor's console; survives a reload
twip --no-upsample in.wick out.swf        # the CLI equivalent
```

An export setting rather than a project property, deliberately: it decides how a document is
compiled, not what the document is, and writing it into `project.json` would invent a field
the upstream Wick editor cannot read. All three routes above honour it — the desktop shell
takes it as a command argument, the wasm module as a second parameter, the bridge as
`?upsample=off` — so the route in play never changes the bytes.

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
pnpm wasm-check       # the browser compiles a fixture; bytes must match the CLI's
pnpm visual           # screenshot 20 scenes and diff against a blessed baseline
```

`wasm-check` is the only one that presses the button twip exists for. It hands
`fixtures/editor-tween.wick` to `compileWickToSWF` in a real page and requires the result to
equal `target/release/twip`'s output byte for byte. Weaker assertions — starts with `CWS`, is
more than 200 bytes — stay green for a compiler that has quietly diverged, and quiet
divergence between two backends built from one source is the whole risk. It goes through
`compileWickToSWF` rather than importing the wasm module directly, so a mistake in the branch
that *chooses* a route also fails; with no bridge running, a fallback surfaces as an error
instead of a pass. Needs `pnpm wasm`, `pnpm build` and a release `twip` binary first.

`framerate-check` presses the same export button through `compileProjectToSWFBlob` and reads
the header off the result: a new project has to start at 12fps, that project has to export at
60, and `twip:upsample=off` has to bring it back to 12 with a fifth of the frames. Three
things in three places have to agree for a document drawn at 12 to play back smoothly, and the
authoring default is one line that a tidying pass would happily edit back to 30 with nothing
else noticing. Serve a build (`pnpm preview`) and point `SMOKE_URL` at it.

`autosave-check` seeds the restore prompt's worst case and requires it to survive: an
autosave holding real work, then a blank one stamped newer, and Load has to bring back the
work. Seeded rather than timed, because the bug it pins was a race — the prompt and the click
each read the autosave list separately and each took the newest entry, and startup would
autosave the blank canvas in between. Also checks that an untouched project no longer takes a
slot at all, which is where the blanks came from.

`tabs-check` narrows `window.allowedExportTypes` and clicks every tab in the export modal,
because `TabbedInterface` pairs a tab to its body by position and the caller filters the names
while gating the bodies inline. At full length the two lists align by luck, so the default
install never showed the fault — only a platform passing a subset did, and what it showed was
a panel rendering nothing while the tab bar looked correct.

`framerate-check` is also as close to a desktop check as this box allows. The shell serves this same `build/`
and shares every line of the path except the final Tauri invoke, and nothing here can inject
input into a window — there is no `xdotool`, and XTEST does not reach another client's surface
under this compositor — so the shell's own buttons cannot be pressed programmatically at all.

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
