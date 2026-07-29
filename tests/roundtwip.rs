//! Round-trip oracle — compile a fixture, read the SWF back, and check the timeline it
//! actually shows against the document that produced it.
//!
//! The other test layers assert properties someone thought to write down: this tag count,
//! that matrix, this depth. They are sharp and they are also a list, and a list only covers
//! what is on it. This runs the same handful of structural laws over every fixture in the
//! tree, in both compile modes, so a fixture added later is covered by writing no test at
//! all — which is the whole reason to have it.
//!
//! It reads the display list rather than reconstructing a `Document`, because a `Document` is
//! not recoverable. The compiler turns one tween into a hundred-odd matrices and there is no
//! honest way back: recovering "linear x 90->460, out-bounce, 24 frames" from those matrices
//! is curve fitting, and a wrong fit reads as a real failure. What IS exactly recoverable is
//! what the movie puts on screen at each frame, so that is what gets checked, against the
//! numbers the document states directly — its tween keys and its frame boundaries.
//!
//! Nothing here recomputes `upsample_factor`. The factor is read back out of the header and
//! everything else is checked for consistency with it, so this stays an independent account
//! of the output rather than a second copy of the compiler's arithmetic.

use std::collections::{BTreeMap, BTreeSet};

use swf::{Matrix, PlaceObjectAction, Tag, Twips};
use twip::wick::{Document, Layer};

/// Every fixture in the tree. Listed rather than globbed so a deleted one fails the build
/// instead of quietly shrinking the suite.
const FIXTURES: &[&str] = &[
    "brush-donut.wick",
    "clip-click.wick",
    "editor-tween.wick",
    "frame-by-frame.wick",
    "frame-stop.wick",
    "motion-tween.wick",
    "multi-layer.wick",
    "nested-clip.wick",
    "skew-tween.wick",
    "test1.wick",
];

/// What sits at one depth at one instant.
#[derive(Clone, PartialEq)]
struct Cell {
    id: u16,
    matrix: Option<Matrix>,
}

/// The display list as the player sees it: one snapshot per `ShowFrame`.
///
/// Replaying is the only way to ask "what is on screen at frame 40". The tags say
/// *changes* — place this, modify that, remove the other — and a frame's content is every
/// change up to its `ShowFrame` and none after.
fn replay(tags: &[Tag]) -> Result<Replayed, String> {
    let mut live: BTreeMap<u16, Cell> = BTreeMap::new();
    let mut frames = Vec::new();
    let mut scripts = Vec::new();

    for tag in tags {
        match tag {
            Tag::PlaceObject(po) => match po.action {
                PlaceObjectAction::Place(id) => {
                    live.insert(
                        po.depth,
                        Cell {
                            id,
                            matrix: po.matrix,
                        },
                    );
                }
                PlaceObjectAction::Modify => {
                    // A Modify names no character; it edits whatever is already at that
                    // depth. With nothing there it is not an error the parser can see — the
                    // tag is well-formed — and the player simply draws nothing where the
                    // animation should be.
                    let Some(cell) = live.get_mut(&po.depth) else {
                        return Err(format!(
                            "frame {}: Modify at depth {} with nothing placed there",
                            frames.len() + 1,
                            po.depth
                        ));
                    };
                    if po.matrix.is_some() {
                        cell.matrix = po.matrix;
                    }
                }
                PlaceObjectAction::Replace(id) => {
                    live.insert(
                        po.depth,
                        Cell {
                            id,
                            matrix: po.matrix,
                        },
                    );
                }
            },
            Tag::RemoveObject(ro) => {
                if live.remove(&ro.depth).is_none() {
                    return Err(format!(
                        "frame {}: RemoveObject at empty depth {}",
                        frames.len() + 1,
                        ro.depth
                    ));
                }
            }
            // A DoAction runs on the frame whose ShowFrame follows it, so its frame number is
            // one past however many have gone by.
            Tag::DoAction(_) => scripts.push(frames.len() + 1),
            Tag::ShowFrame => frames.push(live.clone()),
            _ => {}
        }
    }
    Ok(Replayed { frames, scripts })
}

struct Replayed {
    frames: Vec<BTreeMap<u16, Cell>>,
    /// 1-based movie frame of each `DoAction`.
    scripts: Vec<usize>,
}

