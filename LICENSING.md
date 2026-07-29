# Licensing

This repository holds two things under two licenses. `LICENSE` at the root is MIT and is
what GitHub reports, which is accurate for the project's own code and not for all of the
tree — hence this file.

## What is covered by what

**Everything outside `editor/`** — the compiler crate, the CLI, `src/`, `tests/`,
`fixtures/`, `scripts/` — is **MIT**, © 2026 Justin Stimatze. See [`LICENSE`](LICENSE). It
contains no Wick Editor code and can be taken and used under MIT on its own.

**`editor/`** is a fork of the [Wick Editor](https://github.com/Wicklets/wick-editor),
© 2020 Wicklets LLC, and is **GPLv3**. See [`editor/LICENSE.md`](editor/LICENSE.md), the
per-file copyright headers, and [`editor/CREDITS.md`](editor/CREDITS.md). It stays GPLv3;
nothing here relicenses it.

MIT is GPL-compatible, so the two coexist without conflict.

## The desktop build

`editor/src-tauri` links the MIT compiler into the same executable that serves the GPLv3
editor. That binary — and the `.deb` built from it — is a combined work and is conveyed
under **GPLv3**.

GPLv3 §6 requires that object code be accompanied by the corresponding source, or by a
written offer for it. For this project the corresponding source is this repository.

**So the packaged build must not be handed to anyone while this repository is private.**
Publishing the repository first, and pointing releases at it, satisfies §6. Distributing a
`.deb` before then would put GPLv3 code in someone's hands with no way to get the source.

## Source-tree distribution

Copying the repository as source is a different case from shipping the combined binary.
GPLv3's aggregate clause (`editor/LICENSE.md`, "A compilation of a covered work with other
separate and independent works…") says that bundling a covered work with separate works
that are not combined into a larger program does not extend the license to the other parts.
A tree holding an MIT crate beside a GPLv3 application fits that description; the binary
that links them does not.

## Not legal advice

I am not a lawyer and this file is a description of intent, not an opinion. If you plan to
redistribute any of this, read [`LICENSE`](LICENSE) and [`editor/LICENSE.md`](editor/LICENSE.md)
rather than this summary.
