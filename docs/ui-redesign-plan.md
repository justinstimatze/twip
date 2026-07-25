# twip UI redesign — scope

*Written 2026-07-24. Turns `docs/ui-research.md` (the competitive survey) into a plan.
Every count below was measured against the tree at `59c4862`+`fafcdb3`; the commands are
named so they can be re-run when they rot.*

Stack was decided before this document: Vite + React + Tailwind + shadcn/ui, editor-only,
no Next, no gallery. The survey's recommended stance was also decided: modern layout and
modern mechanics wearing a subtly retro skin, not a Flash clone and not a bolt-on classic
mode. The standing rule from the export work holds — **SWF leads**, the inherited Wick
export categories are secondary.

What this document adds is where the work actually lands, which turns out not to match how
the survey's recommendations are written.

---

## The measurement that reorders everything

The editor is three layers, and "the UI" means a different thing in each.

**Layer A — React chrome.** 19,363 lines of JS/JSX across 115 files, plus 6,797 lines of
SCSS across 75. MenuBar, Toolbox, Inspector, Outliner, AssetLibrary, the modal stack, the
code editor pop-out. This is what Tailwind + shadcn replaces.

**Layer B — engine-drawn canvas GUI.** 3,723 lines across 28 files in
`editor/engine/src/gui/`, painted with paper.js onto a `<canvas>`. This is the **entire
timeline**: frames, layers, playhead, tweens, the onion-skin range, scrollbars,
breadcrumbs, layer buttons, the frame ghosts you see while dragging. React's contribution
is 182 lines — `Panels/Timeline/Timeline.jsx:54` hands the engine a div
(`project.guiElement.canvasContainer = elem; guiElement.draw()`) and gets out of the way.

**Layer C — engine model, scene view, and tools.** ~26k lines in `editor/engine/src/`
(`base/` 9,427, `view/` 5,833, `tools/` 3,508). The project graph, paper.js scene
rendering, and every vector tool. `Panels/Canvas/Canvas.jsx:52` mounts it the same way the
timeline does.

The stage and the timeline — the two surfaces a user looks at 95% of the time — are both
Layer B/C. No amount of Tailwind touches either one.

Coupling between A and C is small and enumerable: 10 files reference `window.Wick`, 30 of
those sites in `EditorCore.jsx` alone, across 21 distinct members (`Wick.Project`,
`Wick.Clip`, `Wick.ObjectCache`, `Wick.AutoSave`, `Wick.Tween`, `Wick.WickFile`, …). A
chrome rewrite can hold that surface fixed and swap everything above it.

## What the survey asked for, by layer

The survey's "drop or modernize" list, priced against the layer that owns the pixels:

| Survey item | Layer | What it costs |
|---|---|---|
| Modal dialogs → inline panels | A | Modals are ~4.5k lines across 18 dirs. Mechanical. |
| Flat inspector → tabbed, context-aware | A | `Panels/Inspector` is 2,925 lines, the largest chrome item. |
| Icon strip → labeled contextual toolbar | A | `Panels/Toolbox` 1,429 + `CanvasTransforms` 274. |
| Library-as-list → thumbnail grid + search | A | `Panels/AssetLibrary` 495 lines. Smallest win on the list. |
| Convert-to-symbol-then-tween → auto-keyframing | B + C | Model hook to key on change, timeline feedback to show it. |
| Easing dropdown → Bézier graph editor | B + C | `engine/src/gui/Tween.js` is 179 lines of canvas drawing. |

And the accessibility section, which is where the split bites hardest — though less hard
than a first read suggests. Of the survey's concrete targets, two are already met or nearly
free on canvas: `GUIElement.js:207-224` defines `GRID_SMALL/NORMAL/LARGE_CELL_*` at
22×32 / 38×42 / 62×52, so frame cells already clear WCAG 2.5.8's 24×24 minimum at the
default size, and the density toggle the survey asks for is a settable static rather than a
feature (today it is switched only by `IS_MOBILE = window.innerWidth < 600`). Theming is
similarly cheap: 52 hex literals in `engine/src/gui/`, most of them in one constants block
at the bottom of `GUIElement.js`. Keyboard *operations* also already exist —
`hotKeyMap.js` maps 13 timeline actions (`move-playhead-forwards`, `insert-blank-frame`,
`extend-frame`, `move-frame-left`, `toggle-onion-skinning`, …), the Flash F5/F6/F7
conventions the survey said to expose as the accessible path.

What a `<canvas>` genuinely cannot provide is **perception and focus**: a screen reader
cannot enumerate frames, layers, or keyframes, there is no focus model to Tab into, and
`aria-live` has nothing to announce. That is the real Layer B gap, and it is narrower than
"rewrite the timeline" — which is nonetheless what was chosen, for reasons that are not
accessibility. See Phase 2.

Phasing follows from the split: Layer A is bounded and independent, so it can proceed
without any engine decision being settled, while the timeline is its own project with its
own risk.

## Gate cleared: the engine builds again

Nothing in Layer B or C is possible if `pnpm build-engine` doesn't run. It didn't.

Two breaks, both fixed in this pass:

1. `engine/gulpfile.js:8` requires `merge-stream`, which was not in `engine/package.json`.
   Added as a devDependency.
2. The gulpfile globs `src/export/image/ImageSequence.js`; the file on disk was
   `imageSequence.js`. Every one of its twelve siblings in `src/export/` is PascalCase, so
   this was always the odd one — it just never surfaced on the case-insensitive macOS
   filesystem the fork was developed on. Renamed the file rather than the glob.