/// The last document frame any layer reaches.
fn doc_span(doc: &Document) -> usize {
    doc.layers
        .iter()
        .flat_map(|l| l.frames.iter())
        .map(|f| f.end as usize)
        .max()
        .unwrap_or(1)
        .max(1)
}

/// Document frame `d` starts at this movie frame, 1-based, given a factor of `k`.
fn group_start(d: usize, k: usize) -> usize {
    (d - 1) * k + 1
}

struct Movie {
    frames: Vec<BTreeMap<u16, Cell>>,
    /// Movie frames per document frame, read out of the header rather than recomputed.
    k: usize,
    /// 1-based movie frame of each `DoAction`.
    scripts: Vec<usize>,
}

fn compile_and_replay(doc: &Document, upsample: bool) -> Movie {
    let swf = twip::compile_document_with(doc, &twip::Options { upsample }).expect("compile");
    let buf = swf::decompress_swf(&swf[..]).expect("decompress");
    let parsed = swf::parse_swf(&buf).expect("parse");

    let rate = f64::from(parsed.header.frame_rate().to_f32());
    let ratio = rate / doc.framerate;
    assert!(
        (ratio - ratio.round()).abs() < 1e-6 && ratio >= 1.0,
        "the header rate has to be a whole multiple of the document's: {rate} / {} = {ratio}",
        doc.framerate
    );
    assert!(
        rate <= 60.0 + 1e-6 || doc.framerate > 60.0,
        "upsampling must never ask for more than 60fps: got {rate}"
    );
    let k = ratio.round() as usize;
    assert_eq!(
        k,
        if upsample { k } else { 1 },
        "upsampling off must leave the rate alone"
    );

    let played = replay(&parsed.tags).expect("the emitted display list replays cleanly");
    assert_eq!(
        played.frames.len(),
        doc_span(doc) * k,
        "one movie frame per document frame per factor"
    );
    // The header states a count and the tag stream contains one. A player trusts the header,
    // so the two disagreeing means it stops early or waits on a frame that never comes — and
    // the stream on its own looks perfectly well-formed either way.
    assert_eq!(
        parsed.header.num_frames() as usize,
        played.frames.len(),
        "the header's frame count has to be the number of frames actually emitted"
    );

    // Every frame script has to sit on the first movie frame of the document frame that owns
    // it. Landing anywhere else inside the group still runs the script, one to four frames
    // off — invisible to a count, and the failure mode a remap of the frame-command keys
    // produces when it uses the wrong one of the two formulas.
    for &f in &played.scripts {
        assert_eq!(
            (f - 1) % k,
            0,
            "a script runs at movie frame {f}, which is {} frames into a group of {k}",
            (f - 1) % k
        );
    }

    Movie {
        frames: played.frames,
        k,
        scripts: played.scripts,
    }
}

/// Within one document frame's group of movie frames the *cast* is fixed: upsampling
/// resamples transforms, it does not swap drawings. A cel that changed a third of the way
/// through its own hold would be a new kind of wrong, invisible to every count-based
/// assertion in the suite, and it is what a sloppy remap of the frame boundaries produces.
fn cast_holds_within_each_group(movie: &Movie, doc: &Document, what: &str) -> usize {
    let ids = |f: &BTreeMap<u16, Cell>| -> BTreeSet<(u16, u16)> {
        f.iter().map(|(d, c)| (*d, c.id)).collect()
    };
    let mut checked = 0;
    for d in 1..=doc_span(doc) {
        let start = group_start(d, movie.k);
        let first = ids(&movie.frames[start - 1]);
        for sub in 1..movie.k {
            assert_eq!(
                ids(&movie.frames[start - 1 + sub]),
                first,
                "{what}: document frame {d} swaps a drawing {sub} movie frames into its own hold"
            );
            checked += 1;
        }
    }
    checked
}

