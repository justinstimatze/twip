// Package main implements twipdoc: reading and editing .wick documents without a browser.
//
// A .wick is a zip whose project.json holds a flat map of UUID-keyed objects. Parents name
// their children by UUID, so the graph is only a tree if you walk it from the root down —
// iterating `objects` visits the same Frame once as itself and again as somebody's child, and
// visits editor state (Selection) that is not part of the document at all.
//
// Everything here keeps objects as map[string]any rather than typed structs, and that is the
// load-bearing decision. This tool knows about a dozen fields; the engine writes dozens more,
// and a future version will write dozens this binary has never heard of. A typed model would
// round-trip a document through the subset it understands and silently drop the rest — the
// file would still open, still look almost right, and have quietly lost whatever it was that
// this tool could not name. Mutating the map in place means an edit changes what it says it
// changes and nothing else.
package main

import (
	"archive/zip"
	"bytes"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
)

// Doc is an open .wick: the parsed project.json plus every other zip entry held verbatim so
// saving cannot lose the assets.
type Doc struct {
	path    string
	root    map[string]any
	project map[string]any
	objects map[string]any
	others  []zipEntry
}

type zipEntry struct {
	name string
	body []byte
	mode os.FileMode
}

// Open reads a .wick from disk.
func Open(path string) (*Doc, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	zr, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		return nil, fmt.Errorf("%s is not a zip: %w", filepath.Base(path), err)
	}

	d := &Doc{path: path}
	var projectJSON []byte
	for _, f := range zr.File {
		rc, err := f.Open()
		if err != nil {
			return nil, err
		}
		body, err := io.ReadAll(rc)
		rc.Close()
		if err != nil {
			return nil, err
		}
		if f.Name == "project.json" {
			projectJSON = body
			continue
		}
		d.others = append(d.others, zipEntry{name: f.Name, body: body, mode: f.Mode()})
	}
	if projectJSON == nil {
		return nil, fmt.Errorf("project.json missing from %s", filepath.Base(path))
	}
	if err := json.Unmarshal(projectJSON, &d.root); err != nil {
		return nil, fmt.Errorf("parse project.json: %w", err)
	}

	var ok bool
	if d.project, ok = d.root["project"].(map[string]any); !ok {
		return nil, fmt.Errorf("project.json has no project root")
	}
	if d.objects, ok = d.root["objects"].(map[string]any); !ok {
		return nil, fmt.Errorf("project.json has no objects map")
	}
	return d, nil
}

// Save writes the document back out as a .wick.
//
// Key order changes — Go marshals a map alphabetically and the engine writes insertion order —
// so the bytes differ from the input even for an untouched document. Nothing reads project.json
// positionally, so this costs nothing but a noisy diff; what must survive is the value graph,
// which TestRoundTripPreservesEverything asserts by comparing re-parsed JSON.
func (d *Doc) Save(path string) error {
	body, err := json.MarshalIndent(d.root, "", "  ")
	if err != nil {
		return err
	}

	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for _, e := range d.others {
		h := &zip.FileHeader{Name: e.name, Method: zip.Deflate}
		h.SetMode(e.mode)
		w, err := zw.CreateHeader(h)
		if err != nil {
			return err
		}
		if _, err := w.Write(e.body); err != nil {
			return err
		}
	}
	w, err := zw.Create("project.json")
	if err != nil {
		return err
	}
	if _, err := w.Write(body); err != nil {
		return err
	}
	if err := zw.Close(); err != nil {
		return err
	}
	return os.WriteFile(path, buf.Bytes(), 0o644)
}

// obj resolves a UUID to its object, or nil.
func (d *Doc) obj(uuid string) map[string]any {
	o, _ := d.objects[uuid].(map[string]any)
	return o
}

// classname reports an object's Wick class, or "" for an object that does not say.
func classname(o map[string]any) string {
	s, _ := o["classname"].(string)
	return s
}

func uuidOf(o map[string]any) string {
	s, _ := o["uuid"].(string)
	return s
}