With those, `npx gulp` in `editor/engine/` finishes in **741ms on Node 24**. The rebuilt
bundle was checked against the committed one before being thrown away: identical 41-class
surface, identical symbol counts for spot-checked members, and the 100k-line raw diff is
CRLF-vs-LF in the vendored `lib/` (29,372 CR-terminated lines in the committed copy) plus
~535 lines of Babel formatting drift. `engine/dist/` was restored to HEAD — a 2.2MB
line-ending churn is not worth committing.

So the engine is rebuildable from vendored source, and has been all along behind one
character of filename.

There is also a test suite nobody is running: `engine/tests/` is 71 mocha/chai files,
39,036 lines, driven by `tests/index.html` in a browser with no npm script. Layer C has a
safety net that needs an hour of wiring. Layer A has none, and the twip golden-PNG oracle
tests the *compiler*, not the editor.

---

## Phase 0 — prune before rewriting

Rewriting code that should be deleted is the most expensive mistake available here.

**Delete the parallel mobile component tree** — which is not the same as dropping mobile
support; see "Mobile, done the 2026 way" below. `Panels/MobileContainer` is 2,538 lines
(`MobileInspector` alone is 992), plus `Modals/MobileMenu` 132 and
`Util/MobileTabbedInterface` 185; 54 files mention mobile at all. What that tree actually
contains is a **fork of the Inspector**: `MobileInspector/MobileInspectorRow/
MobileInspectorRowTypes/` mirrors the desktop input types one for one —
`MobileInspectorNumericInput`, `MobileInspectorDualNumericInput`,
`MobileInspectorNumericSlider`, `MobileInspectorColor`, `MobileInspectorTextInput`,
`MobileInspectorSelector`. It is the same panel duplicated so it could be styled
differently, not a different interaction model. One responsive tree replaces it and takes
`react-rnd` and `react-device-detect` with it.

**Drop the eleven dependencies with zero import sites.** `@ffmpeg/ffmpeg`, `ace-builds`,
`rc-slider`, `react-aria-menubutton`, `react-dropzone`, `react-measure`,
`react-numeric-input`, `react-resize-detector`, `react-tabs`, `react-tiny-popover`,
`url-parse`. Each survives only as a string in `Modals/OpenSourceNotices` — 493 lines of
hand-maintained attribution. (Video export does use ffmpeg, but via a prebuilt worker at
`public/corelibs/video/worker-asm.js`, not the npm package.) Worth noting the attribution
list is therefore already wrong in the other direction too, which is the rebrand pass's
problem — see below.

**Wire the engine tests to a script** so Layer B/C work has a net.

### Phase 0 status — DONE 2026-07-24

Deleted 24 files: `Panels/MobileContainer`, `Modals/MobileMenu`, `Util/MobileTabbedInterface`.
`Editor.jsx` lost the `renderSize === "small"` layout fork (the MobileContainer branch, the
duplicate `ReflexSplitter` pair, the `mobile-editor-body` class, and the conditional wrapper
around the right sidebar, which now renders at every width); `MenuBar.jsx` lost
`renderMobile()`; `ModalHandler.jsx` lost the MobileMenu mount. The dead
`.mobile-editor-body` and `.mobile-reflex-splitter` rules are out of `_editor.scss`.

Dependencies 40 → 28. Dropped the eleven zero-import ones plus `react-device-detect`.
`react-rnd` **stays** — it is not only the mobile tree, `PopOuts/WickCodeEditor` uses it for
the floating code window.

`react-device-detect`'s three real call sites became `Util/pointer.js`'s
`pointerCannotHover()`, a `matchMedia('(hover: none)')` check. That is a fix, not a
translation: the tooltip suppression in `WickInput` and `CanvasTransforms` depends on whether
the pointer can hover, which is what the media query asks, while `isMobile` asked the
user-agent and got a touchscreen laptop wrong in one direction and a desktop-class tablet
browser wrong in the other. `WickButton` was worse — `onTouchStart={isMobile ? handleClick :
undefined}` with `onClick` set to `undefined` on touch, a workaround for the 300ms tap delay
that browsers stopped applying once a `width=device-width` viewport is present (`index.html:6`
has one). On any UA that string-matched as mobile, that button could not be activated from a
keyboard at all. It is a plain `onClick` now.

`engine/tests/run.mjs` (new) runs the browser-only mocha suite headless — a static server
over `engine/`, Playwright driving the system Chrome (`channel: 'chrome'`, so no browser
download), and a property trap on `window.mocha` that wraps `run()` to observe the runner's
events. Wired as `pnpm test` in `engine/`, `pnpm test-engine` from `editor/`. Also added
`engine`'s missing `build` script.

**Baseline: 8 deterministic failures**, out of 547 cases, in about 10 seconds. All eight fail
in the committed `dist/wickengine.js`, untouched by any of this — they are what the suite has
been doing unobserved. Two are tests leaking globals (`tempHolder`,
`_scriptOnErrorCallback`); two are `unload` scripts not running when a clip stops being
visible; three are SVG render layer-naming (`wick_project_outer` where `wick_project_bg` is
expected).

One is worth a look before it bites the tween work: **`Wick.Tween #interpolate should tween
rotation correctly (using no. of rotations param)` expects 270 and gets 90.00000000000001.**

