//! Read the shapes back out of an SWF.
//!
//! Deliberately one direction and one kind of thing: **artwork**. Timing, tween keys,
//! easing, layer structure and scripts are not recovered and are not attempted. A tween is
//! compiled down to a matrix per frame, and inferring "linear x 90 to 460, out-bounce, over
//! 24 frames" back out of a hundred matrices is curve fitting — a wrong fit reads as a real
//! answer, which is worse than no answer. What survives compilation exactly is the geometry,
//! so that is what comes back.
//!
//! The output is SVG rather than `.wick`, because the editor already ingests SVG
//! (`engine/src/base/asset/SVGAsset.js`, droppable onto the canvas) and writing a second
//! `.wick` serializer to reach the same place would be the larger and more fragile half.
//!
//! **Where this is approximate, and it is worth knowing before trusting it.** An SWF shape
//! is an edge stream with a fill on each side of every edge — `fill_style_0` to the left,
//! `fill_style_1` to the right — so two regions that touch share one run of edges and are
//! recovered by resolving those references into closed areas. This walks the pen instead,
//! taking each `move_to` as the start of a ring and each ring's declared right-hand fill as
//! its fill. For art drawn as separate closed shapes, which is most art, the two agree. For
//! shapes that share edges between differently-filled regions, the geometry is right and the
//! fills can be wrong.

use anyhow::{Context, Result};
use swf::{FillStyle, LineCapStyle, LineJoinStyle, LineStyle, ShapeRecord, Twips};

use crate::wick::{Contour, Stroke, StrokeCap, StrokeJoin};

/// One recovered ring: its points in pixels, and what it was painted with.
fn ring_to_contour(
    points: Vec<(f64, f64)>,
    fill: Option<swf::Color>,
    stroke: Option<Stroke>,
) -> Contour {
    Contour {
        points,
        holes: vec![],
        // Every ring in a fill is closed; a bare stroke may be an open path, but the record
        // stream does not say which, and closing an open stroke is the visible error while
        // leaving a fill open is not.
        closed: fill.is_some(),
        fill,
        stroke,
    }
}

/// How finely to chop a quadratic curve. SWF curves are quadratic beziers and `Contour`
/// holds straight segments, so they have to be sampled. Sixteen keeps a full circle's worth
/// of curves under a twip of error at the sizes a stage holds, and the editor can always
/// simplify afterwards.
const CURVE_STEPS: usize = 16;

/// Sample a quadratic bezier, skipping t=0 because the caller already has that point.
fn flatten_quadratic(
    from: (f64, f64),
    ctrl: (f64, f64),
    to: (f64, f64),
    out: &mut Vec<(f64, f64)>,
) {
    for step in 1..=CURVE_STEPS {
        let t = step as f64 / CURVE_STEPS as f64;
        let inv = 1.0 - t;
        out.push((
            inv * inv * from.0 + 2.0 * inv * t * ctrl.0 + t * t * to.0,
            inv * inv * from.1 + 2.0 * inv * t * ctrl.1 + t * t * to.1,
        ));
    }
}

/// Walk one shape's record stream into rings.
fn shape_to_contours(
    records: &[ShapeRecord],
    fills: &[FillStyle],
    lines: &[LineStyle],
) -> Vec<Contour> {
    let px = |t: Twips| t.to_pixels();
    // 1-based into the style tables, and 0 means "none" — the one indexing rule in the
    // format that silently produces a wrong colour rather than an error if you get it wrong.
    let fill_at = |idx: Option<u32>| -> Option<swf::Color> {
        let i = idx?;
        match fills.get(i.checked_sub(1)? as usize)? {
            FillStyle::Color(c) => Some(*c),
            // Gradients and bitmaps have no Contour equivalent; the ring keeps its geometry
            // and loses its paint rather than being dropped.
            _ => None,
        }
    };
    let line_at = |idx: Option<u32>| -> Option<Stroke> {
        let i = idx?;
        let ls = lines.get(i.checked_sub(1)? as usize)?;
        // A stroke can be painted with any fill style; only a flat colour has a `Stroke`
        // equivalent, so a gradient-stroked ring keeps its geometry and loses its stroke.
        let color = match ls.fill_style() {
            FillStyle::Color(c) => *c,
            _ => return None,
        };
        Some(Stroke {
            color,
            width: ls.width().to_pixels(),
            cap: match ls.start_cap() {
                LineCapStyle::Round => StrokeCap::Round,
                LineCapStyle::Square => StrokeCap::Square,
                LineCapStyle::None => StrokeCap::Butt,
            },
            join: match ls.join_style() {
                LineJoinStyle::Round => StrokeJoin::Round,
                LineJoinStyle::Bevel => StrokeJoin::Bevel,
                LineJoinStyle::Miter(_) => StrokeJoin::Miter,
            },
            miter_limit: match ls.join_style() {
                LineJoinStyle::Miter(limit) => limit.to_f64(),
                _ => 4.0,
            },
        })
    };

    let mut out = Vec::new();
    let mut pen = (0.0_f64, 0.0_f64);
    let mut ring: Vec<(f64, f64)> = Vec::new();
    // Style *indices*, resolved only when a ring is emitted. The record stream declares
    // indices and a later record can change them mid-ring, so the pair in force at the end
    // of a ring is the pair that painted it.
    let (mut fill_idx, mut line_idx) = (None, None);

    // A ring ends where the next one begins, and at the end of the stream. Anything with
    // fewer than two points drew nothing.
    let mut flush = |ring: &mut Vec<(f64, f64)>, f: Option<u32>, l: Option<u32>| {
        if ring.len() >= 2 {
            out.push(ring_to_contour(
                std::mem::take(ring),
                fill_at(f),
                line_at(l),
            ));
        } else {
            ring.clear();
        }
    };

    for record in records {
        match record {
            ShapeRecord::StyleChange(sc) => {
                if let Some(mv) = sc.move_to {
                    flush(&mut ring, fill_idx, line_idx);
                    pen = (px(mv.x), px(mv.y));
                    ring.push(pen);
                }
                if sc.fill_style_1.is_some() {
                    fill_idx = sc.fill_style_1;
                } else if sc.fill_style_0.is_some() {
                    // Only the left-hand fill was declared, so that is what this run paints.
                    fill_idx = sc.fill_style_0;
                }
                if sc.line_style.is_some() {
                    line_idx = sc.line_style;
                }
            }
            ShapeRecord::StraightEdge { delta } => {
                if ring.is_empty() {
                    ring.push(pen);
                }
                pen = (pen.0 + px(delta.dx), pen.1 + px(delta.dy));
                ring.push(pen);
            }
            ShapeRecord::CurvedEdge {
                control_delta,
                anchor_delta,
            } => {
                if ring.is_empty() {
                    ring.push(pen);
                }
                let ctrl = (pen.0 + px(control_delta.dx), pen.1 + px(control_delta.dy));
                let to = (ctrl.0 + px(anchor_delta.dx), ctrl.1 + px(anchor_delta.dy));
                flatten_quadratic(pen, ctrl, to, &mut ring);
                pen = to;
            }
        }
    }
    flush(&mut ring, fill_idx, line_idx);
    out
}