// childUUIDs reads an object's children list.
func childUUIDs(o map[string]any) []string {
	raw, _ := o["children"].([]any)
	out := make([]string, 0, len(raw))
	for _, v := range raw {
		if s, ok := v.(string); ok {
			out = append(out, s)
		}
	}
	return out
}

// children resolves an object's children to the objects they name, dropping any UUID the map
// does not hold. A dangling child is the engine's business, not this tool's: refusing to read
// a document over one would make twipdoc stricter than the editor that wrote it.
func (d *Doc) children(o map[string]any) []map[string]any {
	ids := childUUIDs(o)
	out := make([]map[string]any, 0, len(ids))
	for _, id := range ids {
		if c := d.obj(id); c != nil {
			out = append(out, c)
		}
	}
	return out
}

// childOfClass returns the first child with the given classname.
func (d *Doc) childOfClass(o map[string]any, class string) map[string]any {
	for _, c := range d.children(o) {
		if classname(c) == class {
			return c
		}
	}
	return nil
}

// rootTimeline walks project → root Clip → Timeline, which is the only route to the main
// timeline. The project's children hold a Selection alongside the root Clip, and the Selection
// is editor state — it is what a reader that iterates `objects` mistakes for content.
func (d *Doc) rootTimeline() (map[string]any, error) {
	clip := d.childOfClass(d.project, "Clip")
	if clip == nil {
		return nil, fmt.Errorf("no root Clip in project")
	}
	tl := d.childOfClass(clip, "Timeline")
	if tl == nil {
		return nil, fmt.Errorf("root Clip has no Timeline")
	}
	return tl, nil
}

// layers returns a timeline's Layer objects in Wick order (index 0 is frontmost).
func (d *Doc) layers(timeline map[string]any) []map[string]any {
	var out []map[string]any
	for _, c := range d.children(timeline) {
		if classname(c) == "Layer" {
			out = append(out, c)
		}
	}
	return out
}

// framesOf returns a layer's Frame objects, ordered by start.
func (d *Doc) framesOf(layer map[string]any) []map[string]any {
	var out []map[string]any
	for _, c := range d.children(layer) {
		if classname(c) == "Frame" {
			out = append(out, c)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return numField(out[i], "start") < numField(out[j], "start") })
	return out
}

// find locates any object by UUID and reports what it is, so a verb can refuse an edit aimed
// at the wrong kind of object by name rather than by crashing on a missing field.
func (d *Doc) find(uuid string) (map[string]any, error) {
	o := d.obj(uuid)
	if o == nil {
		return nil, fmt.Errorf("no object with uuid %s (run `twipdoc read` to list them)", uuid)
	}
	return o, nil
}

// mustBe returns the object at uuid, erroring unless it is one of the named classes.
func (d *Doc) mustBe(uuid string, classes ...string) (map[string]any, error) {
	o, err := d.find(uuid)
	if err != nil {
		return nil, err
	}
	got := classname(o)
	for _, c := range classes {
		if got == c {
			return o, nil
		}
	}
	return nil, fmt.Errorf("%s is a %s, not a %v", uuid, got, classes)
}

func numField(o map[string]any, key string) float64 {
	f, _ := o[key].(float64)
	return f
}

func intField(o map[string]any, key string) int {
	return int(numField(o, key))
}

func strField(o map[string]any, key string) string {
	s, _ := o[key].(string)
	return s
}

func boolField(o map[string]any, key string) bool {
	b, _ := o[key].(bool)
	return b
}

// newUUID generates a version-4 UUID in the form the engine writes.
func newUUID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err) // crypto/rand does not fail on any platform this runs on.
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// add registers a new object in the flat map and returns it.
func (d *Doc) add(o map[string]any) map[string]any {
	d.objects[uuidOf(o)] = o
	return o
}

// appendChild adds a UUID to a parent's children list.
func appendChild(parent map[string]any, uuid string) {
	kids, _ := parent["children"].([]any)
	parent["children"] = append(kids, uuid)
}
