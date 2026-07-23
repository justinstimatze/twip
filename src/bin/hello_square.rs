//! Phase 0: write a red-square-tweening SWF to disk and play it in Ruffle.
//!
//! Usage: `cargo run --bin hello_square [out.swf]` (default: hello_square.swf)

use std::io::Write;

fn main() -> std::io::Result<()> {
    let path = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "hello_square.swf".to_string());
    let bytes = twip::hello_square_swf();
    let mut f = std::fs::File::create(&path)?;
    f.write_all(&bytes)?;
    println!("wrote {} ({} bytes)", path, bytes.len());
    Ok(())
}
