package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strconv"
	"strings"
)

// Version is what `twipdoc --version` reports and what the MCP server announces.
const Version = "0.1.0"

const usage = `twipdoc ` + Version + ` — read and edit .wick documents without a browser

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

  <write> is -o OUT or --in-place; an edit will not guess which one you meant.

UUIDs come from ` + "`twipdoc read`" + `, which puts one on every addressable object.
Output is JSON on stdout; errors go to stderr and set a non-zero exit.
`

func main() {
	if len(os.Args) < 2 {
		fmt.Fprint(os.Stderr, usage)
		os.Exit(2)
	}
	if os.Args[1] == "--version" || os.Args[1] == "-v" {
		fmt.Println(Version)
		return
	}
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintf(os.Stderr, "twipdoc: %v\n", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	verb := args[0]
	rest := args[1:]
	switch verb {
	case "read":
		return cmdRead(rest)
	case "frames":
		return cmdFrames(rest)
	case "script":
		return cmdScript(rest)
	case "tween":
		return cmdTween(rest)
	case "layer":
		return cmdLayer(rest)
	case "compile":
		return cmdCompile(rest)
	case "serve":
		return cmdServe(rest)
	case "help", "-h", "--help":
		fmt.Print(usage)
		return nil
	default:
		return fmt.Errorf("unknown verb %q — run `twipdoc help`", verb)
	}
}

// writeTarget collects the -o / --in-place pair that every mutating verb shares.
type writeTarget struct {
	out     string
	inPlace bool
}

func (w *writeTarget) bind(fs *flag.FlagSet) {
	fs.StringVar(&w.out, "o", "", "write the edited document here")
	fs.BoolVar(&w.inPlace, "in-place", false, "overwrite the input file")
}

// resolve names the file to write, refusing to pick one on the caller's behalf. An edit that
// defaulted to in-place would destroy an input on a typo'd UUID; one that defaulted to a temp
// path would leave the agent hunting for where its edit went.
func (w *writeTarget) resolve(input string) (string, error) {
	switch {
	case w.out != "" && w.inPlace:
		return "", fmt.Errorf("-o and --in-place both given; pick one")
	case w.out != "":
		return w.out, nil
	case w.inPlace:
		return input, nil
	default:
		return "", fmt.Errorf("this edit writes a document: pass -o OUT or --in-place")
	}
}

func emit(v any) error {
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	return enc.Encode(v)
}

// parse reads a flag set from args given in any order.
//
// The stdlib parser stops at the first argument that is not a flag, so `layer add f.wick
// --in-place` parses zero flags — and the failure is silent, because a flag that was never seen
// is indistinguishable from one that was never passed. That surfaced here as an edit refusing
// to write when --in-place was right there on the command line. Moving positionals to the back
// first means the obvious word order works.
func parse(fs *flag.FlagSet, args []string) error {
	var flags, positional []string
	for i := 0; i < len(args); i++ {
		a := args[i]
		if a == "--" {
			positional = append(positional, args[i+1:]...)
			break
		}
		if len(a) < 2 || a[0] != '-' {
			positional = append(positional, a)
			continue
		}
		flags = append(flags, a)
		name, _, hasValue := strings.Cut(strings.TrimLeft(a, "-"), "=")
		if hasValue {
			continue
		}
		// A boolean flag stands alone; anything else takes the next argument as its value, and
		// that value must not be mistaken for a positional.
		f := fs.Lookup(name)
		if f == nil {
			continue // Unknown: leave it for Parse to complain about, in its own words.
		}
		if b, isBool := f.Value.(interface{ IsBoolFlag() bool }); isBool && b.IsBoolFlag() {
			continue
		}
		if i+1 < len(args) {
			i++
			flags = append(flags, args[i])
		}
	}
	// The separator is not optional: a filename that starts with a dash would otherwise be
	// read as a flag once it has been moved behind the real ones.
	return fs.Parse(append(append(flags, "--"), positional...))
}

// openArg parses a flag set that expects the .wick path as its one positional argument.
func openArg(fs *flag.FlagSet, args []string) (*Doc, error) {
	if err := parse(fs, args); err != nil {
		return nil, err
	}
	if fs.NArg() < 1 {
		return nil, fmt.Errorf("which .wick file?")
	}
	return Open(fs.Arg(0))
}

func cmdRead(args []string) error {
	fs := flag.NewFlagSet("read", flag.ContinueOnError)
	depth := fs.Int("depth", 1, "how many levels of nested clip to open")
	d, err := openArg(fs, args)
	if err != nil {
		return err
	}
	s, err := d.Read(*depth)
	if err != nil {
		return err
	}
	return emit(s)
}

func cmdFrames(args []string) error {
	fs := flag.NewFlagSet("frames", flag.ContinueOnError)
	layer := fs.Int("layer", 0, "layer index on the root timeline (0 is frontmost)")
	depth := fs.Int("depth", 1, "how many levels of nested clip to open")
	d, err := openArg(fs, args)
	if err != nil {
		return err
	}
	l, err := d.LayerAt(*layer)
	if err != nil {
		return err
	}
	li := LayerInfo{
		Index: *layer, UUID: uuidOf(l), Name: strField(l, "name"),
		Locked: boolField(l, "locked"), Hidden: boolField(l, "hidden"), Frames: []FrameInfo{},
	}
	for _, f := range d.framesOf(l) {
		li.Frames = append(li.Frames, d.readFrame(f, *depth))
	}
	return emit(li)
}

func cmdScript(args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("script get or script set?")
	}
	action, rest := args[0], args[1:]
	fs := flag.NewFlagSet("script "+action, flag.ContinueOnError)
	uuid := fs.String("uuid", "", "the Frame or Clip carrying the script")
	event := fs.String("event", "default", "script name (default, load, mousepressed, …)")
	src := fs.String("src", "", "the script source (set)")
	srcFile := fs.String("src-file", "", "read the script source from this file (set)")
	layer := fs.Int("layer", -1, "address by root-timeline layer index instead of uuid")
	playhead := fs.Int("frame", -1, "address by playhead position instead of uuid")
	var w writeTarget
	if action == "set" {
		w.bind(fs)
	}
	d, err := openArg(fs, rest)
	if err != nil {
		return err
	}

	target := *uuid
	if target == "" {
		if *layer < 0 || *playhead < 0 {
			return fmt.Errorf("give --uuid, or --layer and --frame together")
		}
		f, err := d.FrameAtPlayhead(*layer, *playhead)
		if err != nil {
			return err
		}
		target = uuidOf(f)
	}

	switch action {
	case "get":
		text, err := d.GetScript(target, *event)
		if err != nil {
			return err
		}
		return emit(map[string]any{"uuid": target, "event": *event, "src": text})
	case "set":
		text := *src
		if *srcFile != "" {
			if *src != "" {
				return fmt.Errorf("--src and --src-file both given; pick one")
			}
			b, err := os.ReadFile(*srcFile)
			if err != nil {
				return err
			}
			text = string(b)
		}
		out, err := w.resolve(d.path)
		if err != nil {
			return err
		}
		if err := d.SetScript(target, *event, text); err != nil {
			return err
		}
		if err := d.Save(out); err != nil {
			return err
		}
		return emit(map[string]any{"uuid": target, "event": *event, "wrote": out})
	default:
		return fmt.Errorf("script get or script set, not %q", action)
	}
}

