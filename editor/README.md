# twip editor

The drawing and animation front end for [twip](../README.md) — draw vector shapes on a
timeline, tween them, press **SWF**, and the twip compiler turns the document into a real
`.swf` that Ruffle plays.

## Credit where it belongs

**This is a fork of the [Wick Editor](https://github.com/Wicklets/wick-editor) by Wicklets
LLC**, and almost all of what makes it a usable drawing tool is theirs. The engine under
`engine/` is ~87k lines of their JavaScript — the document model, the brush, the tween
engine, the paper.js integration, the timeline GUI — plus another ~46k of libraries they
vendored. The React chrome here is ~17k lines, and it was theirs before it was modified.

Wick Editor is licensed under the GNU General Public License v3, so this fork is too. See
[`LICENSE.md`](LICENSE.md), the per-file `Copyright 2020 WICKLETS LLC` headers, and
[`CREDITS.md`](CREDITS.md), which names the people who built it.

Two upstreams, both still worth visiting:

- [Wicklets/wick-editor](https://github.com/Wicklets/wick-editor) — the original, last
  pushed March 2023.
- [StickmanRed/wick-editor](https://github.com/StickmanRed/wick-editor) — the fork this one
  was taken from, which carried it further.

Nothing here is endorsed by or affiliated with either. Bugs in this fork belong in
[twip's issues](https://github.com/justinstimatze/twip/issues), not theirs.

## What this fork changes

- A **SWF** button that compiles the document through the twip Rust crate and plays the
  result in an embedded Ruffle, plus an export that writes the `.swf` to disk. No other
  Wick fork exports playable SWF; it is the reason this one exists.
- Build system moved from Create React App / webpack 4 / Node 14 to Vite 6 + pnpm, so it
  builds on current Node.
- React 19, with the UI moving panel by panel onto Tailwind v4 tokens and Radix primitives.
  Two panels of twelve are across; the rest still run on the original SCSS.
- A desktop shell (Tauri 2) that links the compiler in-process rather than shelling out.

## Building

See [`BUILD.md`](BUILD.md) for prerequisites, the install and run commands, how to stage the
Ruffle runtime, how SWF export works in dev, and the five checks.