/// Every tween key names a document frame and a transform. Whatever else the interior does,
/// the frame that key names has to be showing that transform — which is the one claim that
/// pins the frame remap against the document's own numbers instead of against the compiler's.
fn tween_keys_land_on_their_frames(movie: &Movie, doc: &Document, what: &str) -> usize {
    let close = |a: Twips, b: Twips| (a.get() - b.get()).abs() <= 1;
    let mut checked = 0;
    for layer in &doc.layers {
        for frame in &layer.frames {
            for key in &frame.tweens {
                let at = group_start(key.playhead as usize, movie.k);
                assert!(
                    at <= movie.frames.len(),
                    "{what}: tween key at playhead {} is past the end of the movie",
                    key.playhead
                );
                let want = key.transform.matrix();
                let found = movie.frames[at - 1].values().any(|c| {
                    c.matrix.is_some_and(|m| {
                        close(m.tx, want.tx)
                            && close(m.ty, want.ty)
                            && (m.a.to_f64() - want.a.to_f64()).abs() < 1e-3
                            && (m.b.to_f64() - want.b.to_f64()).abs() < 1e-3
                    })
                });
                assert!(
                    found,
                    "{what}: nothing at movie frame {at} matches the tween key at playhead {} \
                     (x {}, y {}) — the key's own frame is showing something else",
                    key.playhead, key.transform.x, key.transform.y
                );
                checked += 1;
            }
        }
    }
    checked
}

/// A document frame that draws something must put something on screen. An empty snapshot
/// where the document has contours is a whole layer dropped, which every count assertion
/// in the suite would report as a smaller number rather than as nothing being there.
fn drawn_frames_are_not_empty(movie: &Movie, doc: &Document, what: &str) {
    let draws_at = |layer: &Layer, d: u16| {
        layer
            .frames
            .iter()
            .any(|f| f.start <= d && d <= f.end && !(f.contours.is_empty() && f.clips.is_empty()))
    };
    for d in 1..=doc_span(doc) {
        if !doc.layers.iter().any(|l| draws_at(l, d as u16)) {
            continue;
        }
        let start = group_start(d, movie.k);
        assert!(
            !movie.frames[start - 1].is_empty(),
            "{what}: document frame {d} draws something, movie frame {start} shows nothing"
        );
    }
}

#[test]
fn every_fixture_round_trips() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let (mut groups, mut keys) = (0usize, 0usize);
    for name in FIXTURES {
        let bytes = std::fs::read(root.join("fixtures").join(name))
            .unwrap_or_else(|e| panic!("read fixture {name}: {e}"));
        let doc = twip::wick::parse_wick(&bytes).unwrap_or_else(|e| panic!("parse {name}: {e:#}"));

        // Both modes, because the remap is the thing under test and the flat build is the
        // control: any law that holds at k=1 and breaks at k=5 is the upsampler's doing.
        let mut both = Vec::new();
        for upsample in [false, true] {
            let what = format!("{name} (upsample {})", if upsample { "on" } else { "off" });
            let movie = compile_and_replay(&doc, upsample);
            assert!(!movie.frames.is_empty(), "{what}: no frames at all");
            groups += cast_holds_within_each_group(&movie, &doc, &what);
            keys += tween_keys_land_on_their_frames(&movie, &doc, &what);
            drawn_frames_are_not_empty(&movie, &doc, &what);
            both.push(movie);
        }

        // The flat build is the control. Upsampling changes how often the movie is sampled
        // and nothing else, so the *document* frame each script runs on has to survive it —
        // and that number is recoverable from either build without asking the compiler.
        let doc_frames =
            |m: &Movie| -> Vec<usize> { m.scripts.iter().map(|f| (f - 1) / m.k + 1).collect() };
        assert_eq!(
            doc_frames(&both[0]),
            doc_frames(&both[1]),
            "{name}: upsampling moved a script to a different document frame"
        );
    }

    // A law nothing exercises is a law that passes. Both of these loop over data that could
    // shrink to nothing without anything else here noticing — the group walk does nothing at
    // all when k is 1, and the key walk does nothing on the seven fixtures with no tween. The
    // floors are what the tree holds today: 404 sub-frame comparisons and 12 keys, across
    // three tweened fixtures in two modes. Falling below either means the oracle stopped
    // watching, and that is a failure whether or not the compiler broke.
    assert!(
        groups >= 404,
        "only {groups} within-group comparisons — the suite is checking less than it did"
    );
    assert!(
        keys >= 12,
        "only {keys} tween keys checked — the suite is checking less than it did"
    );
}
