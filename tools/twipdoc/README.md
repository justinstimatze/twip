# twipdoc

Reads and edits `.wick` documents without a browser, as a CLI and as an MCP server.

A `.wick` is a zip around a `project.json`, and that JSON holds nearly everything: layers,
frames and their spans, clips and their nesting, tween keyframes with easing curves, scripts,
asset references, stage size, framerate, background. Changing any of it is data manipulation.
Nothing here needs a rendering engine, and nothing here can draw — see
[`docs/agent-interface.md`](../../docs/agent-interface.md) for why the line falls there.

## Building

```
go build -o twipdoc .
```

`twipdoc compile` shells out to the twip compiler. It finds it in the surrounding checkout
(`target/release/twip`) before it looks on `PATH`, because the desktop app installs as
`/usr/bin/twip` too — see `editor/BUILD.md`. `TWIP_BIN` overrides both.

## The CLI

```
twipdoc read <file.wick> [--depth N]
twipdoc frames <file.wick> --layer N
twipdoc script get <file.wick> --uuid U [--event default]
twipdoc script set <file.wick> --uuid U [--event default] (--src TEXT | --src-file F) <write>
twipdoc tween get <file.wick> --uuid FRAME
twipdoc tween set <file.wick> --uuid TWEEN [--playhead N] [--easing E]
                              [--bezier x1,y1,x2,y2] [--rotations N] <write>
twipdoc layer add <file.wick> [--name N] [--index I] <write>
twipdoc layer reorder <file.wick> --from I --to J <write>
twipdoc compile <file.wick> [out.swf]
twipdoc serve [--root DIR]
```

Everything prints JSON on stdout. `<write>` is `-o OUT` or `--in-place`, and an edit given
neither is refused rather than guessed at: defaulting to in-place would destroy an input on a
mistyped UUID, and defaulting to a temp path would leave the caller hunting for its own edit.

Objects are addressed by UUID, which is what the format itself uses. `twipdoc read` puts one on
every layer, frame, tween and clip, so an agent that has read the document can already name
anything in it — including inside nested clips, which an invented `layer.frame.clip` path
scheme would have needed a grammar for.

```
$ twipdoc layer add demo.wick --name Sky --index 0 --in-place
$ twipdoc script set demo.wick --uuid 22049f6a-… --src 'stop();' --in-place
$ twipdoc compile demo.wick
{"input":"demo.wick","output":"demo.swf","bytes":559,"binary":"…/target/release/twip"}
```

## The MCP server

`twipdoc serve --root DIR` speaks MCP over stdio and will not touch a file outside `DIR`.

Stdio rather than HTTP because this edits files on the caller's disk: the useful boundary is
which directory, not who is asking, and a network transport would add a second question to a
tool whose answer to the first is "the files you already have". It runs beside its client, the
way a language server does.

Five tools — `twip_read`, `twip_script`, `twip_tween`, `twip_layer`, `twip_compile` — grouped by
what they touch rather than one per verb.

Register it with Claude Code:

```
claude mcp add twipdoc -- /path/to/twipdoc serve --root /path/to/your/projects
```

## What the tests are for

`go test ./...` is fast, but one case in it is doing real work. `TestARoundTrippedDocument
CompilesToTheSameMovie` opens every fixture, saves it with no edit, and compiles both the
original and the copy — asserting the two SWFs are byte-identical.

That is the only check here that Go cannot satisfy by agreeing with itself. This tool keeps
every object as `map[string]any` precisely so that fields it has never heard of survive a save;
the compiler is an independent reader of the same format, so anything dropped on the way through
comes back as a movie that differs. Go comparing its own output to its own output would pass
just as happily with a typed model that quietly discarded half the document.
