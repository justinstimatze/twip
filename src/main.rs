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

    let Some(first) = positional.first() else {
        println!(
            "twip {} — usage:\n  \
             twip [--no-upsample] <in.wick> [out.swf]   compile\n  \
             twip import <in.swf> [out.svg]             recover the artwork",
            twip::version()
        );
        return Ok(());
    };

    if first == "import" {
        return import(&positional[1..]);
    }
    let input = first;
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

/// `twip import <in.swf> [out.svg]` — pull the artwork out of an SWF.
///
/// Says what it did not recover, every time. Someone reaching for this wants their old
/// Flash back, and the gap between "the drawings" and "the movie" is the whole difference
/// between a useful tool and a disappointing one; leaving it to be discovered is worse than
/// a line of output.
fn import(args: &[String]) -> Result<()> {
    let Some(input) = args.first() else {
        println!("usage: twip import <in.swf> [out.svg]");
        return Ok(());
    };
    let output = args
        .get(1)
        .cloned()
        .unwrap_or_else(|| "out.svg".to_string());

    let swf_bytes = std::fs::read(input).with_context(|| format!("read {input}"))?;
    let groups =
        twip::import::shape_groups_from_swf(&swf_bytes).with_context(|| format!("read {input}"))?;
    let (width, height) = twip::import::stage_size(&swf_bytes)?;
    let svg = twip::import::contours_to_svg(&groups, width, height);
    std::fs::write(&output, &svg).with_context(|| format!("write {output}"))?;

    let rings: usize = groups.iter().map(Vec::len).sum();
    println!(
        "recovered {} shapes ({rings} rings) from {} -> {}",
        groups.len(),
        input,
        output
    );
    println!("artwork only — timing, tweens, layers and scripts are not recovered.");
    println!("open it by dragging {output} onto the editor canvas.");
    Ok(())
}
