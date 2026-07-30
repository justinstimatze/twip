// Reading a document into something an agent can act on.
//
// The summary is JSON with a UUID on every addressable thing, because a UUID is what the
// format actually uses to name objects. An address scheme invented on top ("layer 0, frame 3,
// clip 1, layer 0…") would have to grow a grammar the moment clips nest, and would be a second
// naming system to keep in agreement with the first. Every edit verb takes a UUID, and `read`
// is where they come from.

package main

import "strings"

// Summary is the whole document, shallow enough to read and deep enough to edit from.
type Summary struct {
	File       string      `json:"file"`
	Stage      Stage       `json:"stage"`
	Framerate  float64     `json:"framerate"`
	Background string      `json:"background"`
	Frames     int         `json:"frames"`
	Layers     []LayerInfo `json:"layers"`
	Assets     []AssetInfo `json:"assets,omitempty"`
}

type Stage struct {
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}

type LayerInfo struct {
	Index  int         `json:"index"`
	UUID   string      `json:"uuid"`
	Name   string      `json:"name"`
	Locked bool        `json:"locked,omitempty"`
	Hidden bool        `json:"hidden,omitempty"`
	Frames []FrameInfo `json:"frames"`
}

type FrameInfo struct {
	UUID     string       `json:"uuid"`
	Start    int          `json:"start"`
	End      int          `json:"end"`
	Contours int          `json:"contours"`
	Sound    string       `json:"sound,omitempty"`
	Scripts  []ScriptInfo `json:"scripts,omitempty"`
	Tweens   []TweenInfo  `json:"tweens,omitempty"`
	Clips    []ClipInfo   `json:"clips,omitempty"`
	Other    []string     `json:"other,omitempty"`
}

type ScriptInfo struct {
	Name  string `json:"name"`
	Lines int    `json:"lines"`
	Src   string `json:"src,omitempty"`
}

type TweenInfo struct {
	UUID          string     `json:"uuid"`
	Playhead      int        `json:"playhead"`
	Easing        string     `json:"easing"`
	Bezier        []float64  `json:"bezier,omitempty"`
	FullRotations int        `json:"fullRotations,omitempty"`
	Transform     *Transform `json:"transform,omitempty"`
}

type ClipInfo struct {
	UUID       string       `json:"uuid"`
	Identifier string       `json:"identifier,omitempty"`
	Transform  *Transform   `json:"transform,omitempty"`
	Scripts    []ScriptInfo `json:"scripts,omitempty"`
	Layers     []LayerInfo  `json:"layers,omitempty"`
}

type Transform struct {
	X        float64 `json:"x"`
	Y        float64 `json:"y"`
	ScaleX   float64 `json:"scaleX"`
	ScaleY   float64 `json:"scaleY"`
	Rotation float64 `json:"rotation"`
	Skew     float64 `json:"skew,omitempty"`
	Opacity  float64 `json:"opacity"`
}

type AssetInfo struct {
	UUID  string `json:"uuid"`
	Name  string `json:"name"`
	Class string `json:"class"`
}

// Read builds the summary. depth caps clip recursion: 0 means clips are listed with their
// transform but not opened, which keeps `read` on a deeply nested document from returning more
// than anyone asked for.
func (d *Doc) Read(depth int) (*Summary, error) {
	tl, err := d.rootTimeline()
	if err != nil {
		return nil, err
	}
	s := &Summary{
		File:       d.path,
		Stage:      Stage{Width: numField(d.project, "width"), Height: numField(d.project, "height")},
		Framerate:  numField(d.project, "framerate"),
		Background: strField(d.project, "backgroundColor"),
		Layers:     d.readLayers(tl, depth),
		Assets:     d.readAssets(),
	}
	for _, l := range s.Layers {
		for _, f := range l.Frames {
			if f.End > s.Frames {
				s.Frames = f.End
			}
		}
	}
	return s, nil
}

func (d *Doc) readLayers(timeline map[string]any, depth int) []LayerInfo {
	var out []LayerInfo
	for i, layer := range d.layers(timeline) {
		li := LayerInfo{
			Index:  i,
			UUID:   uuidOf(layer),
			Name:   strField(layer, "name"),
			Locked: boolField(layer, "locked"),
			Hidden: boolField(layer, "hidden"),
			Frames: []FrameInfo{},
		}
		for _, frame := range d.framesOf(layer) {
			li.Frames = append(li.Frames, d.readFrame(frame, depth))
		}
		out = append(out, li)
	}
	return out
}