/// Every shape in an SWF, each as its own list of rings.
///
/// The grouping is load-bearing rather than tidiness. A shape with a hole is one shape
/// holding two rings, and SWF renders the hole empty because winding is evaluated across the
/// whole shape. Flatten the groups and the hole becomes a second, separately-painted ring
/// that fills itself in — a donut arrives as a disc.
pub fn shape_groups_from_swf(swf_bytes: &[u8]) -> Result<Vec<Vec<Contour>>> {
    let buf = swf::decompress_swf(swf_bytes).context("decompress swf")?;
    let parsed = swf::parse_swf(&buf).context("parse swf")?;

    let mut out = Vec::new();
    for tag in &parsed.tags {
        if let swf::Tag::DefineShape(shape) = tag {
            let rings = shape_to_contours(
                &shape.shape,
                &shape.styles.fill_styles,
                &shape.styles.line_styles,
            );
            if !rings.is_empty() {
                out.push(rings);
            }
        }
    }
    Ok(out)
}

/// Every ring in an SWF, in the order its shapes were defined, with the grouping dropped.
/// For counting and measuring; use `shape_groups_from_swf` to draw them.
pub fn shapes_from_swf(swf_bytes: &[u8]) -> Result<Vec<Contour>> {
    Ok(shape_groups_from_swf(swf_bytes)?
        .into_iter()
        .flatten()
        .collect())
}

/// The stage size an SWF declares, in pixels.
pub fn stage_size(swf_bytes: &[u8]) -> Result<(f64, f64)> {
    let buf = swf::decompress_swf(swf_bytes).context("decompress swf")?;
    let parsed = swf::parse_swf(&buf).context("parse swf")?;
    let r = &parsed.header.stage_size();
    Ok((
        (r.x_max - r.x_min).to_pixels(),
        (r.y_max - r.y_min).to_pixels(),
    ))
}

fn svg_color(c: &swf::Color) -> String {
    format!("#{:02x}{:02x}{:02x}", c.r, c.g, c.b)
}

/// Render recovered shapes as a standalone SVG.
///
/// One `<path>` per *shape*, with a subpath per ring, so `fill-rule="nonzero"` decides the
/// interior the same way SWF's winding does and a hole stays a hole. Opacity rides on
/// `fill-opacity` rather than in the colour, since the editor reads the two separately.
pub fn contours_to_svg(groups: &[Vec<Contour>], width: f64, height: f64) -> String {
    let mut svg = format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{width}\" height=\"{height}\" \
         viewBox=\"0 0 {width} {height}\">\n"
    );
    for rings in groups {
        let drawn: Vec<&Contour> = rings.iter().filter(|c| !c.points.is_empty()).collect();
        let Some(first) = drawn.first() else { continue };

        let mut d = String::new();
        for ring in &drawn {
            for (i, &(x, y)) in ring.points.iter().enumerate() {
                if !d.is_empty() {
                    d.push(' ');
                }
                d.push_str(&format!("{}{x:.3} {y:.3}", if i == 0 { "M" } else { "L" }));
            }
            if ring.closed {
                d.push_str(" Z");
            }
        }

        // The rings of one shape share its paint; the first ring's is the shape's.
        let fill = match &first.fill {
            Some(c) => format!(
                " fill=\"{}\" fill-opacity=\"{:.3}\" fill-rule=\"nonzero\"",
                svg_color(c),
                f64::from(c.a) / 255.0
            ),
            None => " fill=\"none\"".to_string(),
        };
        let stroke = match &first.stroke {
            Some(s) => format!(
                " stroke=\"{}\" stroke-opacity=\"{:.3}\" stroke-width=\"{:.3}\"",
                svg_color(&s.color),
                f64::from(s.color.a) / 255.0,
                s.width
            ),
            None => String::new(),
        };
        svg.push_str(&format!("  <path d=\"{d}\"{fill}{stroke}/>\n"));
    }
    svg.push_str("</svg>\n");
    svg
}

/// `.swf` bytes in, SVG text out.
pub fn swf_to_svg(swf_bytes: &[u8]) -> Result<String> {
    let (width, height) = stage_size(swf_bytes)?;
    let groups = shape_groups_from_swf(swf_bytes)?;
    Ok(contours_to_svg(&groups, width, height))
}
