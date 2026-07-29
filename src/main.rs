//! twip CLI. Phase 1: `twip <in.wick> <out.swf>` compiles a Wick document to SWF.

use anyhow::{Context, Result};

fn main() -> Result<()> {
    let mut opts = twip::Options::default();
    let mut positional: Vec<String> = Vec::new();
    for arg in std::env::args().skip(1) {
        match arg.as_str() {
            "--no-upsample" => opts.upsample = false,
            // A mistyped flag has to be loud. Falling through to the positional list would
            // make `--no-upsampling` compile happily, with upsampling still on.
            other if other.starts_with("--") => anyhow::bail!("unknown option {other}"),
            _ => positional.push(arg),
        }
    }

    let Some(input) = positional.first() else {
        println!(
            "twip {} — usage: twip [--no-upsample] <in.wick> [out.swf]",
            twip::version()
        );
        return Ok(());
    };
    let output = positional
        .get(1)
        .cloned()
        .unwrap_or_else(|| "out.swf".to_string());

    let wick_bytes = std::fs::read(input).with_context(|| format!("read {input}"))?;
    let swf =
        twip::compile_wick_with(&wick_bytes, &opts).with_context(|| format!("compile {input}"))?;
    std::fs::write(&output, &swf).with_context(|| format!("write {output}"))?;

    println!("compiled {} -> {} ({} bytes)", input, output, swf.len());
    Ok(())
}