A ninth is **flaky and load-correlated** rather than deterministic: `Wick.AutoSave
getSortedAutosavedProjects` blows mocha's default 2000ms timeout. Across seven runs it
appeared in five — the five where builds were running concurrently — and not in the two on an
idle box. Treat 8 as the baseline; if this one fails on a quiet machine it is a real
regression, not the machine being busy.

**Updated 2026-07-24: the baseline is 7, and it is enforced now.** The tween-rotation case
above passes. A suite that always exits non-zero is a suite nobody can gate on, so
`engine/tests/known-failures.json` lists the seven by title and `run.mjs` fails only on an
unlisted failure. Three further wrinkles fell out of making it a gate. Matching is on title
alone, so a listed test that starts failing a *new* way still passes — the price of a list
that survives assertion messages drifting. A listed test that passes is reported as STALE
rather than fatal, since one entry is the load-correlated AutoSave flake and passing is its
normal case. And more cases than that one time out under load: `Wick.HTMLPreview should
create a popup window correctly` blew the 2000ms default on one run of three here. So an
unexpected failure now re-runs the whole suite once and only what fails both times is fatal —
a real regression fails twice, and the ~10s retry is only paid on a run that was going to be
red. `--strict` ignores the list.

**Verified in Chrome.** The editor loads and is interactive at 1568px: full chrome, engine
bundle, timeline, tooltips on hover (which exercises the new `pointerCannotHover()` path —
desktop Chrome reports `(hover: none)` false, so tooltips still render). On a cold reload the
console carries **eight messages and zero errors** — engine version, two Vite HMR lines,
"Project Mounted", and the same four after a reload.

That last part is a fix nobody asked for. The react-reflex `offsetHeight` null-ref that fired
at every mount came from a **conditionally rendered `ReflexElement`** — the right sidebar's
`{!(renderSize === "small") && <ReflexElement>}`, which handed react-reflex a `false` child
to measure. Unwrapping it as part of removing the small-screen fork removed the error.

**Narrow widths, measured.** Every width below now renders the desktop tree, since the fork
that used to swap it out is gone. Swept at 1440 / 1024 / 900 / 768 / 375 in a headless
Playwright viewport (the Claude-in-Chrome extension's `resize_window` is useless here —
headed Chrome under Wayland cannot set its own geometry). **Zero console errors and zero
horizontal page overflow at every width**; the canvas scales down proportionally, 1181px wide
at 1440 to 168px at 375.

768 is cramped but coherent: the toolbox drops to its two-row `toolbox-container-medium`
layout showing five tools, the canvas is 510px, the timeline shows nine frames, and the
Inspector and Asset Library keep the right column.

375 is not an authoring surface. The menu bar's "support us" button overlaps the project
title and the right-hand menu runs off the edge; the Inspector takes roughly half the width;
the canvas is a 168px sliver; the timeline shows one frame and the layer name truncates to
"Laye". Nothing throws and nothing overflows — it clips instead. So the survey's prescription
(hard minimum authoring width ~1024, switch layout below it rather than shrink, view-only
below 768) is confirmed as needed rather than merely advisable, and Phase 1a owns it.

## Phase 1a status — DONE except the sub-768 layout (2026-07-24)

Commits `febf3d3`, `23965a4`. The four things 1a was scoped as — shell, tokens, the
shadcn primitive layer, `WickInput` — are all in. What the plan did not anticipate is
that **React 19 was the gate, and three of the dependency swaps were forced by it rather
than chosen**: react-reflex throws out of `<ReflexElement>` under React 19 at both v3 and
v5, react-dnd 11 has no hooks API, and react-sizeme reaches its element through the
removed `findDOMNode`. The shell rewrite could not be deferred behind anything.

Corrections to what is written below:

- **react-resizable-panels is v4, not the v2 this table assumed.** The components are
  `Group` / `Panel` / `Separator`, the axis prop is `orientation`, and it names the axis
  after the *separator* rather than the split — so every group is flipped relative to
  reflex. It also accepts explicit units, so the 250px sidebar and 175px timeline
  survived instead of being re-guessed as percentages.
- **`WickInput.jsx` is 282 lines, not 610** — that count was the directory, including
  `WickTextInput` and `WickButton`, which are untouched and still fine.
- **react-dropdown was never a component here.** The only reference anywhere was
  `import 'react-dropdown/style.css'` — a dependency for one stylesheet.
- **rc-slider is not installed at all**, so that row of the table has nothing to do.
- **`WickInput` used reactstrap for exactly one thing**, `<Input type="radio">`, which is
  a plain `<input>` plus a Bootstrap class. reactstrap survives in three other files
  (`ExportMedia`, `ColorPicker`, `PopupMenu`), so the bootstrap CSS import stays for now.

Contrast was measured rather than assumed, and five values in `_wickbrand.scss` failed:
`interface-secondary-text` 4.21:1, `wick-gray-text-light` 4.04:1, `interface-tertiary-text`
1.94:1 (search fields), `FRAME_SCRIPT_DOT_COLOR` 2.03:1 on a white frame, and
`TWEEN_FILL_COLOR_1` 1.52:1. All corrected in the token layer, each by the smallest
lightness move along its own hue that clears the bar.

**The sub-768 layout was left for 1b and landed in `87125bd` / `484294c`** — see the
breakpoints section below.

## Phase 1b status — every dependency swap but one (2026-07-24)