func cmdTween(args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("tween get or tween set?")
	}
	action, rest := args[0], args[1:]
	fs := flag.NewFlagSet("tween "+action, flag.ContinueOnError)
	uuid := fs.String("uuid", "", "the Frame (get) or Tween (set)")
	playhead := fs.Int("playhead", -1, "move the tween to this position within its frame")
	easing := fs.String("easing", "", "easing curve name")
	bezier := fs.String("bezier", "", "custom curve control points, x1,y1,x2,y2")
	rotations := fs.Int("rotations", 0, "extra whole turns while interpolating")
	var w writeTarget
	if action == "set" {
		w.bind(fs)
	}
	d, err := openArg(fs, rest)
	if err != nil {
		return err
	}
	if *uuid == "" {
		return fmt.Errorf("--uuid is required")
	}

	switch action {
	case "get":
		ts, err := d.Tweens(*uuid)
		if err != nil {
			return err
		}
		return emit(map[string]any{"frame": *uuid, "tweens": ts})
	case "set":
		var e TweenEdit
		// Only flags the caller actually passed become edits; Visit reports exactly those, so
		// an unmentioned field keeps whatever the document already said.
		fs.Visit(func(f *flag.Flag) {
			switch f.Name {
			case "playhead":
				e.Playhead = playhead
			case "easing":
				e.Easing = easing
			case "rotations":
				e.FullRotations = rotations
			case "bezier":
				parsed, perr := parseBezier(*bezier)
				if perr != nil {
					err = perr
					return
				}
				e.Bezier = parsed
			}
		})
		if err != nil {
			return err
		}
		out, werr := w.resolve(d.path)
		if werr != nil {
			return werr
		}
		if err := d.SetTween(*uuid, e); err != nil {
			return err
		}
		if err := d.Save(out); err != nil {
			return err
		}
		return emit(map[string]any{"uuid": *uuid, "wrote": out})
	default:
		return fmt.Errorf("tween get or tween set, not %q", action)
	}
}

