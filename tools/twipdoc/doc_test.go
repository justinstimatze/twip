package main

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"testing"
)

const fixtures = "../../fixtures"

func allFixtures(t *testing.T) []string {
	t.Helper()
	paths, err := filepath.Glob(filepath.Join(fixtures, "*.wick"))
	if err != nil || len(paths) == 0 {
		t.Fatalf("no fixtures at %s (%v)", fixtures, err)
	}
	return paths
}

func openFixture(t *testing.T, name string) *Doc {
	t.Helper()
	d, err := Open(filepath.Join(fixtures, name))
	if err != nil {
		t.Fatalf("open %s: %v", name, err)
	}
	return d
}

// A round trip must not lose anything, including the fields this tool has never heard of.
// Comparing the re-parsed value graph rather than the bytes is deliberate: Go marshals map keys
// alphabetically and the engine writes insertion order, so the bytes always differ and nothing
// reads project.json positionally.
func TestRoundTripPreservesTheValueGraph(t *testing.T) {
	for _, path := range allFixtures(t) {
		t.Run(filepath.Base(path), func(t *testing.T) {
			before, err := Open(path)
			if err != nil {
				t.Fatalf("open: %v", err)
			}
			out := filepath.Join(t.TempDir(), "rt.wick")
			if err := before.Save(out); err != nil {
				t.Fatalf("save: %v", err)
			}
			after, err := Open(out)
			if err != nil {
				t.Fatalf("reopen: %v", err)
			}
			if !reflect.DeepEqual(before.root, after.root) {
				t.Errorf("the document changed across a save with no edit")
			}
			if len(before.others) != len(after.others) {
				t.Errorf("zip entries: %d in, %d out", len(before.others), len(after.others))
			}
		})
	}
}

// The real check on the round trip: the Rust compiler is an independent reader of this format,
// so a field Go dropped shows up as a different movie. Byte-identical SWFs from the original and
// the round-tripped document is the strongest available statement that nothing was lost — and
// it is a statement Go cannot make about its own output by agreeing with itself.
func TestARoundTrippedDocumentCompilesToTheSameMovie(t *testing.T) {
	bin, err := twipBinary()
	if err != nil {
		t.Skipf("no twip binary: %v", err)
	}
	dir := t.TempDir()
	for _, path := range allFixtures(t) {
		t.Run(filepath.Base(path), func(t *testing.T) {
			name := filepath.Base(path)
			direct := filepath.Join(dir, name+".direct.swf")
			if out, err := exec.Command(bin, path, direct).CombinedOutput(); err != nil {
				t.Skipf("the compiler does not accept this fixture: %s", out)
			}

			d, err := Open(path)
			if err != nil {
				t.Fatalf("open: %v", err)
			}
			rt := filepath.Join(dir, name+".rt.wick")
			if err := d.Save(rt); err != nil {
				t.Fatalf("save: %v", err)
			}
			viaGo := filepath.Join(dir, name+".rt.swf")
			if out, err := exec.Command(bin, rt, viaGo).CombinedOutput(); err != nil {
				t.Fatalf("the compiler refused the round-tripped document: %s", out)
			}

			a, _ := os.ReadFile(direct)
			b, _ := os.ReadFile(viaGo)
			if len(a) != len(b) {
				t.Fatalf("movie differs after a round trip: %d bytes direct, %d via twipdoc", len(a), len(b))
			}
			for i := range a {
				if a[i] != b[i] {
					t.Fatalf("movie differs after a round trip at byte %d", i)
				}
			}
		})
	}
}

func TestSetScriptWritesOnlyThatScript(t *testing.T) {
	d := openFixture(t, "script-logic.wick")
	sum, err := d.Read(0)
	if err != nil {
		t.Fatal(err)
	}
	frame := sum.Layers[0].Frames[0].UUID

	before := snapshot(t, d)
	if err := d.SetScript(frame, "default", "stop();"); err != nil {
		t.Fatal(err)
	}
	got, err := d.GetScript(frame, "default")
	if err != nil {
		t.Fatal(err)
	}
	if got != "stop();" {
		t.Errorf("script is %q", got)
	}

	// Everything except that one object must be untouched.
	after := snapshot(t, d)
	for uuid, was := range before {
		if uuid == frame {
			continue
		}
		if !reflect.DeepEqual(was, after[uuid]) {
			t.Errorf("setting a script also changed %s", uuid)
		}
	}
	if len(after) != len(before) {
		t.Errorf("object count changed: %d → %d", len(before), len(after))
	}
}