func (d *Doc) readFrame(frame map[string]any, depth int) FrameInfo {
	fi := FrameInfo{
		UUID:    uuidOf(frame),
		Start:   intField(frame, "start"),
		End:     intField(frame, "end"),
		Sound:   strField(frame, "sound"),
		Scripts: readScripts(frame),
	}
	for _, c := range d.children(frame) {
		switch classname(c) {
		case "Path":
			fi.Contours++
		case "Tween":
			fi.Tweens = append(fi.Tweens, readTween(c))
		case "Clip", "Button":
			fi.Clips = append(fi.Clips, d.readClip(c, depth))
		case "Selection", "":
			// Editor state, not content — the same thing parse_wick declines to count.
		default:
			// Named rather than counted: what the compiler will drop is worth seeing here,
			// where it can still be moved or removed, and its class is the only useful name.
			fi.Other = append(fi.Other, classname(c))
		}
	}
	return fi
}

func (d *Doc) readClip(clip map[string]any, depth int) ClipInfo {
	ci := ClipInfo{
		UUID:       uuidOf(clip),
		Identifier: strField(clip, "identifier"),
		Transform:  readTransform(clip["transformation"]),
		Scripts:    readScripts(clip),
	}
	if depth > 0 {
		if tl := d.childOfClass(clip, "Timeline"); tl != nil {
			ci.Layers = d.readLayers(tl, depth-1)
		}
	}
	return ci
}

// readScripts reports a script's length rather than its text. The source of every script on
// every frame would dominate the summary of any document that has more than a couple, and
// `script get` exists to fetch one.
func readScripts(o map[string]any) []ScriptInfo {
	raw, _ := o["scripts"].([]any)
	var out []ScriptInfo
	for _, s := range raw {
		m, ok := s.(map[string]any)
		if !ok {
			continue
		}
		src := strField(m, "src")
		if src == "" {
			continue // The engine writes an empty `default` on every frame; it is not a script.
		}
		lines := 1
		for _, r := range src {
			if r == '\n' {
				lines++
			}
		}
		out = append(out, ScriptInfo{Name: strField(m, "name"), Lines: lines})
	}
	return out
}

func readTween(t map[string]any) TweenInfo {
	ti := TweenInfo{
		UUID:          uuidOf(t),
		Playhead:      intField(t, "playheadPosition"),
		Easing:        strField(t, "easingType"),
		FullRotations: intField(t, "fullRotations"),
		Transform:     readTransform(t["transformation"]),
	}
	if raw, ok := t["bezier"].([]any); ok {
		for _, v := range raw {
			f, _ := v.(float64)
			ti.Bezier = append(ti.Bezier, f)
		}
	}
	return ti
}

func readTransform(v any) *Transform {
	m, ok := v.(map[string]any)
	if !ok {
		return nil
	}
	return &Transform{
		X:        numField(m, "x"),
		Y:        numField(m, "y"),
		ScaleX:   numField(m, "scaleX"),
		ScaleY:   numField(m, "scaleY"),
		Rotation: numField(m, "rotation"),
		Skew:     numField(m, "skew"),
		Opacity:  numField(m, "opacity"),
	}
}

// readAssets lists the project's asset objects. They hang off the project rather than off any
// timeline, so nothing in the layer walk would ever see them.
func (d *Doc) readAssets() []AssetInfo {
	var out []AssetInfo
	for _, c := range d.children(d.project) {
		class := classname(c)
		if !strings.HasSuffix(class, "Asset") {
			continue
		}
		out = append(out, AssetInfo{UUID: uuidOf(c), Name: strField(c, "name"), Class: class})
	}
	return out
}

// LayerAt resolves a layer by its index on the root timeline, which is the addressing a person
// reads off the editor's own timeline panel.
func (d *Doc) LayerAt(index int) (map[string]any, error) {
	tl, err := d.rootTimeline()
	if err != nil {
		return nil, err
	}
	ls := d.layers(tl)
	if index < 0 || index >= len(ls) {
		return nil, errIndex("layer", index, len(ls))
	}
	return ls[index], nil
}

// FrameAtPlayhead finds the frame covering a playhead position on a root-timeline layer.
func (d *Doc) FrameAtPlayhead(layerIndex, playhead int) (map[string]any, error) {
	layer, err := d.LayerAt(layerIndex)
	if err != nil {
		return nil, err
	}
	for _, f := range d.framesOf(layer) {
		if intField(f, "start") <= playhead && playhead <= intField(f, "end") {
			return f, nil
		}
	}
	return nil, errNoFrame(layerIndex, playhead)
}