Commits `9ba9c13`, `222fe7f`, `65eecf2`, `beeac81`, `c9b5202`. Twelve libraries out, six
in. Production bundle 2,353 kB → 2,157 kB (gzip 663 → 638).

| out | in | where |
| --- | --- | --- |
| reactstrap, react-popover | `@radix-ui/react-popover` | `PopupMenu`, `ColorPicker`, `SettingsNumericSlider` |
| bootstrap | — | it was imported in nine files to style reactstrap's popover |
| react-toastify | sonner | `Editor.toast` / `updateToast` keep their signatures |
| react-color | react-colorful | `WickColorPicker`, `WickSwatch` |
| react-ace (and brace) | CodeMirror 6 | `WickCodeEditor` |

Three things the swaps turned up that were not on anyone's list:

- **A tooltip and a popover on the same control fight each other.** Radix opens a tooltip
  on any focus, including focus moved by script; a popover moves focus into itself when it
  opens; and in the colour picker the first control inside has a tooltip. So opening the
  picker popped a "Swatches" tooltip on top of it, and because a tooltip is a dismissable
  layer and it mounted last, it swallowed the first Escape — the picker looked like it was
  ignoring the key. The tooltip trigger now opens on focus only when the trigger matches
  `:focus-visible`.
- **The open-source notices modal named the wrong libraries.** 492 lines of hand-written
  JSX, still listing react-aria-menubutton years after it left. Generated from the lockfile
  now (`pnpm notices`, `pnpm notices:check`); the engine's vendored libraries stay by hand
  in `notices-vendored.json`.
- **The welcome modal is gone** with its three splash PNGs and two SVGs. It opened on every
  load and had to be clicked away before any manual test.

`dev/interact.mjs` is new and is what found the tooltip/popover fight: it opens each
control and asserts the content appears and Escape closes it. `dev/smoke.mjs` only ever
proved the page rendered, which says nothing about a popover that is not in the DOM until
you click.

**Still on the list: react-hotkeys.** It is the only one left and the only one that is not
straightforwardly a swap. `hotKeyMap.js` is 717 lines whose sequence strings are also the
strings displayed in the shortcuts settings and in every tooltip; the settings modal
records new bindings through react-hotkeys' `recordKeyCombination`; and react-hotkeys
ignores keystrokes typed into inputs, which tinykeys does not, so that filter has to be
rebuilt. It works under React 19, so nothing is blocked on it.

## Breakpoints status — 1024/768, and a viewer below (2026-07-24)

Commits `87125bd`, `484294c`. `getRenderSize()` splits at 1024 and 768 instead of 1200 and
800, and below 768 `Editor.render` returns a different tree: `Panels/ViewOnly`, which is a
project name, the stage, and one play button.

768 is inclusive, so an iPad in portrait keeps the authoring layout. The survey's number
and this document's argument both say tablet-with-a-stylus is a drawing target, and 768 CSS
px is exactly an iPad in portrait — an exclusive comparison would have sent it to the
viewer.

The engine needed three things told to it, and one of them was a trap:

- **`fitMode = 'fill'` is the wrong mechanism for a viewer**, despite reading like the right
  one. It sets `paper.view.zoom = model.zoom * calculateFitZoom()`, so any `recenter()` —
  `hidePreloader` does one two seconds after load, `prepareProjectForEditor` does one per
  project — squares the scale and the stage collapses to a quarter size. `recenter()` on its
  own already fits the stage to its container with 4% padding, which is all the viewer
  wants.
- **The `none` tool.** Without it a drag on the canvas still selects and moves objects, and
  a viewer that edits is not a viewer. It goes back by name on the way out, because tools
  belong to a project and the project can be swapped underneath.
- **`guiElement.draw()` had to be guarded.** The viewer does not mount the Timeline, so the
  GUI project still holds the detached container it builds in its own constructor; drawing
  into it reads `offsetWidth` 0 and `gui/Project.js:181` turns that into a canvas width of
  -2. The `onRef` prop on `<Timeline>` looks like the guard and is not one — Timeline never
  calls it, so `this.timelineComponent` had always been null.

Making below-768 a viewer made every `renderSize === "small"` branch in the authoring chrome
unreachable, and `484294c` deletes them: the third Toolbox variant, the `isMobile` prop that
only that variant ever set (it reached four class names through three components), 23 dead
`renderSize` props on `ToolSettingsInput`, `DeleteCopyPaste`, the small code-editor window,
and twelve CSS rules. 348 lines out, 43 in. One of them was a second
`id="more-canvas-actions-popover-button"` that `ids-unique` could never see, because only
one branch ever rendered.

`dev/interact.mjs` gains a step that resizes the live page to 375 and back rather than
opening a second page, because the interesting part is the transition. It caught that
`window.project` is not a reliable handle: `Tickable.js:549` assigns it for the script
sandbox and deletes it at line 571, so it is gone after anything plays.
`window.editor.project` is the one that survives.

## The checks run somewhere now (2026-07-24)

Everything above was verified by running `pnpm smoke`, `pnpm interact` and `pnpm test-engine`
by hand. `ci.yml` is Rust-only, so none of it gated anything —
`.github/workflows/editor.yml` now runs `notices:check`, `pnpm build`, the engine suite,
`smoke --sweep` and `interact` on every push that touches `editor/`. Path-filtered, because a
commit in `src/` or `fixtures/` has no reason to spend five minutes on a browser.

