# twip UI redesign — competitive survey of post-Flash vector/timeline tools

*Survey compiled 2026-07-24. Breadth-first web research plus direct inspection of the
local Wick fork. Factual UI claims are cited; inferences are flagged **[inferred]**.
Caveat on method: search-summary tools paraphrase, so treat quoted-looking UI phrasing
as reported, not verbatim from the vendor.*

The bottom line up front: **the nostalgia lives in the layout; the friction lives in the
mechanics.** Flash veterans miss the spatial arrangement (bottom timeline, left tools,
layer/frame grid, symbols, onion skin), not the interactions — nobody is nostalgic for
modal dialogs or "insert keyframe, then edit." So keep the Flash silhouette and modernize
every interaction inside it. The two goals barely conflict.

---

## Part 1 — priority tools (closest analogs)

### Adobe Animate — the literal Flash successor
Still a docked, panel-dense desktop IDE, incrementally modernized.

- **Layout:** stage center, Tools panel left, Timeline bottom, Properties/Inspector right.
  Dockable/floatable panels, saveable workspaces, selectable Dark/Light theme.
  ([workspace](https://helpx.adobe.com/animate/using/workflow-workspace.html),
  [preferences](https://helpx.adobe.com/animate/using/set-preferences.html))
- **Timeline/tweening:** reworked for clearer frame intervals; dedicated keyframe/blank-keyframe
  buttons; a Layer view toggle and a separate Layer Depth panel. Tweening is still the Flash
  model — motion/classic/shape tweens via frame-span context menu, motion path on stage.
  ([timeline](https://helpx.adobe.com/animate/using/timeline.html))
- **Onion skinning:** one-button toggle, plus right-click any onion frame to include/exclude it.
- **What modernized vs Flash CS:** Property Inspector rebuilt (2020) into Tools/Object/Frame/Doc
  tabs with a Quick-action section; Frame Picker gained List/Thumbnail views + auto-keyframe
  checkbox; UI elements physically larger, with a timeline Short/Compact density menu to claw
  space back. ([panels](https://helpx.adobe.com/animate/using/authoring-panels.html),
  [symbol instances](https://helpx.adobe.com/animate/using/symbol-instances.html))
- **Accessibility:** best-in-class authoring *keyboard shortcuts* (navigate panels, inspector,
  stage, objects; F4 hides panels), but **screen-reader access to canvas content is essentially
  absent** — the canvas is opaque to SRs.
  ([a11y workspace](https://helpx.adobe.com/animate/using/accessibility-workspace.html),
  [SR thread](https://community.adobe.com/t5/animate-discussions/screen-reader-accessibility-in-adobe-animate-html5-canvas/td-p/15072097))

### Rive — the modern reference, the tool to steal the most from
- **Layout:** center Stage; three left panels (Hierarchy, Assets, Data) reworked into stackable,
  rearrangeable panels; Inspector right; top toolbar in three blocks (transform tools, layouts,
  vector tools). Dark theme **[inferred from screenshots]**.
  ([interface](https://rive.app/docs/editor/fundamentals/interface-overview))
- **The mode split (key idea):** Design Mode edits set the global default state (no keyframes);
  Animate Mode surfaces the timeline and **auto-generates a keyframe at the playhead** for any
  canvas/inspector change. This removes Flash's biggest keyframing friction.
  ([keyframes](https://github.com/rive-app/help-center/blob/master/editor/animate-mode/keyframes.md))
- **Easing:** per-property tracks + a Graph Editor with draggable Bézier handles (Cubic Value),
  plus 2024 Auto Bezier auto-smoothing.
  ([easing](https://help.rive.app/editor/animate-mode/interpolation-easing),
  [Auto Bezier](https://alternativeto.net/news/2024/12/rive-introduces-auto-bezier-feature-for-the-graph-editor))
- **State machines:** selecting one replaces the timeline with a visual graph (States,
  Transitions, Layers) — the replacement for Flash's ActionScript-on-frames. Directly relevant
  to twip's interactivity story. ([state machines](https://help.rive.app/runtimes/state-machines))
- **Accessibility:** no published a11y story; presumed mouse-driven **[inferred]**. Copy Rive for
  interaction design, Figma for a11y.

### Tumult Hype — Mac timeline animator ("Flash for HTML5")
Left Scenes sidebar, center stage, right tabbed Inspector, bottom timeline + keyframe tools —
close to the Flash/Wick skeleton. Classic two-keyframe model with auto in-betweens, organized as
Scenes → Timelines. Modern touch: a **Record** mode that auto-creates keyframes as you manipulate
the stage — the same auto-key idea as Rive, behind an explicit toggle.
([animations](https://tumult.com/hype/documentation/v1/animations/),
[timelines](https://tumult.com/hype/documentation/v2/timelines/))

### Google Web Designer — free ad-focused tool with a two-mode timeline
The cleanest existing answer to "one UI, two audiences":
- **Quick mode** — scene-by-scene, timeline shows a row of scene thumbnails. Newcomer-oriented.
  ([quick mode](https://support.google.com/webdesigner/answer/3227054?hl=en))
- **Advanced mode** — each element is a timeline layer; place keyframes, the gap is a "span."
  Per-layer hide/lock, snap-to-grid, Shift-drag to proportionally retime a keyframe group.
  ([advanced mode](https://support.google.com/webdesigner/answer/7529849?hl=en))

### Wick Editor — the fork twip is built on (inspected locally)
A near-literal Flash clone in layout: canvas center, timeline bottom, tools left, context-sensitive
option buttons on the right. Actual panel structure (`src/Editor/Panels/`): Toolbox, Canvas,
Timeline, Inspector, Outliner, AssetLibrary, MenuBar, CanvasTransforms, DockedPanel, and a
**MobileContainer** (MobileInspector + MobileAssetLibrary). Panels use `react-reflex` (resizable
docked split panes) and `react-rnd` (draggable/floating/mobile). So twip already has a docked
desktop layout *and* a mobile-degradation seed, on aging React.
- **Tweening model:** convert a drawing to a symbol, place instances on keyframes, Wick tweens
  between them. The conversion runs through a `MakeAnimated` **modal**.
- **Dated conventions carried in the fork** (`src/Editor/Modals/`): a large stack of modal dialogs
  (MakeAnimated, MakeInteractive, ExportMedia, SettingsModal, BuiltinLibrary…). Modal-heavy flow is
  the most obviously legacy part. No ARIA layer observed **[inferred]**.

---

## Part 2 — secondary tools (contrast)

- **Toon Boom Harmony** — pro end. Everything is a dockable/floatable "view"; Timeline reads
  horizontally, the Xsheet view reads vertically as an exposure sheet; a Node view wires effects.
  Two orthogonal time representations is the notable idea — but the density is anti-newcomer, a
  cautionary tale. ([interface](http://docs.toonboom.com/help/harmony-24/essentials/getting-started/interface.html))
- **Construct 3** — browser-based full authoring tool. Game logic lives in an Event Sheet (visual
  programming, not code); a Timeline tweens instance properties. Proof a full editor runs
  comfortably in-browser, and a code-optional interactivity model.
  ([event sheet](https://www.construct.net/en/make-games/manuals/construct-3/interface/event-sheet-view))
- **Jitter** — browser motion design, the newcomer-friendliness benchmark. AE-like timeline but
  replaces raw keyframes with an event/action model ("tell layers what to do"). The lesson: a
  beginner ramp can sit on top of a timeline by abstracting keyframes into named actions.
  ([interface tour](https://help.jitter.video/en/articles/12597029-a-quick-tour-of-the-interface))
- **Figma Smart Animate / Framer** — the timeline-less paradigm: build two frames, match layers by
  name+hierarchy, auto-tween the diff. Great for UI state transitions, poor fit for frame-by-frame
  character animation (twip's heartland). Know it as a paradigm, don't adopt wholesale.
  ([smart animate](https://help.figma.com/hc/en-us/articles/360039818874-Smart-animate-layers-between-frames))
- **Figma (accessibility exemplar)** — the one canvas tool that solved a11y and the model to copy:
  a **Mirror DOM** kept in sync with the canvas so SRs can enumerate objects; a keyboard
  box-selection tool (arrow keys move a cursor, Enter selects); a contrast checker in the color
  picker; changes announced to SRs. Known limit: some multi-click vector ops stay mouse-only.
  ([canvas a11y](https://www.figma.com/blog/building-accessibility-into-a-canvas-based-product/),
  [keyboard a11y](https://www.figma.com/blog/introducing-keyboard-accessibility-features/))

---

## Part 3 — synthesis and recommendations for twip

The tension, verbatim from the user: *"how to walk the line between 'familiar/retro enough for
people that used to use Flash that would find this nostalgic like me' and 'entirely new users that
have no patience for outdated interface conventions'."*

### Keep (retro *and* still ergonomic)
Bottom full-width timeline; left tool palette; layer-rows / frame-columns grid; centered stage with
Library + right-side Properties; onion skinning as a first-class timeline toggle (add Animate's
per-frame include/exclude); the symbol/Library concept (modernize the panel to a searchable
thumbnail grid).

### Drop or modernize (the "outdated" tells)
1. **Modal dialogs** (the fork's MakeAnimated/MakeInteractive/export/settings) → non-modal inline
   panels / contextual toolbars. The #1 legacy signal.
2. **Convert-to-symbol-then-tween** → auto-keyframing (Rive default, Hype Record): move an object on
   canvas with the timeline in animate state, get a keyframe at the playhead. Highest-leverage change.
3. **Flat property inspector** → tabbed, context-aware (Animate's Tools/Object/Frame/Doc).
4. **Cryptic right-side icon strip** → a contextual toolbar that reflows to the active tool, with labels.
5. **Easing dropdown** → a graph/curve editor with draggable Bézier + an auto-smooth option.
6. **Library-as-list** → thumbnail grid with search.

### Modern patterns a 2026 newcomer expects
Design/Animate mode split; auto-keyframing at the playhead; direct manipulation on canvas sets keys;
graph easing editor; a newcomer ramp layered *over* the timeline (see below); a state-machine or
event-sheet code-optional interactivity path; stackable panels with saved workspaces; multiplayer
cursors (stretch).

### Where nostalgia and usability actually conflict — and the default

| Conflict | Nostalgic pull | Newcomer pull | Default |
|---|---|---|---|
| Keyframing gesture | F6 then edit | Auto-key on drag | Auto-key by default; keep F6/F7 working (invisible nostalgia) |
| Tweening | Convert-to-symbol | Property tracks | Property tracks + auto-key; keep symbol tweening available |
| Density | Tight Flash panels | Breathing room | Modern layout + a Compact density toggle (Animate's Short/Compact) |
| Visual skin | Flash gray-blue chrome | Clean neutral dark | Modern layout, subtle retro styling |

**Recommended stance: a modern layout and modern mechanics wearing a subtly retro skin — NOT a
modern app with a bolt-on "classic mode," and NOT a faithful Flash clone.** The nostalgia lands
through layout + shortcuts + naming, which costs nothing ergonomically.

- **Do not ship a full "classic skin" toggle** as the primary strategy — it doubles UI maintenance
  (and invites hand-CSS drift) for little gain, since the retro appeal is layout-borne, not
  chrome-borne. Keep the nostalgia knob small: a density toggle + optional theme accent.
- **Borrow GWD's two-mode split for the *audience* gap, not the aesthetic gap:** a Simple/Quick mode
  (scene-thumbnail timeline, actions instead of raw keyframes — Jitter-style) as the newcomer ramp,
  and an Advanced mode (per-property tracks + graph editor) for depth. The friction newcomers reject
  is *conceptual* (symbols, keyframe mechanics), not *visual*.

### Accessibility (first-class) — concrete WCAG targets
Creative/timeline tools are almost uniformly inaccessible; **Figma is the sole exemplar**. Doing a11y
even moderately well is a genuine differentiator.
- **Keyboard-only canvas + timeline:** copy Figma's keyboard box-selection (arrow-key focus cursor
  over objects, Enter selects; Tab cycles z-order). Make the timeline a real `role="grid"` (arrows
  move the playhead/selected cell, Enter/F6 inserts). Flash's F5/F6/F7 + frame-stepping shortcuts
  are already keyboard-first — expose them as the accessible path, not just power-user sugar.
- **Screen readers on an opaque canvas:** a Mirror-DOM accessibility tree mirroring the layer
  hierarchy (each layer/symbol/keyframe = a focusable, labeled node), synced to the scene graph.
- **Live regions:** `aria-live="polite"` for playhead position, selection, tween creation, mode and
  tool changes. Keep announcements terse.
- **Focus management:** each panel a labeled landmark; a shortcut to cycle panels (Animate's F4 is a
  precedent); trap focus in transient popovers and restore on close.
- **Contrast (dark chrome):** WCAG 2.2 AA — 4.5:1 text, **3:1 for non-text UI components** (selected
  frame, keyframe dots, playhead, active layer). Dark editor UIs routinely fail the 3:1 rule on
  gray-on-gray affordances. Don't encode state by color alone.
- **`prefers-reduced-motion`** on the editor *chrome* (panel/tab/hover animation), distinct from the
  user's content, which is legitimately animated.
- **Hit targets:** 24×24px min (WCAG 2.5.8), 44×44px on primary controls. Timeline frame cells are
  the pinch point — give the timeline a density/zoom control so cells can reach an accessible size
  (also serves the Compact/Comfortable nostalgia knob — one control, two wins).

### Responsive / small-viewport strategy
Laptop-first (1280–1440 should feel uncramped); full phone *authoring* out of scope; must not
shatter on small screens.
1. Primary breakpoint 1280–1440, panels docked via resizable split-panes (`react-reflex`), sensible
   per-panel min-widths so the stage never collapses.
2. Hard minimum authoring width ~1024px; below it, switch layout, don't shrink.
3. Below ~768px, degrade to a **view-only / playback mode** (stage + play controls, no editing
   chrome) behind a "twip works best on a larger screen" interstitial — people view animations on
   phones even if they don't make them there. This is the single most valuable small-screen mode.
4. Never allow horizontal page scroll; each region (timeline, library, inspector) owns its own
   overflow; the shell is a fixed viewport grid.
5. On mid-widths (~1024), collapse Library/Inspector into slide-over drawers (the react-rnd /
   MobileContainer pattern) before hiding functionality.

---

## Sources
Adobe Animate: [workspace](https://helpx.adobe.com/animate/using/workflow-workspace.html) ·
[timeline](https://helpx.adobe.com/animate/using/timeline.html) ·
[panels](https://helpx.adobe.com/animate/using/authoring-panels.html) ·
[symbol instances](https://helpx.adobe.com/animate/using/symbol-instances.html) ·
[a11y](https://helpx.adobe.com/animate/using/accessibility-workspace.html).
Rive: [interface](https://rive.app/docs/editor/fundamentals/interface-overview) ·
[easing](https://help.rive.app/editor/animate-mode/interpolation-easing) ·
[state machines](https://help.rive.app/runtimes/state-machines).
Hype: [animations](https://tumult.com/hype/documentation/v1/animations/) ·
[timelines](https://tumult.com/hype/documentation/v2/timelines/).
Google Web Designer: [advanced](https://support.google.com/webdesigner/answer/7529849?hl=en) ·
[quick](https://support.google.com/webdesigner/answer/3227054?hl=en).
Toon Boom Harmony: [interface](http://docs.toonboom.com/help/harmony-24/essentials/getting-started/interface.html).
Construct 3: [event sheet](https://www.construct.net/en/make-games/manuals/construct-3/interface/event-sheet-view).
Jitter: [interface tour](https://help.jitter.video/en/articles/12597029-a-quick-tour-of-the-interface).
Figma: [smart animate](https://help.figma.com/hc/en-us/articles/360039818874-Smart-animate-layers-between-frames) ·
[canvas a11y](https://www.figma.com/blog/building-accessibility-into-a-canvas-based-product/) ·
[keyboard a11y](https://www.figma.com/blog/introducing-keyboard-accessibility-features/).
Wick Editor: local clone `reference/wick-editor/src/Editor/`.
