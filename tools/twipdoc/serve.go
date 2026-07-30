// The MCP surface, over stdio.
//
// Not HTTP. twipdoc edits .wick files on the caller's disk, so the useful boundary is which
// directory it may touch, not who is asking — and a network transport would add a second
// question (who) to a tool whose answer to the first (what) is "the files you already have".
// The server runs beside its client, the way a language server does.
//
// The tools are grouped by object rather than one-per-verb: an agent picking a tool is choosing
// what it wants to touch, and `twip_script` with action get/set is a shorter thing to hold than
// two tools that differ by a word.

package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	sdk "github.com/modelcontextprotocol/go-sdk/mcp"
)

const serverInstructions = `twipdoc reads and edits .wick documents — the Wick Editor / twip project format.

Start with twip_read: it returns the whole document with a uuid on every layer, frame, tween
and clip. Every other tool addresses objects by those uuids.

What this can do is structure: timing, layers, scripts, tween curves. What it cannot do is
geometry — drawing, boolean operations, hit-testing and text measurement need the editor's
canvas and are not reachable from here.

Edits write a file. Pass "out" to write a copy, or in_place:true to overwrite. Neither is a
default; an edit without one is refused rather than guessed at.`

func cmdServe(args []string) error {
	fs := flag.NewFlagSet("serve", flag.ContinueOnError)
	root := fs.String("root", ".", "the only directory whose .wick files this server may touch")
	if err := fs.Parse(args); err != nil {
		return err
	}
	abs, err := filepath.Abs(*root)
	if err != nil {
		return err
	}
	if st, err := os.Stat(abs); err != nil || !st.IsDir() {
		return fmt.Errorf("--root %s is not a directory", *root)
	}

	s := &mcpServer{root: abs}
	srv := sdk.NewServer(
		&sdk.Implementation{Name: "twipdoc", Version: Version},
		&sdk.ServerOptions{Instructions: serverInstructions},
	)
	s.register(srv)
	fmt.Fprintf(os.Stderr, "twipdoc %s: serving %s over stdio\n", Version, abs)
	return srv.Run(context.Background(), &sdk.StdioTransport{})
}

type mcpServer struct{ root string }

// resolve turns a caller-supplied path into an absolute one inside root, or refuses.
//
// filepath.Abs cleans the path first, so "a/../../etc/passwd" is resolved before the prefix
// check rather than after it — the check has to happen on what the filesystem would open, not
// on the string the caller wrote. The trailing separator on the prefix is what stops
// /home/x/twip-elsewhere from passing as a child of /home/x/twip.
func (s *mcpServer) resolve(p string) (string, error) {
	if p == "" {
		return "", fmt.Errorf("which file?")
	}
	abs := p
	if !filepath.IsAbs(abs) {
		abs = filepath.Join(s.root, abs)
	}
	abs = filepath.Clean(abs)
	if abs != s.root && !strings.HasPrefix(abs, s.root+string(filepath.Separator)) {
		return "", fmt.Errorf("%s is outside this server's root (%s)", p, s.root)
	}
	return abs, nil
}

func (s *mcpServer) open(p string) (*Doc, string, error) {
	abs, err := s.resolve(p)
	if err != nil {
		return nil, "", err
	}
	d, err := Open(abs)
	return d, abs, err
}

// writeTo names the output file for an edit, applying the same refuse-to-guess rule the CLI has.
func (s *mcpServer) writeTo(d *Doc, out string, inPlace bool) (string, error) {
	switch {
	case out != "" && inPlace:
		return "", fmt.Errorf(`"out" and in_place:true both given; pick one`)
	case out != "":
		return s.resolve(out)
	case inPlace:
		return d.path, nil
	default:
		return "", fmt.Errorf(`this edit writes a document: pass "out", or in_place:true to overwrite %s`, filepath.Base(d.path))
	}
}

// ok renders a value as the JSON text an MCP client shows the model.
func ok(v any) (*sdk.CallToolResult, any, error) {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return nil, nil, err
	}
	return &sdk.CallToolResult{Content: []sdk.Content{&sdk.TextContent{Text: string(b)}}}, nil, nil
}

// fail returns a tool error — the model's problem to fix, not the transport's.
func fail(err error) (*sdk.CallToolResult, any, error) {
	return &sdk.CallToolResult{
		IsError: true,
		Content: []sdk.Content{&sdk.TextContent{Text: err.Error()}},
	}, nil, nil
}

type readInput struct {
	File  string `json:"file" jsonschema:"path to the .wick file, relative to the server root"`
	Layer *int   `json:"layer,omitempty" jsonschema:"restrict to one root-timeline layer by index (0 is frontmost)"`
	Depth *int   `json:"depth,omitempty" jsonschema:"how many levels of nested clip to open; default 1"`
}