The browser checks run against `pnpm preview` on the built bundle rather than the dev server.
That is what ships, and it costs nothing extra — `pnpm build` already has to run.

Two things stood between the local scripts and a bare runner. Every script hardcoded
`channel: 'chrome'`, which is right locally (no 150MB browser download to read a console) and
wrong for a runner that may not have Chrome; `dev/browser.mjs` is the one place that decides
now, honouring `PLAYWRIGHT_CHANNEL`, and CI sets it to the empty string to select Playwright's
own chromium — empty, not unset, since unset means `chrome`. And `public/corelibs/ruffle` is
gitignored while `index.html` loads `ruffle.js` from a plain script tag, so a fresh clone 404s
and every console check carries a resource error. `dev/fetch-ruffle.sh` stages it, pinned to
release **v0.4.1** rather than the nightly BUILD.md pointed at — Ruffle prunes old nightly
assets, so that URL 404s eventually too. The SWF preview modal still mounts a `ruffle-player`
at 720×480 under 0.4.1.

The leave-page confirm dialog is gone from dev and test runs, which is what made this
tractable: it fired on **every** reload because `project.numUndoStates` is undefined (the
counter is on `project.history`), the guard was inverted against its own comment, and `this`
inside a plain function on `window.onbeforeunload` is `window` — whose `project` the script
sandbox deletes. It is armed only when `navigator.webdriver` is false outside a dev build,
and `localStorage['twip:leave-warning']` (`'on'`/`'off'`) overrides that either way.

**Green on the runner in 1m52s — after three red runs, each of which was worth having.**
Three `Wick.Project #generateAudioTrack` cases assert a 48000Hz `AudioContext`; a GitHub
runner's is 44.1k, so they wanted 48000 and got 44100. The test hardcodes the rate and the
engine returns what the context gives it, so they are listed as `intermittent` — and the
retry pass is what identified them, since they survived two runs where a load-flake would
not have. Then `smoke.mjs` failed at all six widths reporting `error:` and nothing else:
messages the browser generates rather than a script (a 404, a CSP violation) arrive with no
arg handles, so resolving the args produced an empty string. It falls back to `m.text()` plus
`m.location()` now, which also finally named the long-standing local `warnings=1` — the
engine bundle asking for `willReadFrequently` on a canvas it reads back a lot
(`wickengine.js:14525`). With a legible message the third failure took one run: Ruffle was
being staged *after* `pnpm build`, and vite copies `public/` into `build/` as it runs while
`preview` serves `build/`. It passed locally only because `public/` already had Ruffle in it.

## Phase 1 begun — the Inspector (2026-07-24)

Everything before this was plumbing: the mobile fork pruned, twelve libraries swapped, the
breakpoints moved, CI wired. The `@theme` block in `src/index.css` was complete and only the
eight components in `src/ui` used it, while `src/Editor/Panels` was 4,839 lines of JSX
against 69 stylesheets. The Inspector goes first, being the largest panel and the one that
changes shape under the cursor. Nine `.scss` files, 464 lines, gone; `src/` is down to 58
stylesheets and 5,591 lines.

**Eight row types hand-wrote the same three class names**, which is how the widths drifted:
`_inspectorrow.scss` carried `$row-identifier-width: 30%` plus three widths derived from it,
and a row that wanted something else added a rule. `InspectorRow.jsx` owns that geometry now
as `InspectorRow` / `InspectorLabel` / `InspectorField`, in the same percentages.

