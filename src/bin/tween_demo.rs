//! Phase 1c visual check: a baked motion tween (slide + scale + rotate + fade),
//! no `.wick` needed. Verifies matrix + CXFORM interpolation renders in Ruffle.
//!
//! Usage: `cargo run --bin tween_demo [out.swf]` (default: tween.swf)

use std::io::Write;

fn main() -> std::io::Result<()> {
    let path = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "tween.swf".to_string());
    let bytes = twip::tween_demo_swf();
    std::fs::File::create(&path)?.write_all(&bytes)?;
    println!("wrote {} ({} bytes)", path, bytes.len());
    Ok(())
}