type scriptInput struct {
	File    string `json:"file" jsonschema:"path to the .wick file"`
	Action  string `json:"action" jsonschema:"get or set"`
	UUID    string `json:"uuid,omitempty" jsonschema:"the Frame or Clip carrying the script"`
	Layer   *int   `json:"layer,omitempty" jsonschema:"address by root-timeline layer index instead of uuid"`
	Frame   *int   `json:"frame,omitempty" jsonschema:"address by playhead position; needs layer"`
	Event   string `json:"event,omitempty" jsonschema:"script name — default, load, mousepressed, …; defaults to default"`
	Src     string `json:"src,omitempty" jsonschema:"the script source (set)"`
	Out     string `json:"out,omitempty" jsonschema:"write the edited document here"`
	InPlace bool   `json:"in_place,omitempty" jsonschema:"overwrite the input file"`
}

type tweenInput struct {
	File          string    `json:"file" jsonschema:"path to the .wick file"`
	Action        string    `json:"action" jsonschema:"get or set"`
	UUID          string    `json:"uuid" jsonschema:"the Frame (get) or the Tween (set)"`
	Playhead      *int      `json:"playhead,omitempty" jsonschema:"move the tween to this 1-indexed position within its frame"`
	Easing        *string   `json:"easing,omitempty" jsonschema:"easing curve name"`
	Bezier        []float64 `json:"bezier,omitempty" jsonschema:"custom curve control points x1,y1,x2,y2; implies easing custom"`
	FullRotations *int      `json:"full_rotations,omitempty" jsonschema:"extra whole turns while interpolating"`
	Out           string    `json:"out,omitempty" jsonschema:"write the edited document here"`
	InPlace       bool      `json:"in_place,omitempty" jsonschema:"overwrite the input file"`
}

type layerInput struct {
	File    string `json:"file" jsonschema:"path to the .wick file"`
	Action  string `json:"action" jsonschema:"add or reorder"`
	Name    string `json:"name,omitempty" jsonschema:"layer name (add)"`
	Index   *int   `json:"index,omitempty" jsonschema:"insert position, default appends (add)"`
	From    *int   `json:"from,omitempty" jsonschema:"layer to move (reorder)"`
	To      *int   `json:"to,omitempty" jsonschema:"where it lands (reorder)"`
	Out     string `json:"out,omitempty" jsonschema:"write the edited document here"`
	InPlace bool   `json:"in_place,omitempty" jsonschema:"overwrite the input file"`
}

type compileInput struct {
	File string `json:"file" jsonschema:"path to the .wick file"`
	Out  string `json:"out,omitempty" jsonschema:"where the .swf goes; defaults to the input with a .swf suffix"`
}

func (s *mcpServer) register(srv *sdk.Server) {
	sdk.AddTool(srv, &sdk.Tool{
		Name: "twip_read",
		Description: `Read a .wick document: stage size, framerate, background, and every layer with its
frames, scripts, tweens and nested clips. Each object carries the uuid the other tools address it by.
Pass "layer" to read one layer instead of all of them.`,
	}, s.handleRead)

	sdk.AddTool(srv, &sdk.Tool{
		Name: "twip_script",
		Description: `Read or write a frame's or clip's behavior script. Actions:
- get: return one script's source (uuid or layer+frame, event)
- set: replace it (uuid or layer+frame, event, src, and out or in_place)
twip compiles a TypeScript-like subset to AVM1; what it cannot read it reports rather than dropping.`,
	}, s.handleScript)

	sdk.AddTool(srv, &sdk.Tool{
		Name: "twip_tween",
		Description: `Read or retime motion tweens. Actions:
- get: list a frame's tweens in playhead order, with transform and easing (uuid = the Frame)
- set: move one tween or change its curve (uuid = the Tween, and out or in_place)`,
	}, s.handleTween)

	sdk.AddTool(srv, &sdk.Tool{
		Name: "twip_layer",
		Description: `Structural timeline edits. Actions:
- add: append or insert a layer, with one empty frame (name, index)
- reorder: move a layer (from, to; index 0 is frontmost)
Both write a document, so pass out or in_place.`,
	}, s.handleLayer)

	sdk.AddTool(srv, &sdk.Tool{
		Name: "twip_compile",
		Description: `Compile a .wick to .swf with the twip compiler. Returns the output path and size, plus
what the document had that the movie does not — the compile succeeds either way, so this field is the
only place a dropped object is visible.`,
	}, s.handleCompile)
}