// A new event on an object that does not carry it is an addition, not an error.
func TestSetScriptAddsAnEventThatWasNotThere(t *testing.T) {
	d := openFixture(t, "test1.wick")
	sum, _ := d.Read(0)
	frame := sum.Layers[0].Frames[0].UUID
	if _, err := d.GetScript(frame, "mouseclick"); err == nil {
		t.Fatal("the fixture already has a mouseclick script; pick another event")
	}
	if err := d.SetScript(frame, "mouseclick", "play();"); err != nil {
		t.Fatal(err)
	}
	got, err := d.GetScript(frame, "mouseclick")
	if err != nil || got != "play();" {
		t.Errorf("mouseclick is %q (%v)", got, err)
	}
}

func TestSetScriptRefusesAnObjectThatCannotHoldOne(t *testing.T) {
	d := openFixture(t, "test1.wick")
	sum, _ := d.Read(0)
	layer := sum.Layers[0].UUID
	if err := d.SetScript(layer, "default", "stop();"); err == nil {
		t.Error("a Layer accepted a script")
	}
}

// An added layer has to be one a person can draw on, which means it has a frame. A layer with
// no frames displays in the timeline panel and cannot be used.
func TestAddLayerProducesALayerWithAFrame(t *testing.T) {
	d := openFixture(t, "test1.wick")
	before, _ := d.Read(0)

	uuid, err := d.AddLayer("Sky", 0)
	if err != nil {
		t.Fatal(err)
	}
	after, err := d.Read(0)
	if err != nil {
		t.Fatal(err)
	}
	if len(after.Layers) != len(before.Layers)+1 {
		t.Fatalf("%d layers, was %d", len(after.Layers), len(before.Layers))
	}
	if after.Layers[0].UUID != uuid {
		t.Errorf("--index 0 did not put it frontmost")
	}
	if after.Layers[0].Name != "Sky" {
		t.Errorf("name is %q", after.Layers[0].Name)
	}
	if n := len(after.Layers[0].Frames); n != 1 {
		t.Fatalf("the new layer has %d frames", n)
	}
	if f := after.Layers[0].Frames[0]; f.Start != 1 || f.End != 1 {
		t.Errorf("its frame spans %d..%d", f.Start, f.End)
	}
	// The layer that was frontmost is still there, one place back.
	if after.Layers[1].UUID != before.Layers[0].UUID {
		t.Errorf("the existing layer moved somewhere unexpected")
	}
}

func TestAddedLayerSurvivesTheCompiler(t *testing.T) {
	bin, err := twipBinary()
	if err != nil {
		t.Skipf("no twip binary: %v", err)
	}
	d := openFixture(t, "test1.wick")
	if _, err := d.AddLayer("", -1); err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	edited := filepath.Join(dir, "edited.wick")
	if err := d.Save(edited); err != nil {
		t.Fatal(err)
	}
	if out, err := exec.Command(bin, edited, filepath.Join(dir, "out.swf")).CombinedOutput(); err != nil {
		t.Fatalf("the compiler refused a document with an added layer: %s", out)
	}
}

func TestReorderLayerMovesOne(t *testing.T) {
	d := openFixture(t, "multi-layer.wick")
	before, err := d.Read(0)
	if err != nil {
		t.Fatal(err)
	}
	if len(before.Layers) < 2 {
		t.Skip("needs a fixture with two layers")
	}
	front, second := before.Layers[0].UUID, before.Layers[1].UUID

	if err := d.ReorderLayer(0, 1); err != nil {
		t.Fatal(err)
	}
	after, _ := d.Read(0)
	if after.Layers[0].UUID != second || after.Layers[1].UUID != front {
		t.Errorf("the two layers did not swap")
	}
	if len(after.Layers) != len(before.Layers) {
		t.Errorf("reorder changed the layer count")
	}
}

func TestReorderLayerRefusesAnIndexThatIsNotThere(t *testing.T) {
	d := openFixture(t, "test1.wick")
	if err := d.ReorderLayer(0, 9); err == nil {
		t.Error("moving a layer to index 9 was accepted")
	}
}

// A bezier the engine never reads is worse than no bezier: the document says "custom curve" and
// plays linearly, and nothing anywhere reports the disagreement.
func TestSettingABezierAlsoSetsTheEasingThatReadsIt(t *testing.T) {
	d := openFixture(t, "motion-tween.wick")
	sum, err := d.Read(0)
	if err != nil {
		t.Fatal(err)
	}
	var tween string
	for _, l := range sum.Layers {
		for _, f := range l.Frames {
			if len(f.Tweens) > 0 {
				tween = f.Tweens[0].UUID
			}
		}
	}
	if tween == "" {
		t.Skip("needs a fixture with a tween")
	}

	if err := d.SetTween(tween, TweenEdit{Bezier: []float64{0.4, 0, 0.6, 1}}); err != nil {
		t.Fatal(err)
	}
	o := d.obj(tween)
	if got := strField(o, "easingType"); got != "custom" {
		t.Errorf("easing is %q, so the curve would never be read", got)
	}
}

