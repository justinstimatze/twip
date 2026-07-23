//! twip CLI. Phase 1: `twip <in.wick> <out.swf>` compiles a Wick document to SWF.

use anyhow::{Context, Result};

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let Some(input) = args.get(1) else {
        println!("twip {} — usage: twip <in.wick> [out.swf]", twip::version());
        return Ok(());
    };
    let output = args
        .get(2)
        .cloned()
        .unwrap_or_else(|| "out.swf".to_string());

    let wick_bytes = std::fs::read(input).with_context(|| format!("read {input}"))?;
    let swf = twip::compile_wick(&wick_bytes).with_context(|| format!("compile {input}"))?;
    std::fs::write(&output, &swf).with_context(|| format!("write {output}"))?;

    println!("compiled {} -> {} ({} bytes)", input, output, swf.len());
    Ok(())
}