func (s *mcpServer) handleRead(_ context.Context, _ *sdk.CallToolRequest, in readInput) (*sdk.CallToolResult, any, error) {
	d, _, err := s.open(in.File)
	if err != nil {
		return fail(err)
	}
	depth := 1
	if in.Depth != nil {
		depth = *in.Depth
	}
	if in.Layer != nil {
		l, err := d.LayerAt(*in.Layer)
		if err != nil {
			return fail(err)
		}
		li := LayerInfo{
			Index: *in.Layer, UUID: uuidOf(l), Name: strField(l, "name"),
			Locked: boolField(l, "locked"), Hidden: boolField(l, "hidden"), Frames: []FrameInfo{},
		}
		for _, f := range d.framesOf(l) {
			li.Frames = append(li.Frames, d.readFrame(f, depth))
		}
		return ok(li)
	}
	sum, err := d.Read(depth)
	if err != nil {
		return fail(err)
	}
	return ok(sum)
}

func (s *mcpServer) handleScript(_ context.Context, _ *sdk.CallToolRequest, in scriptInput) (*sdk.CallToolResult, any, error) {
	d, _, err := s.open(in.File)
	if err != nil {
		return fail(err)
	}
	event := in.Event
	if event == "" {
		event = "default"
	}
	target := in.UUID
	if target == "" {
		if in.Layer == nil || in.Frame == nil {
			return fail(fmt.Errorf("give uuid, or layer and frame together"))
		}
		f, err := d.FrameAtPlayhead(*in.Layer, *in.Frame)
		if err != nil {
			return fail(err)
		}
		target = uuidOf(f)
	}

	switch in.Action {
	case "get":
		src, err := d.GetScript(target, event)
		if err != nil {
			return fail(err)
		}
		return ok(map[string]any{"uuid": target, "event": event, "src": src})
	case "set":
		out, err := s.writeTo(d, in.Out, in.InPlace)
		if err != nil {
			return fail(err)
		}
		if err := d.SetScript(target, event, in.Src); err != nil {
			return fail(err)
		}
		if err := d.Save(out); err != nil {
			return fail(err)
		}
		return ok(map[string]any{"uuid": target, "event": event, "wrote": out})
	default:
		return fail(fmt.Errorf("action is get or set, not %q", in.Action))
	}
}

func (s *mcpServer) handleTween(_ context.Context, _ *sdk.CallToolRequest, in tweenInput) (*sdk.CallToolResult, any, error) {
	d, _, err := s.open(in.File)
	if err != nil {
		return fail(err)
	}
	switch in.Action {
	case "get":
		ts, err := d.Tweens(in.UUID)
		if err != nil {
			return fail(err)
		}
		return ok(map[string]any{"frame": in.UUID, "tweens": ts})
	case "set":
		out, err := s.writeTo(d, in.Out, in.InPlace)
		if err != nil {
			return fail(err)
		}
		edit := TweenEdit{
			Playhead: in.Playhead, Easing: in.Easing,
			Bezier: in.Bezier, FullRotations: in.FullRotations,
		}
		if err := d.SetTween(in.UUID, edit); err != nil {
			return fail(err)
		}
		if err := d.Save(out); err != nil {
			return fail(err)
		}
		return ok(map[string]any{"uuid": in.UUID, "wrote": out})
	default:
		return fail(fmt.Errorf("action is get or set, not %q", in.Action))
	}
}

func (s *mcpServer) handleLayer(_ context.Context, _ *sdk.CallToolRequest, in layerInput) (*sdk.CallToolResult, any, error) {
	d, _, err := s.open(in.File)
	if err != nil {
		return fail(err)
	}
	out, err := s.writeTo(d, in.Out, in.InPlace)
	if err != nil {
		return fail(err)
	}
	switch in.Action {
	case "add":
		index := -1
		if in.Index != nil {
			index = *in.Index
		}
		uuid, err := d.AddLayer(in.Name, index)
		if err != nil {
			return fail(err)
		}
		if err := d.Save(out); err != nil {
			return fail(err)
		}
		return ok(map[string]any{"uuid": uuid, "wrote": out})
	case "reorder":
		if in.From == nil || in.To == nil {
			return fail(fmt.Errorf("reorder needs from and to"))
		}
		if err := d.ReorderLayer(*in.From, *in.To); err != nil {
			return fail(err)
		}
		if err := d.Save(out); err != nil {
			return fail(err)
		}
		return ok(map[string]any{"from": *in.From, "to": *in.To, "wrote": out})
	default:
		return fail(fmt.Errorf("action is add or reorder, not %q", in.Action))
	}
}

func (s *mcpServer) handleCompile(_ context.Context, _ *sdk.CallToolRequest, in compileInput) (*sdk.CallToolResult, any, error) {
	src, err := s.resolve(in.File)
	if err != nil {
		return fail(err)
	}
	dst := strings.TrimSuffix(src, ".wick") + ".swf"
	if in.Out != "" {
		if dst, err = s.resolve(in.Out); err != nil {
			return fail(err)
		}
	}
	res, err := Compile(src, dst)
	if err != nil {
		return fail(err)
	}
	return ok(res)
}
