//! Phase 1b visual check: a synthetic frame-by-frame flipbook (no .wick needed).
//! A red square steps through four positions, each keyframe held for 12 frames.
//!
//! Usage: `cargo run --bin flipbook_demo [out.swf]` (default: flipbook.swf)

use std::io::Write;
use swf::Color;
use twip::wick::{Contour, Document, Frame, Layer};

fn square(x: f64, y: f64, side: f64) -> Contour {
    Contour {
        points: vec![(x, y), (x + side, y), (x + side, y + side), (x, y + side)],
        fill: Color::from_rgb(0xff0000, 255),
    }
}

fn main() -> std::io::Result<()> {
    let path = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "flipbook.swf".to_string());

    let xs = [40.0, 200.0, 360.0, 470.0];
    let frames: Vec<Frame> = xs
        .iter()
        .enumerate()
        .map(|(i, &x)| {
            let start = (i as u16) * 12 + 1;
            Frame {
                start,
                end: start + 11,
                contours: vec![square(x, 180.0, 40.0)],
            }
        })
        .collect();

    let doc = Document {
        width: 550.0,
        height: 400.0,
        layers: vec![Layer { frames }],
    };

    let bytes = twip::compile_document(&doc).expect("compile flipbook document");
    std::fs::File::create(&path)?.write_all(&bytes)?;
    println!("wrote {} ({} bytes)", path, bytes.len());
    Ok(())
}