func TestSetTweenRefusesAMalformedBezier(t *testing.T) {
	d := openFixture(t, "custom-easing.wick")
	sum, _ := d.Read(0)
	var tween string
	for _, l := range sum.Layers {
		for _, f := range l.Frames {
			if len(f.Tweens) > 0 {
				tween = f.Tweens[0].UUID
			}
		}
	}
	if tween == "" {
		t.Skip("needs a fixture with a tween")
	}
	if err := d.SetTween(tween, TweenEdit{Bezier: []float64{0.4, 0}}); err == nil {
		t.Error("a two-value bezier was accepted")
	}
}

func TestTweensComeBackInPlayheadOrder(t *testing.T) {
	d := openFixture(t, "motion-tween.wick")
	sum, _ := d.Read(0)
	for _, l := range sum.Layers {
		for _, f := range l.Frames {
			ts, err := d.Tweens(f.UUID)
			if err != nil {
				continue
			}
			for i := 1; i < len(ts); i++ {
				if ts[i-1].Playhead > ts[i].Playhead {
					t.Errorf("tweens out of order: %d then %d", ts[i-1].Playhead, ts[i].Playhead)
				}
			}
		}
	}
}

// The root walk has to go project → Clip → Timeline. A reader that iterates the objects map
// sees Selection, and sees every Frame twice.
func TestReadDoesNotSeeEditorState(t *testing.T) {
	d := openFixture(t, "nested-clip.wick")
	var selections int
	for _, v := range d.objects {
		if o, okv := v.(map[string]any); okv && classname(o) == "Selection" {
			selections++
		}
	}
	if selections == 0 {
		t.Skip("this fixture has no Selection to mistake for content")
	}
	sum, err := d.Read(2)
	if err != nil {
		t.Fatal(err)
	}
	for _, l := range sum.Layers {
		for _, f := range l.Frames {
			for _, other := range f.Other {
				if other == "Selection" {
					t.Error("Selection reached the summary as content")
				}
			}
		}
	}
}

func TestServerRootRefusesEscape(t *testing.T) {
	root := t.TempDir()
	sibling := t.TempDir()
	s := &mcpServer{root: root}

	if _, err := s.resolve("fine.wick"); err != nil {
		t.Errorf("a plain relative name was refused: %v", err)
	}
	for _, bad := range []string{
		"../escape.wick",
		"a/../../escape.wick",
		filepath.Join(sibling, "escape.wick"),
		"/etc/passwd",
		root + "-elsewhere/escape.wick",
	} {
		if got, err := s.resolve(bad); err == nil {
			t.Errorf("%q resolved to %q instead of being refused", bad, got)
		}
	}
}

func TestAnEditWillNotGuessWhereToWrite(t *testing.T) {
	d := openFixture(t, "test1.wick")
	s := &mcpServer{root: t.TempDir()}
	if _, err := s.writeTo(d, "", false); err == nil {
		t.Error("an edit with neither out nor in_place picked a destination")
	}
	if _, err := s.writeTo(d, "a.wick", true); err == nil {
		t.Error("out and in_place together were accepted")
	}
	if got, err := s.writeTo(d, "", true); err != nil || got != d.path {
		t.Errorf("in_place wrote to %q (%v)", got, err)
	}
}

func TestSaveKeepsTheOtherZipEntries(t *testing.T) {
	d := openFixture(t, "test1.wick")
	if len(d.others) == 0 {
		t.Skip("this fixture has nothing but project.json")
	}
	out := filepath.Join(t.TempDir(), "kept.wick")
	if err := d.Save(out); err != nil {
		t.Fatal(err)
	}
	back, err := Open(out)
	if err != nil {
		t.Fatal(err)
	}
	if len(back.others) != len(d.others) {
		t.Fatalf("%d entries beside project.json, was %d", len(back.others), len(d.others))
	}
	for i := range d.others {
		if d.others[i].name != back.others[i].name {
			t.Errorf("entry %d is %q, was %q", i, back.others[i].name, d.others[i].name)
		}
	}
}

// snapshot copies the objects map as parsed JSON, so a later comparison sees value changes
// rather than the same pointers on both sides.
func snapshot(t *testing.T, d *Doc) map[string]any {
	t.Helper()
	b, err := json.Marshal(d.objects)
	if err != nil {
		t.Fatal(err)
	}
	var out map[string]any
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatal(err)
	}
	return out
}