Colours map onto tokens that already existed rather than new ones — `$editor-primary` is
`bg-surface`, `$editor-primary-outline` is `border-surface-sunken`, `$editor-tertiary` is
`bg-surface-hover`. Two literals stay literal (`#426180` on the active frame-picker button,
`#05b8ff` on a script's colour bar) because neither belongs in the palette until the frame
picker's design is settled.

Four classes deleted here were already dead: `.input-divider`, `.select-inspector` and
`.inspector-action-row` have no JSX referencing them, and **`docked-pane` matches no rule
anywhere** — the rule is `.docked-panel` — while MenuBar, Outliner and AssetLibrary still
carry it.

**The font dropdown was the expensive find.** `_inspectorselector.scss` opened with 157
`@import url('https://fonts.googleapis.com/…')` lines, which vite hoists into the shipped
stylesheet, so the browser fetched all 157 before painting whether or not anyone opened the
dropdown — measured at 157 of the 183 requests the editor made on load, 86% of them, to a
third party. The other 296 lines were `.font-selector-<Name>` rules that the Radix swap had
already orphaned. And the inline preview that replaced them never fired either: it tested
`className === 'font-family'` where WickInput sends `"wick-input-select font-family"`, so the
preview had been broken since the swap and the 157 requests were buying nothing. Now: 24
requests on load, none to Google, and four chunked stylesheets injected when the dropdown
opens. Options carry their own `style` and `className`, which also restores the tint on fonts
already in the project that the swap had silently dropped.

Generating `@font-face` against the 55MB of TTFs already in `public/fonts/` would drop Google
entirely and work offline, which matters for Tauri. Measured and rejected for now: Radix
renders all 152 options at once, and those TTFs are 55MB where Google's subsetted woff2 for
the same faces is 2.22MB. Worth revisiting if the listbox ever virtualizes.

`interact.mjs` gains an `inspector` step — the panel had no coverage at all. It draws a
rectangle, selects it, checks the title follows the selection type and the rows render, then
types a width and confirms the *engine* took it rather than just the input. It also retries a
failed step once now, for the same reason `engine/tests/run.mjs` does: its assertions are
3000ms waits and the slider step flaked here on a loaded box.

## Phase 1 — the chrome, on Tailwind + shadcn

This is what most people would call "the redesign," and it is the part with no unknowns.

**The shell first.** `Editor.jsx:956` is a 343-line `render()` holding a nested
`ReflexContainer` tree — 48 reflex/rnd/DockedPanel elements, drilling **202 props** in one
function. State is a single flat 30-key object on one class component, with
`EditorCore.jsx` (2,054 lines) as a mixin-style base class supplying every method. There is
no context, no reducer, no store anywhere in the tree. Replace the reflex nest with a CSS
grid plus a resizable-panel primitive, and put the state behind context so panels stop
receiving twelve callbacks each.

**Tokens are not a blank page.** `_wickbrand.scss` already defines 130 SCSS variables; they
map onto a Tailwind theme more or less directly. 25 of the 75 SCSS files hardcode hex
outside that file — those are the ones to chase. The contrast targets from the survey
(4.5:1 text, **3:1 non-text UI components**, no state encoded by color alone) belong in the
token layer, decided once, rather than per-component.

**`Util/WickInput/WickInput.jsx` is the highest-leverage single file.** Its 610 lines wrap
`reactstrap`, `react-select`, `react-dropdown`, `react-tooltip`, and `react-device-detect`.
Reimplementing it on shadcn primitives drops five dependencies in one move and normalizes
the control heights that hand-CSS keeps drifting apart.

**Library replacements.** The fork's UI deps were chosen 2018–2020 and most have a
maintained successor that also carries the keyboard and screen-reader work the originals
predate. Verify current status before adopting any of these — the list is from knowledge,
not from an npm check:

| Current | Replacement | Note |
|---|---|---|
| `react-reflex` | `react-resizable-panels` | What shadcn's Resizable wraps. Direct swap for the `Editor.jsx` panel nest. |
| `react-modal` | Radix Dialog (shadcn) | Focus trap and restore built in; `WickModal` currently hand-rolls neither. |
| `react-select`, `react-dropdown` | Radix Select, `cmdk` | Both live in `WickInput.jsx`. |
| `react-tooltip`, `react-popover`, `rc-slider` | Radix Tooltip / Popover / Slider | |
| `reactstrap` (Bootstrap 4) | shadcn primitives | Removing it also removes the `bootstrap` CSS import, referenced in 15 files. |
| `react-toastify` | `sonner` | shadcn's default toaster. |
| `react-color` | `react-colorful` | ~2KB, maintained; `react-color` has been stale for years. |
| `react-dnd@11` | `pragmatic-drag-and-drop` or `dnd-kit` | The React-18 blocker. Pragmatic ships keyboard-accessible dragging, which matters for Outliner reordering. |
| `react-hotkeys@2` | `tinykeys` or `react-hotkeys-hook` | `hotKeyMap.js`'s 717 lines of Flash shortcuts are the feature; only the binding layer changes. |
| `react-ace` + `ace-builds` | CodeMirror 6 | Smaller than Ace or Monaco, first-class mobile/touch, and the extension model suits a small scripting editor. |
| `react-sizeme`, `react-measure`, `react-resize-detector` | `ResizeObserver` | Universal since 2020; three wrappers for one browser API. |
| `react-spinners` | CSS | |

Platform features that did not exist or were not universal when this code was written and
that change what is worth building: CSS subgrid (the layer-rows × frame-columns shape is
literally a subgrid), container queries, `content-visibility: auto` and CSS containment,
Pointer Events with `setPointerCapture` for scrubbing and drag, `ResizeObserver` /
`IntersectionObserver`, and headless virtualization (TanStack Virtual) that makes a
10,000-cell grid render as a few hundred nodes. Together these are why a DOM timeline is a
question in 2026 and was not in 2019.

**Then panels, one at a time.** The engine mount points are stable anchors — Canvas and
Timeline keep their divs and don't change at all during this phase. Inspector (2,925) is
the big one and gets the survey's tabbed context-aware treatment. Toolbox (1,429),
Outliner (1,190), AssetLibrary (495), MenuBar (412).

**De-modal, SWF first.** `Modals/ExportOptions` is already restructured so SWF leads
(`59c4862`), but it is still a modal reached through a menu. The redesign should surface
SWF preview and SWF export in the primary chrome and leave the inherited Wick export
categories in a secondary surface. Two known defects die here rather than getting fixed
twice: the mobile export modal offers no SWF at all, and `Util/TabbedInterface.jsx:75`
pairs children to tabs by raw array index, so any platform passing a subset of
`window.allowedExportTypes` renders blank bodies.

Six to eight sessions, roughly one per major panel plus two for shell and tokens.

**Split it around Phase 2.** Now that the timeline rewrite is committed rather than
conditional, doing every easy panel first and the hard one last is the wrong order — it
front-loads the work that teaches you least. Do **1a** (shell, tokens, the shadcn primitive
layer, `WickInput`) first, because the timeline needs a design system to be built in. Then
Phase 2, while there is still room to change course on the primitives if the hardest
component finds them wanting. Then **1b** — Inspector, Toolbox, Outliner, AssetLibrary,
MenuBar, de-modaling — which is mechanical by comparison and benefits from whatever the
timeline taught. Phase 1a no longer needs to wrap the engine timeline mount in a
props-shaped component to keep options open; the option is chosen.

## Phase 2 — the timeline, rewritten in DOM

**Decided 2026-07-24 (Justin): rewrite it, on 2026 practice.** Two other options were on the
table — leave it on canvas, or add a Figma-style Mirror DOM over the existing canvas for
accessibility only — and both are cheaper. The deciding argument was not accessibility. It
was that the paradigm underneath `engine/src/gui/` makes every future timeline feature
expensive, and the timeline is where twip's remaining feature work lives.

What "crufty" means concretely, since the syntax is not the problem (`Frame.js:20` is a
plain `class extends Wick.GUIElement`): every visual is an imperative `draw()` doing its own
`ctx.save()/restore()` and translation bookkeeping; `GUIElement.js` hand-rolls
`bounds`/`localMouse`/`mouseInBounds`/`mouseState`/`_getTopMouseTarget`/`_isDragging`, which
is a private reimplementation of hit-testing and event dispatch; cursors are assigned as
side effects mid-draw (`this.cursor = 'ew-resize'`); type is `'12px Courier New'` and some
colors are inline `'rgba(255,222,35, 0.0)'` literals sitting next to the constants block;
and any model change repaints the whole tree. It is a competent 2010s canvas-widget idiom,
and it is a private framework twip would own forever.

**The seam is clean.** Outside `src/gui/` itself, the canvas timeline is referenced in
exactly two model files: `base/Base.js` (`_generateGUIElement()` at :587 constructs a GUI
twin for every model object by classname, plus the getter/setter at :365-371) and
`base/Project.js:157` (one `removeAllEventListeners()` call). The `guiElements` in
`view/paper-ext/Paper.SelectionWidget.js` are unrelated — those are the on-stage rotation
and scale handles. So this is replacing a leaf, not operating through the model. A React
timeline reads the same `project.activeTimeline.layers[].frames[]` the canvas one does.

Of the 3,723 lines, ~1,013 across seven files (`Scrollbar.js` 88, `PopupMenu.js` 151,
`SelectionBox.js` 99, `ActionButtonsContainer.js` 154, `LayerButton.js` 90,
`BreadcrumbsButton.js` 88, `GUIElement.js` 343) exist only to reimplement what the browser
gives away. The rewrite is smaller than the line count suggests.

**Build it on**: CSS grid (subgrid for the layer-rows × frame-columns shape), TanStack
Virtual for the frame axis so cell count stops mattering, `setPointerCapture` for scrubbing
and frame-edge dragging, `pragmatic-drag-and-drop` for frame and layer reordering with
keyboard support, react-aria's grid pattern for roving focus and screen-reader semantics,
SVG for the Bézier easing editor. TypeScript from the first file — this is the most complex
component in the editor and the one where types pay.

**Verification**: the engine's 39k lines of mocha tests cover the model the timeline reads
from, so behavior can be asserted against project state rather than pixels. The 13 timeline
operations already in `hotKeyMap.js` (`insert-blank-frame`, `extend-frame`,
`move-playhead-forwards`, …) are the acceptance list — each must still work, and each
becomes reachable by keyboard *and* announced, which is the a11y story arriving as a
by-product rather than as the goal.

The risk that stays: the timeline is where Flash nostalgia lives most concretely, so this is
the surface where a rewrite is most visible if it lands wrong. Keep the existing canvas
implementation buildable until the replacement is accepted, and compare side by side.

## Phase 3 — mechanics

Auto-keyframing at the playhead (the survey's highest-leverage change, and Rive's default),
the graph easing editor, per-property tracks in the UI. All of these need Phase 2's timeline
to have somewhere to draw.

The compiler is already ahead of the editor here: per-property tween semantics were
ratified in `8525292` and signed skew landed in `4ff40dc`, so twip can already compile
tweens the editor has no UI to author.

---

## Mobile, done the 2026 way

The fork's answer to mobile was a second component tree switched on by
`react-device-detect`, with `renderSize` ("small"/"medium"/"large") threaded as a prop —
101 occurrences across 11 files. That is the part to delete. Mobile support itself gets
better, not worse, and in four places it gets better *because* of decisions already made.

**Viewing is the highest-value mode and is nearly free.** twip's output is a `.swf` played
by Ruffle's wasm player, which runs in mobile browsers. The survey's "below 768px, degrade
to view-only playback" costs a route and a play control, not a component tree. Most people
who touch a twip animation on a phone will be watching one.

**One responsive tree instead of two.** Container queries let the Inspector lay itself out
from its own width rather than from a global size prop, which is what makes a single tree
viable where it wasn't in 2019. At narrow widths, panels become bottom sheets (shadcn's
Drawer, on vaul) instead of forking into `Mobile*` twins. Deleting 2,861 lines and
supporting small screens are the same change.

