//! twip CLI. Phase 1: `twip <in.wick> <out.swf>` compiles a Wick document to SWF.

use anyhow::{Context, Result};

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();

    // Dispatch before parsing options, so a subcommand's flags reach it. Parsing first meant
    // this loop rejected `--frame` as unknown before `import` ever ran.
    if args.first().is_some_and(|a| a == "import") {
        return import(&args[1..]);
    }

    let mut opts = twip::Options::default();
    let mut positional: Vec<String> = Vec::new();
    for arg in args {
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
            "twip {} — usage:\n  \
             twip [--no-upsample] <in.wick> [out.swf]    compile\n  \
             twip import [--frame N] <in.swf> [out.svg]  recover the artwork",
            twip::version()
        );
        return Ok(());
    };
    let output = positional
        .get(1)
        .cloned()
        .unwrap_or_else(|| "out.swf".to_string());

    let wick_bytes = std::fs::read(input).with_context(|| format!("read {input}"))?;
    let (swf, skipped) = twip::compile_wick_reporting(&wick_bytes, &opts)
        .with_context(|| format!("compile {input}"))?;
    std::fs::write(&output, &swf).with_context(|| format!("write {output}"))?;

    println!("compiled {} -> {} ({} bytes)", input, output, swf.len());
    // On stderr, so a script piping the success line still gets one line, and so this reads
    // as the warning it is. Not an error: the movie is fine, it is just smaller than the
    // document — and refusing to compile a project because one title card cannot come along
    // would be the worse of the two failures.
    // `describe` names what was actually left behind, and since scripts started reporting a
    // reason it says why too. The list of unsupported features that used to hang off the end
    // here named gradients for a week after they gained a reader — a second copy of that list,
    // maintained by remembering to.
    if !skipped.is_empty() {
        eprintln!("warning: {} not in the movie", skipped.describe());
    }
    Ok(())
}

/// `twip import <in.swf> [out.svg]` — pull the artwork out of an SWF.
///
/// Says what it did not recover, every time. Someone reaching for this wants their old
/// Flash back, and the gap between "the drawings" and "the movie" is the whole difference
/// between a useful tool and a disappointing one; leaving it to be discovered is worse than
/// a line of output.
fn import(args: &[String]) -> Result<()> {
    // `--frame N` picks one moment; without it every drawing the movie ever places comes
    // back at once, which is what you want from an animation and not from a movie that
    // shows different things at different times.
    let mut at = twip::import::At::WholeMovie;
    let mut positional: Vec<&String> = Vec::new();
    let mut rest = args.iter();
    while let Some(arg) = rest.next() {
        match arg.as_str() {
            "--frame" => {
                let n = rest
                    .next()
                    .context("--frame needs a frame number")?
                    .parse::<u16>()
                    .context("--frame takes a whole frame number, 1 or greater")?;
                if n == 0 {
                    anyhow::bail!("frames are numbered from 1");
                }
                at = twip::import::At::Frame(n);
            }
            other if other.starts_with("--") => anyhow::bail!("unknown option {other}"),
            _ => positional.push(arg),
        }
    }

    let Some(input) = positional.first() else {
        println!("usage: twip import [--frame N] <in.swf> [out.svg]");
        return Ok(());
    };
    let output = positional
        .get(1)
        .map(|s| s.to_string())
        .unwrap_or_else(|| "out.svg".to_string());

    let swf_bytes = std::fs::read(input).with_context(|| format!("read {input}"))?;
    let groups = twip::import::shape_groups_from_swf(&swf_bytes, at)
        .with_context(|| format!("read {input}"))?;
    let (width, height) = twip::import::stage_size(&swf_bytes)?;
    let svg = twip::import::contours_to_svg(&groups, width, height);
    std::fs::write(&output, &svg).with_context(|| format!("write {output}"))?;

    let rings: usize = groups.iter().map(Vec::len).sum();
    let when = match at {
        twip::import::At::WholeMovie => "every frame".to_string(),
        twip::import::At::Frame(n) => format!("frame {n}"),
    };
    println!(
        "recovered {} shapes ({rings} rings) from {when} of {} -> {}",
        groups.len(),
        input,
        output
    );
    println!("artwork only — timing, tweens, layers and scripts are not recovered.");
    if at == twip::import::At::WholeMovie {
        println!("everything the movie ever draws, at once. --frame N for one moment instead.");
    }
    println!("open it by dragging {output} onto the editor canvas.");
    Ok(())
}
