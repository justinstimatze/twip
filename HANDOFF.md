# twip — HANDOFF

A modern Flash recreation, personal nostalgia project (Justin's, explicitly not a product).
Draw vector shapes on a timeline, tween them, press export, get an honest-to-god .swf that
Ruffle plays. Design converged 2026-07-23 across one long session; plan pressure-tested by a
5-expert adversarial panel (all verdicts sound-with-changes, zero fatal). Raw panel output
with per-finding file/line evidence: `reference/panel-findings.json`. Everything below that
says "verified" was checked against live repos/APIs that day.

## Naming

- **twip** = the name for EVERYTHING — repo, crate, project, and (later) editor (SWF
  coordinate unit, 1/20 px). Collision-checked: crates.io FREE, npm FREE, twip.dev
  unregistered. Soft collisions only: dead PHP twitter proxy (github twip/twip, 2016), dead
  PyPI tweet tool, twip.app parked by Italian agency twipping.com, and (unverified, from
  model memory) twip.kr Korean Twitch donation platform. Fallback name if twip ever rankles:
  **mutoscope** (clean everywhere).
- **The name split is retired** (decided 2026-07-23, superseding the original handoff). There
  is no longer a separate `wick2swf` v1-compiler name; the crate/CLI and the future editor
  share the single `twip` name. Repo: private, main branch (`gh repo create twip --private`).
  The compiler CLI is the `twip` crate; the editor phase (maybe never) is also `twip`.

## Architecture (the "elegant version")

One Rust crate is the center of gravity: it is simultaneously the document model, the
compiler, and the file format. Everything else (CLI, editor, importer) is a thin consumer.

- **One file format, and it's SWF.** Saving IS compiling: the file gets the baked movie plus
  one custom tag holding the full source document (tweens un-baked, cubics un-subdivided,
  layer names). Opening = parse the SWF back, read that tag. SWF spec requires players to
  skip unknown tags, so every save plays anywhere. `.wick` is an IMPORTER, not the format.
- **One truth renderer, and it's Ruffle.** Anything that plays (scrub/preview/test) is Ruffle
  rendering compiled SWF. The edit canvas is deliberately schematic (handles, path points,
  onion skins) and never claims pixel fidelity — kills the dual-renderer bug class by design.
- **We maintain our own polished fork of StickmanRed/wick-editor as the twip editor** — but
  in a SEPARATE repo from the compiler crate. The Rust workspace is NEVER planted inside the
  162MB Node-14 CRA; that conflation is the only thing the design rejected, not owning an
  editor. Two repos: `twip` (Rust compiler+CLI, clean home) and our `wick-editor` fork (React,
  GPLv3, the editor product) that shells out to the twip CLI. Positioning: THE Wick-family
  editor that exports playable SWF for the modern Ruffle/Royale revival ecosystem — the SWF
  export is the actual differentiator (StickmanRed is already the live/polished fork; polish
  alone just adds one more), polish only drives adoption. Also keep a plain read-only reference
  clone (`reference/wick-editor`, DONE) for reading engine semantics.
- **Desktop = Tauri** (same web UI, ~5MB shell; the compiler crate is a direct function call,
  no WASM/IPC seam; ruffle_core can be LINKED NATIVELY so editor+compiler+player are one
  binary). **Web = PWA** from the same Vite build, hosted once on Pages. Set relative base
  path (`homepage`/`base: "."`) so the static build also runs off any dumb server.
  A TiddlyWiki-style single-file .html build is a fun later target (file:// IS a secure
  context in Chrome; verify file-picker APIs before promising save/open there).
- **The editor is a first-class goal, not "Phase 4 maybe never"** — it IS the nostalgic
  experience ("Flash that just works"), which is the point of the project. It is our polished
  FORK of the live Wick editor, NOT a fresh reimplementation: Justin was a Flash beginner and
  cannot QA a vibe-coded creative tool, so reusing the battle-tested UI removes that risk
  entirely (a fresh rebuild reintroduces it). Integration seam for the Export button: prefer a
  **Tauri desktop shell** loading the existing React UI and shelling out to the twip CLI —
  dodges the webpack-4 WASM landmine and links ruffle_core natively for the preview tab.
  Web/PWA (script-tag Ruffle + `load({data})`) is a follow-on constrained by the frozen
  webpack-4 stack. A fresh-from-scratch editor on the WASM core is explicitly OFF the table now
  (was the rejected plan); if paper.js path booleans ever matter they're inside the fork's
  existing engine, not something we rebuild.

## Verified facts (2026-07-23)

- **Deployed Wick editor is LIVE at https://wickeditor.com/editor/** (200, full CRA bundle).
  editor.wickeditor.com is DEAD (curl 000). Fixtures can be authored there today — the
  editor fork is NOT on the v1 critical path.
- **StickmanRed/wick-editor**: only live fork (+54 ahead, 0 behind; HEAD 2026-06-27 "Add
  different tween methods and inspector clip skew"; gh-pages deployed 2026-07-09; 17★; no CI).
  Builds ONLY on Node 14 (README says so; react-scripts 2.0.5 / webpack 4.19.1 / node-sass
  4.14.1 — the linux-x64-83 prebuilt binding still downloads, verified 200). NEVER attempt a
  "modern Node" migration; the fork's own updgrading-react branch died Feb 2021. Its +54
  commits changed zero build config. package.json has postinstall electron-builder — delete
  it / --ignore-scripts for browser-only work. Editor consumes a COMMITTED prebuilt engine
  bundle (public/corelibs/wick-engine/wickengine.js, 2.27MB, kept current by the fork) — the
  gulp engine build is fully skippable. Built gh-pages assets use absolute /wick-editor/
  paths (homepage field) — serve parent dir or rebuild with homepage: ".".
- **swf crate**: crates.io 0.2.2 (published 2025-01-20) is an 18-month-stale DECOY wearing
  the same version number as ruffle master's swf/ (40+ commits divergence). MUST use a git
  dependency pinned to one ruffle-rs/ruffle rev, and build the CI exporter + preview player
  from that SAME rev. Bump all together.
- **avm1::write IS public** (`pub mod avm1` in swf/src/lib.rs; write_action on pub Writer).
  Gotchas: DoAction = `&[u8]` (Tag<'a> borrows ⇒ owned byte-buffer arena pattern);
  Action::End must be appended manually; write_tag_list appends Tag::End implicitly (never
  push it); Header/Sprite num_frames are caller-supplied — compute as ShowFrame count in the
  same function that finalizes each timeline.
- **DefineShape4 unconditionally**: RGBA fills need v3+, LineStyle2 caps/joins need v4,
  NON_ZERO_WINDING_RULE flag only written for v4 — and paper.js default fill rule is nonzero.
  Lower versions drop alpha silently or hard-error.
- **Ruffle exporter as CI oracle works** but: unpublished binary crate, builds whole ruffle +
  wgpu (~20-40min cold), needs software Vulkan (mesa-vulkan-drivers/lavapipe — copy ruffle's
  own .github/workflows/test_rust.yml recipe), and goldens MUST be blessed on the same
  backend that checks them (lavapipe in CI, never the dev GPU).
- **Ruffle web embed**: script-tag selfhosted build in public/, `player.ruffle().load({data:
  bytes})` takes an ArrayBuffer (no server round-trip). Never import @ruffle-rs/ruffle
  through webpack 4. No COOP/COEP requirement. Serve .wasm with correct MIME.
- **Tier-0 clicks**: ClipEventFlag::PRESS/RELEASE on PlaceObject clip actions (hit area =
  clip shapes). NOT MOUSE_DOWN (fires stage-globally). PRESS is SWF6+ ⇒ just use header
  version 8. stop/play/gotoAndPlay = plain DoAction. No button tags needed for v1.
- **Apache Royale** alive (AS3→ABC/SWF + JS backends) — only relevant if full AS3 scripting
  is ever wanted (doubtful; general JS→AVM1 compilation is a permanent non-goal).
- License: GPLv3 is NOT forced if no Wick code is vendored (swf crate is MIT/Apache-2.0).
  Justin is fine with GPLv3; it's a choice, decide at repo creation.

## Wick semantics the compiler must honor (panel-verified, file:line in panel-findings.json)

- **Path.json is raw paper.js exportJSON**: segment handles are RELATIVE to anchors;
  handle-less segments serialize as bare [x,y]; top-level class may be Path, CompoundPath,
  Raster (images!), PointText, Group; colors are hex strings OR float arrays. Add images to
  the v1 OUT list. Emit twips by rounding ABSOLUTE coords then taking deltas (else drift).
- **Brush = potrace output** (Brush.js ~356): CompoundPaths, holes by winding. SWF has NO
  fill rule — fill is per-edge (FillStyle0=left, FillStyle1=right). REQUIRED Phase-1 module:
  planarize (self-union under nonzero), normalize winding, assign fill sides. Fixtures:
  brush-drawn donut, self-crossing pencil path, figure-eight. This is the hard 20% — but
  2026 tooling helps: **`i_overlay`** (v6+, actively maintained) does polygon union/diff/xor
  with self-intersection + hole support under the non-zero rule, and has an **i32 API** that
  fits twip integer coords with no float-epsilon fragility. Pipeline: flatten paper.js cubics
  to polylines at twip resolution → i_overlay union (nonzero) → assign FillStyle0/1 edge sides;
  kurbo does the curve math (cubic→quadratic). Validate in Phase 1.
- **Tweens**: fork's new default tweenMethod 'normal' goes through paper.Matrix.decompose +
  a buggy reconstruct (dead `skew.x === 0` guard; NaN when lerped rotation crosses ±90°;
  breaks under negative scale). Upstream Wicklets = plain per-property lerp. DECIDE before
  building: bug-for-bug replication vs patching the fork to sane semantics. Tween lerps
  x, y, scaleX, scaleY, rotation, skew, OPACITY, + fullRotations (valB += 360*n).
  Opacity ⇒ PlaceObject color_transform (CXFORM alpha multiply) per baked frame, or fades
  export opaque. 27 easing functions in Tween.js must match numerically — generate expected
  values by CALLING THE FORK'S OWN JS (small Node script dumping JSON), don't re-derive.
- **Tween application** (Frame.js applyTweenTransforms ~564): the tween transformation is
  copied ABSOLUTELY (replacement, not composition) onto EVERY clip on the frame; loose paths
  on the same frame are NOT transformed. Emit per-clip identical matrices; static placement
  for loose paths. Fixtures: tweened frame with clip+loose path; with two clips.
- **Matrix mapping is clean**: clip children are re-based to clip-local coords at creation
  (Clip.js addObjects), view pivots group at (0,0) ⇒ PlaceObject.matrix =
  clip.transformation.toMatrix(), same y-down convention, [a,b,c,d,tx,ty] ↔
  [ScaleX, RotateSkew0, RotateSkew1, ScaleY, TranslateX, TranslateY].
- **Layers**: Wick layer index 0 = FRONTMOST (View.Timeline reverses at render). SWF depth:
  higher = frontmost. depth = (layerCount − layerIndex) band + within-frame drawable index.
  Hidden layers DO render in published output (isPublished check) — match or make a flag.
- **Opacity compositing divergence** (accepted, document don't fix): paper.js group opacity
  composites offscreen then blends; SWF cxform multiplies per shape — overlapping children
  inside a translucent clip differ. Exclude such fixtures from strict pixel comparison.

## Test oracle (panel replaced the original differential idea)

Cross-renderer pixel diff (Wick canvas vs Ruffle) is REJECTED — tolerance loose enough for
AA noise is blind to easing errors. Three layers instead:
1. STRUCTURAL (workhorse): parse emitted SWF back with the same swf crate; assert tags,
   depths, per-frame matrices. Expected tween matrices from the fork's own JS via Node dump.
2. Ruffle-only golden PNGs (exporter, lavapipe-blessed, tolerance + max_outliers copied from
   ruffle's tests/framework image_comparison).
3. Wick-vs-Ruffle side-by-side = manual eyeball tool only, never CI.

## Working queue (reranked 2026-07-23)

The phase list below is the record of what each phase *is*. This is the order to actually
work in. The organizing fact: emission is Ruffle-verified for 0/1a/1b/1c, but the parser has
only touched real data for 1a (test1.wick) — 1b/1c parsing has never seen a real multi-frame
or tweened `.wick`. The queue follows the risk, not the phase numbers.

1. **[user-gated] Draw two fixtures** in wickeditor.com/editor: a frame-by-frame animation
   (2–3 keyframes, one layer) and a multi-layer overlap. Unblocks all of Tier 2. Justin draws,
   or automate the draw via the Chrome tool.
2. Run the frame-by-frame fixture through `compile_wick`; confirm/fix parse of `start`/`end`
   spans and place/remove diffing against real editor output. (verifies 1b parser)
3. Confirm multi-layer depth ordering (Wick index 0 = frontmost) against the overlap fixture.
4. **Nested clips / DefineSprite (1d).** Real tweens apply to CLIPS not loose paths, so real
   1c parsing is blocked on clip support — this comes before real tweens.
5. **[user-gated] Motion-tween fixture** → then the **Tween-object parser** (the tween JSON has
   never been seen; can't be written blind).
6. Real easing — dump the 27 fns from the fork's own JS via a Node script. Only after #5.
7. Strokes (LineStyle2). Independent of the timeline work.
8. Planarization via i_overlay (brush donut, figure-eight, self-crossing) — the hard 20%, own
   fixtures needed.
9. **Editor fork** (StickmanRed/wick-editor): pin Node-14, Tauri 2 shell, Export button →
   twip compiler, Ruffle preview tab. Independent of 2–8; the first Export milestone needs only
   static shapes, which already work. Biggest single rock, delivers the "Flash that just works"
   experience — but de-risks nothing about the compiler, so it sits below the cheap parser
   closes. Clean swap upward if Justin wants to start the editor now instead.
10. Frame actions (stop/play/gotoAndPlay DoAction) + PRESS click handlers.
11. Ruffle golden-PNG oracle (lavapipe-blessed).

## Plan

- **Phase 0 — hello-square** — CODE DONE, STRUCTURALLY VERIFIED (2026-07-23). `twip::hello_square_swf()`
  hand-builds a red DefineShape4 square tweening across a 550×400 stage over 24 frames @24fps;
  `cargo run --bin hello_square` writes a valid SWF (`file` → "Macromedia Flash data, version 8").
  Structural oracle green: round-trip test parses the bytes back → 1 DefineShape + 24 ShowFrame
  + 24 PlaceObject. swf crate pinned to rev 645449a builds in ~19s (lightweight, no wgpu).
  VISUAL PLAYBACK VERIFIED in Ruffle (2026-07-23): served the SWF (inline base64) into the
  Ruffle web build via a localhost page in Chrome — solid red square renders on the white
  stage and tweens left→right across frames. Phase 0 COMPLETE. (Chrome blocks file://; use a
  localhost http.server. Ruffle shows a "Click to unmute" autoplay overlay — click to dismiss.)
- **Phase 1 — the compiler payoff**: draw in wickeditor.com/editor/ (live), save .wick,
  `twip in.wick out.swf`, plays in Ruffle. Static shapes, single frame. Headless CLI ON PURPOSE.
  FIRST CUT DONE 2026-07-23: `src/wick.rs` parses the zip→project.json flat UUID graph (Timeline→
  Layer→Frame→Path, layers reversed for depth, Selection skipped), flattens paper.js paths
  (cubic handles sampled to polylines, bare segments as lines), emits one fill-only DefineShape4
  per Path. `twip fixtures/test1.wick out.swf` → 415-byte valid SWF; structural test (2 shapes,
  2 places, 1 ShowFrame) green. DEFERRED (not needed by this fixture): planarization/i_overlay
  (both shapes are simple convex contours), strokes (LineStyle2), the root-Clip transform (assumed
  identity), fill-winding normalization (fill_style_1 verified CORRECT — no inversion).
  VISUALLY VERIFIED in Ruffle 2026-07-23: test1.wick renders as a smooth black ellipse + a
  mint-green rectangle (color [0.302,1,0.651]→RGB 77,255,166 exact), correct positions and
  z-order (green over black per child order). THE PAYOFF MILESTONE IS HIT — a real drawing
  compiled to SWF and played. Phase 1a (static shapes) COMPLETE.
- **Phase 1b — frame-by-frame timeline** — DONE 2026-07-23. parse_wick now preserves layers→
  frames (start/end spans); `compile_document` walks the playhead 1..=total emitting place/
  remove deltas against a depth-keyed display list (depth band per layer, front layer highest).
  Verified: synthetic 2-keyframe unit test (2 defines, 2 places, 1 remove, 2 ShowFrames) + a
  `flipbook_demo` bin rendered in Ruffle — a red square STEPS discretely through 4 positions
  (no interpolation, correct for 1b). test1.wick regression unchanged. NOT YET verified against
  a REAL multi-frame .wick (parse side) — need a frame-by-frame fixture drawn in the editor.
- **Phase 1c — baked tweens (compile side)** — DONE 2026-07-23. `Transform {x,y,scale_x,scale_y,
  rotation_deg,opacity}` with `.matrix()` (a=sx·cos, b=sx·sin, c=-sy·sin, d=sy·cos, tx/ty) and
  `.color_transform()` (a_multiply = opacity); `lerp_transform` = per-property linear (Wick's
  default). `tween_demo_swf` bakes slide+scale+rotate+fade per frame as PlaceObject Modify with
  matrix + CXFORM, ping-ponged for a seamless loop. VERIFIED in Ruffle: smooth continuous
  motion + fade (a square hides rotation via symmetry — use a rectangle to see it; matrix
  rotation is unit-tested). DEFERRED: real Wick easing (27 fns — dump from the fork's JS), and
  the PARSER for real Wick Tween objects (never seen the tween JSON — need a tweened .wick).
  Tweens apply to CLIPS not loose paths, so full parse also needs the clip/DefineSprite work (1d).
- **Phase 2 — THE INTEGRATED EXPERIENCE (first-class, elevated)**: our fork of the Wick editor
  gets an **Export button** (shell-out to the twip CLI) + a **Ruffle preview tab**. Draw →
  click Export → it plays. This is "Flash, but it just works," and the reason the project
  exists for a nostalgic user — no longer an optional afterthought. Pin the fork's Node-14 env
  (`.nvmrc` + a 10-line `BUILD.md`) before any code changes. Static shapes are enough for the
  first Export milestone.
- **Phase 3 — compiler depth (flows into both CLI and editor)**: frame-by-frame timeline →
  baked tweens (matrix + CXFORM alpha, **sane per-property lerp**) → nested clips (DefineSprite,
  recursive) → frame actions (stop/play/gotoAndPlay DoAction) + PRESS click handlers. Buttons
  proper (DefineButton2) = separately-decided, likely never.
- **Phase 4 — polish the fork for the ecosystem**: Tauri desktop shell (native ruffle_core),
  UI polish, position as the SWF-exporting Wick editor for the Ruffle/Royale revival scene.
  Optional: SWF-with-embedded-source round-trip, retiring .wick as a format (keep as importer).
- Gradients: OUT of v1, decided (not "maybe"). Text, audio, filters: OUT of v1. Images
  (Raster/CompoundPath in Path.json) on the OUT list to reconsider.

## Decisions (resolved 2026-07-23)

1. **Tween semantics = sane per-property lerp** (not the fork's buggy matrix-decompose). The
   upstream deployed editor — where fixtures are authored — already uses plain lerp, so "sane"
   matches the fixture source; the JS dump is only needed if we ever want bug-for-bug.
2. **License: compiler crate `twip` = MIT** (ships zero Wick code); **editor fork = GPLv3**
   (contains Wick code — fine, Justin's ok with it). Separate repos, so no conflict.
3. **Ruffle rev pinned = `645449a5c602044471f045546a0a31af0df9cd69`** (ruffle-rs/ruffle master,
   2026-07-23). swf crate = git dep on this rev; build the exporter + preview player from the
   SAME rev; bump together.
4. **Editor = our polished fork of StickmanRed/wick-editor**, first-class goal (not fresh, not
   maybe-never). Two repos — the Rust compiler is NEVER planted inside the CRA.

5. **Editor platform = Tauri 2** (GA Oct 2024), desktop-first. The twip compiler is an
   IN-PROCESS Rust call from the Export button (Tauri command → `twip::compile()` → SWF
   bytes) — no subprocess, and crucially NO webpack-4 WASM landmine. This IS the handoff's
   "compiler as a direct function call, no seam." Ruffle preview: self-hosted Ruffle web build
   in the webview (`load({data: bytes})`, no COOP/COEP) first; native ruffle_core linking is a
   later single-binary optimization. Web/PWA is a stretch follow-on only.
6. **Toolchain: live with Node 14, quarantined.** Resolved by #5 — build the frozen React CRA
   ONCE on Node 14, Tauri bundles the static output; the compiler/integration/packaging are all
   modern Rust. Never modernize the CRA (that migration killed upstream).

## Still open (deferred, non-blocking)

- Ruffle preview: self-hosted web build (day one) vs native ruffle_core link (later) — start
  with the web build, revisit for the single-binary goal.
- Agent-memory routing (winze vs native MEMORY.md) — infra, not product; native for now.

## Known gaps — do these FIRST

1. **DONE — a real .wick inspected (`test1.wick`, 2026-07-23).** Confirmed: zip = `assets/` +
   `project.json`. `project.json` = `{project, objects}` where **`objects` is a FLAT MAP keyed
   by UUID** (classname ∈ Project/Clip/Timeline/Layer/Frame/Path/Selection) and every parent
   lists `children` as UUID references — NOT a nested tree. Parse = build the UUID map, resolve
   from `project.children` down: Project → [Selection, root Clip] → Timeline → Layer → Frame →
   [Path…]. **`Selection` = editor UI state (pivot/widgetRotation) — compiler MUST skip it.**
   Paths confirmed raw paper.js exportJSON; full segments `[[anchor],[hIn],[hOut]]` (relative
   handles) and handle-less segments as bare `[x,y]` BOTH present (ellipse vs rectangle);
   colors float arrays; transform = {x,y,scaleX,scaleY,rotation,opacity}; Frame has start/end;
   scripts = {name,src}. Deployed editor = wickengine **2021.1.22** (old; NOT the 2026 fork —
   fork files may add tween fields on top). Fixture is single-frame, 2 static shapes, 720×480
   @12fps — a ready Phase-1 fixture. Full dump preserved in scratchpad project.json.
2. **Zero fixtures exist.** Need a small corpus saved from the deployed editor: single
   shape; brush donut; self-crossing path; multi-layer overlap; motion tween; rotation-
   through-90° tween; flip (negative scale) tween; fade tween; nested clip; clip+loose-path
   tweened frame. (Justin draws these, or automate via browser tooling.)
3. **Nothing has been executed.** Every claim above is repo-reading, not running code.
   Phase 0 is the first execution of anything.
4. Reference clone DONE: `reference/wick-editor` (StickmanRed, depth-1, HEAD b05793b,
   2026-06-26; gitignored — has its own .git). Read-only.
5. Repos not yet created: `gh repo create twip --private` (Rust compiler crate + CLI, main
   branch, Cargo workspace) AND a fork of StickmanRed/wick-editor for the editor product. The
   local `~/Documents/twip` dir is git-inited (HANDOFF committed); no GitHub remote yet.

## Session lineage

Designed in Claude Code session f66726fa (2026-07), which also verified all repo facts and
ran the panel (5 agents, ~364k tokens). Claude memory: project_flash_editor.md in the
gas6amus Documents memory dir mirrors the durable facts.
