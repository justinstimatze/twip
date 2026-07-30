// The structural edits — the ones with no geometry in them.
//
// Everything a drawing engine has to compute (boolean ops, planarisation, hit-testing, text
// measurement) is deliberately absent. Those are canvas-tier operations: they need paper.js and
// they need the browser. What is here is the part of authoring that is data, where an edit is
// exact and repeatable and does not need a renderer to agree with it afterwards.

package main

import (
	"fmt"
	"sort"
)

func errIndex(what string, index, count int) error {
	return fmt.Errorf("no %s at index %d (the document has %d)", what, index, count)
}

func errNoFrame(layer, playhead int) error {
	return fmt.Errorf("layer %d has no frame covering playhead %d", layer, playhead)
}

// GetScript returns one script's source from a Frame or Clip.
func (d *Doc) GetScript(uuid, event string) (string, error) {
	o, err := d.mustBe(uuid, "Frame", "Clip", "Button")
	if err != nil {
		return "", err
	}
	raw, _ := o["scripts"].([]any)
	for _, s := range raw {
		m, ok := s.(map[string]any)
		if ok && strField(m, "name") == event {
			return strField(m, "src"), nil
		}
	}
	return "", fmt.Errorf("%s has no %q script", classname(o), event)
}

// SetScript writes one script's source onto a Frame or Clip, adding the entry if the object
// does not already carry that event.
//
// The event name is not validated against the engine's list. A name the engine does not know
// is inert rather than harmful — it sits in the file and nothing fires it — whereas a
// whitelist here would be a second copy of the engine's list, free to fall behind it.
func (d *Doc) SetScript(uuid, event, src string) error {
	o, err := d.mustBe(uuid, "Frame", "Clip", "Button")
	if err != nil {
		return err
	}
	raw, _ := o["scripts"].([]any)
	for _, s := range raw {
		if m, ok := s.(map[string]any); ok && strField(m, "name") == event {
			m["src"] = src
			return nil
		}
	}
	o["scripts"] = append(raw, map[string]any{"name": event, "src": src})
	return nil
}

// TweenEdit is the set of tween fields a retime can change. A nil field is left alone, which is
// what lets `tween set --easing X` change the curve without restating the transform.
type TweenEdit struct {
	Playhead      *int
	Easing        *string
	Bezier        []float64
	FullRotations *int
}

// SetTween retimes or recurves one Tween.
func (d *Doc) SetTween(uuid string, e TweenEdit) error {
	t, err := d.mustBe(uuid, "Tween")
	if err != nil {
		return err
	}
	if e.Playhead != nil {
		if *e.Playhead < 1 {
			return fmt.Errorf("playhead is 1-indexed within the frame; %d is not a position", *e.Playhead)
		}
		t["playheadPosition"] = float64(*e.Playhead)
	}
	if e.Easing != nil {
		t["easingType"] = *e.Easing
	}
	if e.Bezier != nil {
		if len(e.Bezier) != 4 {
			return fmt.Errorf("a bezier is 4 control values (x1,y1,x2,y2), got %d", len(e.Bezier))
		}
		anys := make([]any, 4)
		for i, f := range e.Bezier {
			anys[i] = f
		}
		t["bezier"] = anys
		// A curve nobody reads is a curve that silently does nothing: the engine only consults
		// `bezier` when easingType is "custom", so setting one without the other produces a
		// document that says "custom curve" and plays linearly.
		if e.Easing == nil {
			t["easingType"] = "custom"
		}
	}
	if e.FullRotations != nil {
		t["fullRotations"] = float64(*e.FullRotations)
	}
	return nil
}

// AddLayer inserts a new layer holding one empty frame, at `index` on the root timeline
// (negative means append). It returns the new layer's UUID.
//
// The frame is not optional. A layer with no frames is a shape the editor's timeline panel can
// display but nothing can be drawn into, and every layer the engine creates has one — so a
// layer added without it is a layer that looks right and cannot be used.
func (d *Doc) AddLayer(name string, index int) (string, error) {
	tl, err := d.rootTimeline()
	if err != nil {
		return "", err
	}
	if name == "" {
		name = fmt.Sprintf("Layer %d", len(d.layers(tl))+1)
	}

	frame := d.add(map[string]any{
		"classname": "Frame", "identifier": nil, "name": nil, "uuid": newUUID(),
		"children": []any{}, "scripts": []any{map[string]any{"name": "default", "src": ""}},
		"cursor": "default", "start": float64(1), "end": float64(1),
		"sound": nil, "soundVolume": float64(1), "soundLoop": false, "soundStart": float64(0),
		"originalLayerIndex": float64(-1),
	})
	layer := d.add(map[string]any{
		"classname": "Layer", "identifier": nil, "name": name, "uuid": newUUID(),
		"children": []any{uuidOf(frame)}, "locked": false, "hidden": false,
	})

	kids, _ := tl["children"].([]any)
	if index < 0 || index > len(kids) {
		index = len(kids)
	}
	kids = append(kids, nil)
	copy(kids[index+1:], kids[index:])
	kids[index] = uuidOf(layer)
	tl["children"] = kids
	return uuidOf(layer), nil
}

// ReorderLayer moves the layer at `from` to `to` on the root timeline. Index 0 is frontmost,
// matching both the engine's order and what the timeline panel shows top-to-bottom.
func (d *Doc) ReorderLayer(from, to int) error {
	tl, err := d.rootTimeline()
	if err != nil {
		return err
	}
	ls := d.layers(tl)
	if from < 0 || from >= len(ls) {
		return errIndex("layer", from, len(ls))
	}
	if to < 0 || to >= len(ls) {
		return errIndex("layer", to, len(ls))
	}
	if from == to {
		return nil
	}

	// The timeline's children may hold objects that are not Layers, so the move has to be
	// expressed over the children list by UUID rather than by shuffling the filtered slice —
	// otherwise reordering layers would reorder whatever else is in there too.
	moving := uuidOf(ls[from])
	target := uuidOf(ls[to])
	kids, _ := tl["children"].([]any)
	var fromPos, toPos = -1, -1
	for i, k := range kids {
		switch k {
		case moving:
			fromPos = i
		case target:
			toPos = i
		}
	}
	if fromPos < 0 || toPos < 0 {
		return fmt.Errorf("layer %d or %d is not in the timeline's children", from, to)
	}
	kids = append(kids[:fromPos], kids[fromPos+1:]...)
	rest := make([]any, len(kids[toPos:]))
	copy(rest, kids[toPos:])
	kids = append(append(kids[:toPos], moving), rest...)
	tl["children"] = kids
	return nil
}

// Tweens returns a frame's tweens ordered by playhead, which is the order they interpolate in
// and not necessarily the order the engine serialized them.
func (d *Doc) Tweens(frameUUID string) ([]TweenInfo, error) {
	f, err := d.mustBe(frameUUID, "Frame")
	if err != nil {
		return nil, err
	}
	var out []TweenInfo
	for _, c := range d.children(f) {
		if classname(c) == "Tween" {
			out = append(out, readTween(c))
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Playhead < out[j].Playhead })
	return out, nil
}