func parseBezier(s string) ([]float64, error) {
	parts := strings.Split(s, ",")
	if len(parts) != 4 {
		return nil, fmt.Errorf("a bezier is x1,y1,x2,y2 — four values, got %d", len(parts))
	}
	out := make([]float64, 4)
	for i, p := range parts {
		f, err := strconv.ParseFloat(strings.TrimSpace(p), 64)
		if err != nil {
			return nil, fmt.Errorf("bezier value %q: %w", p, err)
		}
		out[i] = f
	}
	return out, nil
}

func cmdLayer(args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("layer add or layer reorder?")
	}
	action, rest := args[0], args[1:]
	fs := flag.NewFlagSet("layer "+action, flag.ContinueOnError)
	name := fs.String("name", "", "layer name (add)")
	index := fs.Int("index", -1, "insert position, default appends (add)")
	from := fs.Int("from", -1, "layer to move (reorder)")
	to := fs.Int("to", -1, "where it lands (reorder)")
	var w writeTarget
	w.bind(fs)
	d, err := openArg(fs, rest)
	if err != nil {
		return err
	}
	out, err := w.resolve(d.path)
	if err != nil {
		return err
	}

	switch action {
	case "add":
		uuid, err := d.AddLayer(*name, *index)
		if err != nil {
			return err
		}
		if err := d.Save(out); err != nil {
			return err
		}
		return emit(map[string]any{"uuid": uuid, "wrote": out})
	case "reorder":
		if *from < 0 || *to < 0 {
			return fmt.Errorf("--from and --to are both required")
		}
		if err := d.ReorderLayer(*from, *to); err != nil {
			return err
		}
		if err := d.Save(out); err != nil {
			return err
		}
		return emit(map[string]any{"from": *from, "to": *to, "wrote": out})
	default:
		return fmt.Errorf("layer add or layer reorder, not %q", action)
	}
}

func cmdCompile(args []string) error {
	fs := flag.NewFlagSet("compile", flag.ContinueOnError)
	if err := parse(fs, args); err != nil {
		return err
	}
	if fs.NArg() < 1 {
		return fmt.Errorf("which .wick file?")
	}
	in := fs.Arg(0)
	out := strings.TrimSuffix(in, ".wick") + ".swf"
	if fs.NArg() > 1 {
		out = fs.Arg(1)
	}
	res, err := Compile(in, out)
	if err != nil {
		return err
	}
	return emit(res)
}
