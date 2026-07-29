//! The shape importer, checked against the compiler that produced its input.
//!
//! Compiling a fixture and reading the shapes back is the one test of an importer that needs
//! no committed expectation: the source document already says where every point is, so the
//! recovered geometry can be compared to it rather than to a blessed file that only proves
//! today's output matches today's output.
//!
//! What it does NOT check is anything about timing, tweens, layers or scripts, because the
//! importer does not recover them and pretending otherwise in a test would be the same lie
//! as pretending it in the tool.

use twip::wick::Contour;

/// Bounding box of a ring, in pixels, rounded to the twip the format actually stores.
fn bounds(points: &[(f64, f64)]) -> (i64, i64, i64, i64) {
    let twip = |v: f64| (v * 20.0).round() as i64;
    points.iter().fold(
        (i64::MAX, i64::MAX, i64::MIN, i64::MIN),
        |(x0, y0, x1, y1), &(x, y)| {
            (
                x0.min(twip(x)),
                y0.min(twip(y)),
                x1.max(twip(x)),
                y1.max(twip(y)),
            )
        },
    )
}

fn compile(name: &str) -> Vec<u8> {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("fixtures")
        .join(name);
    let bytes = std::fs::read(&path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
    twip::compile_wick(&bytes).unwrap_or_else(|e| panic!("compile {name}: {e:#}"))
}

/// Every ring the compiler drew comes back, in the same place.
///
/// Compared by bounding box rather than point-for-point: the compiler planarizes holed
/// shapes, so a `CompoundPath` leaves as more rings than it arrived as, and demanding the
/// original vertex list back would be demanding the planarizer be undone. Where the ink
/// landed is the claim the importer actually makes.
#[test]
fn recovers_the_geometry_it_was_given() {
    for name in ["test1.wick", "multi-layer.wick", "brush-donut.wick"] {
        let swf = compile(name);
        let shapes = twip::import::shapes_from_swf(&swf).expect("import");

        assert!(!shapes.is_empty(), "{name}: recovered no shapes at all");

        // The union of everything drawn has to match between the two directions.
        let doc_bytes = std::fs::read(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("fixtures")
                .join(name),
        )
        .unwrap();
        let doc = twip::wick::parse_wick(&doc_bytes).expect("parse");
        let source: Vec<&Contour> = doc
            .layers
            .iter()
            .flat_map(|l| l.frames.iter())
            .flat_map(|f| f.contours.iter())
            .collect();
        assert!(
            !source.is_empty(),
            "{name}: fixture has no contours to check"
        );

        let union = |sets: Vec<(i64, i64, i64, i64)>| {
            sets.into_iter()
                .reduce(|a, b| (a.0.min(b.0), a.1.min(b.1), a.2.max(b.2), a.3.max(b.3)))
                .expect("at least one ring")
        };
        let want = union(source.iter().map(|c| bounds(&c.points)).collect());
        let got = union(shapes.iter().map(|c| bounds(&c.points)).collect());

        // One twip of slack for the pixel-to-twip round trip, and no more.
        for (w, g, side) in [
            (want.0, got.0, "left"),
            (want.1, got.1, "top"),
            (want.2, got.2, "right"),
            (want.3, got.3, "bottom"),
        ] {
            assert!(
                (w - g).abs() <= 1,
                "{name}: {side} edge came back at {g} twips, drawn at {w}"
            );
        }
    }
}

/// Fills survive the trip. Geometry with the wrong colour is the failure that looks like
/// success in a screenshot, and nothing above would catch it.
#[test]
fn recovers_fill_colors() {
    let swf = compile("test1.wick");
    let shapes = twip::import::shapes_from_swf(&swf).expect("import");

    let doc_bytes = std::fs::read(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("fixtures")
            .join("test1.wick"),
    )
    .unwrap();
    let doc = twip::wick::parse_wick(&doc_bytes).expect("parse");

    let mut want: Vec<(u8, u8, u8)> = doc
        .layers
        .iter()
        .flat_map(|l| l.frames.iter())
        .flat_map(|f| f.contours.iter())
        .filter_map(|c| c.fill.as_ref().map(|f| (f.r, f.g, f.b)))
        .collect();
    let mut got: Vec<(u8, u8, u8)> = shapes
        .iter()
        .filter_map(|c| c.fill.as_ref().map(|f| (f.r, f.g, f.b)))
        .collect();
    want.sort_unstable();
    got.sort_unstable();

    assert!(!want.is_empty(), "the fixture has no fills to check");
    assert_eq!(got, want, "recovered fills differ from the ones drawn");
}

/// The SVG is well-formed and carries one path per shape, since the editor's importer turns
/// each `<path>` into one editable paper.js path.
#[test]
fn writes_one_svg_path_per_shape() {
    let swf = compile("multi-layer.wick");
    let svg = twip::import::swf_to_svg(&swf).expect("svg");
    let groups = twip::import::shape_groups_from_swf(&swf).expect("import");

    assert!(svg.starts_with("<svg "), "not an svg document: {:.40}", svg);
    assert!(svg.trim_end().ends_with("</svg>"), "svg is not closed");
    assert_eq!(
        svg.matches("<path ").count(),
        groups.len(),
        "one path per recovered shape"
    );
    assert!(
        svg.contains("viewBox=\"0 0 "),
        "no viewBox, so the editor cannot place it on the stage"
    );
}

/// A hole stays a hole.
///
/// `brush-donut.wick` is a ring: the compiler planarizes it into an outer boundary and an
/// inner one, and SWF renders the middle empty because winding is evaluated across the whole
/// shape. Emitting those two rings as two `<path>` elements paints the inner one solid and
/// the donut arrives as a disc — geometry perfectly correct, picture wrong, and no assertion
/// about points or colours would notice.
#[test]
fn a_hole_survives_as_one_path() {
    let swf = compile("brush-donut.wick");
    let groups = twip::import::shape_groups_from_swf(&swf).expect("import");

    let holed = groups
        .iter()
        .find(|rings| rings.len() > 1)
        .expect("the donut should recover as one shape holding more than one ring");

    let svg = twip::import::swf_to_svg(&swf).expect("svg");
    let path = svg
        .lines()
        .find(|l| l.matches('M').count() > 1)
        .expect("no path carries a second subpath, so the hole was split into its own shape");
    assert_eq!(
        path.matches('M').count(),
        holed.len(),
        "the shape's rings should be subpaths of one path"
    );
    assert!(
        path.contains("fill-rule=\"nonzero\""),
        "without an explicit fill-rule the hole is at the renderer's discretion"
    );
}

/// A curve arrives as a curve. The fixtures are all straight-edged, so this builds the one
/// case that is not: without the quadratic sampler, a `CurvedEdge` contributes a single
/// straight segment and the arc silently flattens to its chord.
#[test]
fn samples_curved_edges() {
    use swf::{
        Fixed8, Header, PointDelta, Rectangle, Shape, ShapeFlag, ShapeRecord, ShapeStyles,
        StyleChangeData, Twips,
    };

    let sq = |v: f64| Twips::from_pixels(v);
    let shape = Shape {
        version: 4,
        id: 1,
        shape_bounds: Rectangle {
            x_min: sq(0.0),
            x_max: sq(100.0),
            y_min: sq(0.0),
            y_max: sq(100.0),
        },
        edge_bounds: Rectangle {
            x_min: sq(0.0),
            x_max: sq(100.0),
            y_min: sq(0.0),
            y_max: sq(100.0),
        },
        flags: ShapeFlag::HAS_SCALING_STROKES,
        styles: ShapeStyles {
            fill_styles: vec![swf::FillStyle::Color(swf::Color::from_rgb(0xff0000, 255))],
            line_styles: vec![],
        },
        shape: vec![
            ShapeRecord::StyleChange(Box::new(StyleChangeData {
                move_to: Some(swf::Point::new(sq(0.0), sq(0.0))),
                fill_style_0: None,
                fill_style_1: Some(1),
                line_style: None,
                new_styles: None,
            })),
            // One quadratic arcing out to (100, 0) via a control point at (100, 100).
            ShapeRecord::CurvedEdge {
                control_delta: PointDelta::new(sq(100.0), sq(100.0)),
                anchor_delta: PointDelta::new(sq(0.0), sq(-100.0)),
            },
        ],
    };

    let header = Header {
        compression: swf::Compression::None,
        version: 8,
        stage_size: Rectangle {
            x_min: sq(0.0),
            x_max: sq(200.0),
            y_min: sq(0.0),
            y_max: sq(200.0),
        },
        frame_rate: Fixed8::from_f64(12.0),
        num_frames: 1,
    };
    let mut bytes = Vec::new();
    swf::write_swf(
        &header,
        &[swf::Tag::DefineShape(Box::new(shape)), swf::Tag::ShowFrame],
        &mut bytes,
    )
    .expect("write");

    let shapes = twip::import::shapes_from_swf(&bytes).expect("import");
    assert_eq!(shapes.len(), 1, "one ring");
    let points = &shapes[0].points;
    assert!(
        points.len() > 10,
        "a curve flattened to {} points, which is the chord rather than the arc",
        points.len()
    );

    // The apex of this quadratic sits at t=0.5 → (50, 50). A chord would pass through
    // (50, 0), so the bulge is the whole assertion.
    let peak = points.iter().fold(0.0_f64, |m, &(_, y)| m.max(y));
    assert!(
        (peak - 50.0).abs() < 1.0,
        "curve peaks at y={peak:.2}, expected 50 — the control point is being ignored"
    );
}