**Tablet is a first-class drawing target, not a degraded desktop.** An iPad with a Pencil
beats a laptop trackpad for drawing, and the engine already wants this — `lib/croquis.js`
is a pressure-sensitive brush library and `tools/Brush.js:142` feeds pressure straight into
it (`croquis.down(x, y, this.pressure)`). The break is upstream of that:
`view/paper-ext/View.pressure.js` is 34 lines that read pressure through the jQuery
`pressure.js` plugin, which targets Apple Force Touch and 3D Touch — removed from iPhones
after 2018 and Mac-trackpad-only otherwise. So a Pencil currently supplies nothing and
every stroke is full pressure. Pointer Events give `pressure`, `tiltX`/`tiltY`, `twist`,
and `pointerType` natively across iOS, Android, and desktop styluses. **Porting that one
34-line file is the highest-leverage mobile change in the codebase**, and the downstream
plumbing is already correct.

**The timeline rewrite helps here.** A DOM timeline inherits touch scrolling, momentum, and
pinch-zoom from the platform; the canvas one hand-rolls `Scrollbar.js` (88 lines).
`GUIElement.js:211` already defines `GRID_LARGE_CELL_WIDTH/HEIGHT` at 62×52, which is the
touch density — it exists and is currently unreachable except through the `IS_MOBILE`
check being deleted.

**Tauri 2 already targets iOS and Android.** `src-tauri/Cargo.toml:18` is on Tauri 2, so
shipping the same UI as a real app with the Rust compiler linked in is a config-and-signing
problem rather than an architectural one. This gives the deferred Tauri item a second
reason to exist beyond desktop.

What genuinely does not work on a phone is authoring with stage, timeline, inspector,
outliner, library, and toolbox visible at once. No amount of responsive CSS fixes that, and
the answer stays the survey's: hard minimum authoring width around 1024px, switch layout
below it rather than shrink, view-only below 768px.

## Folded in rather than swept twice

HANDOFF says to fold the leftover tooling and the rebrand into this pass. Where each lands:

**TypeScript** — at the Phase 1 boundary. New components in TS, `allowJs` on, no big-bang
conversion of 19k lines that are being deleted anyway.

**biome** replaces the `eslintConfig: {extends: "react-app"}` stub in `package.json`, which
does nothing now that CRA is gone. **vitest** covers the new components; there is currently
no test of any kind for Layer A. **turbo** only earns its place if the engine build and the
editor build become separate tasks worth caching — decide at Phase 2, not now.

**React 18/19 is a consequence, not a prerequisite.** React stayed at 16.14 in the Vite
migration because ~40 vendored libs predate 18. After Phase 0 removes eleven and the mobile
pair, and Phase 1's shadcn swap removes `reactstrap`, `react-select`, `react-dropdown`,
`react-popover`, `react-tooltip`, `react-modal`, and `react-toastify`, what actually blocks
18 is a short list: `react-dnd@11` (Outliner and AssetLibrary drag-drop, plus Timeline and
Canvas as drop targets), `react-ace@6` and `console-feed@3` (both only in
`PopOuts/WickCodeEditor`), `react-hotkeys@2` (`EditorWrapper.jsx` — and `hotKeyMap.js` is
717 lines of Flash-faithful shortcuts that are a feature to preserve, not debt),
`react-color`, `react-sizeme`, `react-spinners`, `react-reflex`. Each has a maintained
replacement. Do the upgrade when that list is the only thing left, not before.

**Rebrand / attribution** (HANDOFF item 5, a hard gate on any sharing) touches the same
files Phase 0 and Phase 1 touch. `Modals/SupportUs` (376 lines, Patreon link + patron
names) and the "support us" button in `MenuBar.jsx` get deleted during the modal pass;
patron names in `Modals/WelcomeMessage` go when that modal is rebuilt; `OpenSourceNotices`
gets regenerated from the pruned dependency list instead of hand-maintained. The GPLv3
obligations are untouched by any of this — the `Copyright 2020 WICKLETS LLC` headers stay
in every file, LICENSE stays, and the "twip is based on Wick Editor by Wicklets LLC
(GPLv3)" credit gets added rather than the origin erased.

**Also fix while in there** (from `_editor.scss` and the Vite config): the SCSS
`darken()`/`lighten()` deprecations are currently silenced in `vite.config.mjs` on the
explicit premise that this redesign replaces the SCSS wholesale. If Phase 1 is ever
abandoned, that silencing becomes real debt and sass ships a migrator for it.

## Not in scope

Six-panel authoring on a phone screen — but not mobile as such; see "Mobile, done the 2026
way." A "classic Flash skin" toggle — the survey is explicit that the nostalgia
is layout-borne, and a second skin doubles maintenance for little gain; the nostalgia knob
stays small (a density toggle, an optional accent). Multiplayer cursors. A gallery or any
Next.js surface. Rewriting the vector tools or the scene view (Layer C) — the tools work,
and nothing in the survey asks for them to change.

## Open decisions

**~~Does Phase 2 happen at all?~~** Settled 2026-07-24: the timeline gets rewritten. See
Phase 2.

**Does the old canvas timeline get deleted, or kept behind a flag?** Deleting
`engine/src/gui/` also means deleting `_generateGUIElement` from `base/Base.js`, which is a
change to vendored engine source that makes future upstream merges harder. Keeping both
buildable during the rewrite is clearly right; whether the canvas one survives past
acceptance is a call for then. (Flag-gated features are not done until the flag is flipped —
if the new timeline ships behind a toggle, "make it the default" is its own tracked task.)

**Does the survey's Simple/Advanced mode split get built?** It is the answer to the
nostalgic-vs-newcomer tension, and it is also a second UI. Cheap to defer, expensive to
retrofit if the panel architecture assumes one mode.

**Where does SWF export live in the new chrome?** "SWF leads" is settled; whether that means
a toolbar button, a persistent panel, or the primary action in a redesigned export surface
is a Phase 1 design call.
