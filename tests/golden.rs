//! Ruffle golden-PNG oracle. Renders each fixture's twip-compiled SWF through
//! ruffle's `exporter` under lavapipe (deterministic software Vulkan) and compares
//! the result to a committed golden PNG. This is test layer 3 from docs/testing.md's oracle
//! design — it catches *rendering* regressions the structural oracle can't see
//! (planarized fills, winding, layer order) without the AA-noise blindness of a
//! cross-renderer diff.
//!
//! Gated behind the `golden` feature so the ~30-min ruffle build never gates a
//! normal `cargo test` / pre-commit / fast CI run:
//!
//!   bash scripts/oracle-setup.sh               # once: build the exporter (~30 min)
//!   TWIP_BLESS=1 cargo test --features golden   # (re)write tests/goldens/*.png
//!   cargo test --features golden                # check against the goldens
//!
//! Goldens MUST be blessed on the same backend that checks them (lavapipe here,
//! never the box's real GPU) — bless and check share one code path below so the
//! exporter invocation and backend are identical for both.
#![cfg(feature = "golden")]

use std::path::{Path, PathBuf};
use std::process::Command;

/// Per-channel absolute-difference threshold above which a channel counts as an
/// outlier, and the maximum outlier count tolerated. Ported from ruffle's
/// `tests/framework` image_comparison (defaults there are 0/0). bless and check run
/// the same lavapipe on the same box, so drift is near-zero; TOLERANCE=2 absorbs
/// incidental rounding without masking a real rendering change.
const TOLERANCE: u8 = 2;
const MAX_OUTLIERS: usize = 0;

/// lavapipe ICD — forces wgpu onto the software rasterizer, not the box's GPU.
const LVP_ICD: &str = "/usr/share/vulkan/icd.d/lvp_icd.json";

struct Case {
    /// golden basename (tests/goldens/<name>.png)
    name: &'static str,
    /// fixture path relative to the crate root
    fixture: &'static str,
    /// frames to advance before capturing (frame n → skipframes n-1)
    skipframes: u32,
}

/// The visually-deterministic fixtures. Opacity compositing is excluded from strict
/// pixel comparison by design (paper.js-vs-SWF diverges — see docs/wick-format.md), as is
/// the x/y/scale motion of motion-tween, which the structural oracle pins far tighter than
/// pixels can.
/// `skew-tween` frame 24 is the exception: a matrix that transposes or sign-flips its
/// skew term still parses as a valid matrix, so shape is the only thing that catches it.
///
/// Every case here rendered one frame, which for a while meant a tween could be right at
/// both ends and wrong in between with nothing looking. `compiles_motion_tween_wick` closes
/// that on the structural side — it walks all 24 frames against the interpolation the tween
/// describes, a/b/c/d, tx, ty and the cxform per frame — and that is the tighter check of
/// the two, since it pins the interior exactly rather than to within an AA fringe and runs
/// on every commit instead of behind this file's manual dispatch.
///
/// The three `motion-tween-f*` cases below are deliberate belt-and-braces on top of it.
/// What they add is what `skew-tween` was already here for: a matrix can be arithmetically
/// what the assertions expect and still rasterize to something nobody wants — a shape
/// collapsed at a near-degenerate scale, a fill that inverts as winding flips through a
/// rotation. Frame 12 is the one to keep if these ever need trimming; it sits closest to
/// 90 degrees, where sin and cos swap roles and both endpoints are blind.
///
/// Opacity is deterministic here despite docs/testing.md excluding it: the divergence
/// recorded in docs/wick-format.md is paper.js-vs-SWF, and these compare Ruffle against
/// Ruffle on one backend.
const CASES: &[Case] = &[
    Case {
        name: "test1",
        fixture: "fixtures/test1.wick",
        skipframes: 0,
    },
    Case {
        name: "frame-by-frame",
        fixture: "fixtures/frame-by-frame.wick",
        skipframes: 0,
    },
    Case {
        name: "multi-layer",
        fixture: "fixtures/multi-layer.wick",
        skipframes: 0,
    },
    Case {
        name: "brush-donut",
        fixture: "fixtures/brush-donut.wick",
        skipframes: 0,
    },
    Case {
        name: "frame-stop",
        fixture: "fixtures/frame-stop.wick",
        skipframes: 0,
    },
    Case {
        name: "nested-clip",
        fixture: "fixtures/nested-clip.wick",
        skipframes: 0,
    },
    Case {
        name: "skew-tween",
        fixture: "fixtures/skew-tween.wick",
        skipframes: 23,
    },
    // The one fixture whose stage is not white. Every other one here is, and so is what a
    // player falls back to when a movie carries no SetBackgroundColor — which is why dropping
    // the tag entirely, as the compiler did until it emitted one, rendered pixel-identical on
    // all of them. This case is the only thing in the tree that can tell those two apart.
    Case {
        name: "dark-stage",
        fixture: "fixtures/dark-stage.wick",
        skipframes: 0,
    },
    // Three rectangles, three gradients: linear, radial, and radial with a highlight. This is
    // the case that has to be a rendered image rather than a structural assertion. A gradient
    // reaches the file as a fixed square plus a matrix, so a wrong matrix produces a
    // structurally perfect DefineShape4 that paints the ramp along the wrong axis, at the
    // wrong scale, or with the bright spot on the wrong side — every one of which parses
    // clean and looks obviously wrong the moment a player draws it.
    Case {
        name: "gradients",
        fixture: "fixtures/gradients.wick",
        skipframes: 0,
    },
    // Mid-span. The clip is rotating 0 -> 180 and scaling 1 -> 2.5 while fading to 0.3, so
    // these three catch the interior at a quarter, a half and three quarters of the way.
    Case {
        name: "motion-tween-f6",
        fixture: "fixtures/motion-tween.wick",
        skipframes: 5,
    },
    Case {
        name: "motion-tween-f12",
        fixture: "fixtures/motion-tween.wick",
        skipframes: 11,
    },
    Case {
        name: "motion-tween-f18",
        fixture: "fixtures/motion-tween.wick",
        skipframes: 17,
    },
];

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

/// The ruffle exporter binary: `$TWIP_EXPORTER`, else the oracle-setup.sh default.
fn exporter_bin() -> PathBuf {
    match std::env::var_os("TWIP_EXPORTER") {
        Some(p) => PathBuf::from(p),
        None => repo_root().join("oracle/ruffle/target/release/exporter"),
    }
}

/// Compile a fixture and render one frame to `png_out` via the exporter under
/// lavapipe. Returns Err with actionable text on any failure.
fn render(case: &Case, out_dir: &Path) -> Result<PathBuf, String> {
    let root = repo_root();
    let bin = exporter_bin();
    if !bin.exists() {
        return Err(format!(
            "exporter not found at {} — build it once with `bash scripts/oracle-setup.sh` \
             (or set TWIP_EXPORTER)",
            bin.display()
        ));
    }

    let wick = root.join(case.fixture);
    let bytes = std::fs::read(&wick).map_err(|e| format!("read {}: {e}", wick.display()))?;
    // Upsampling off, so `skipframes` keeps meaning the document frame the case names. What
    // these goldens watch is rasterization, and an interpolated sub-frame draws the same
    // shapes the document frame around it does — the extra frames would only renumber
    // everything and invalidate six committed PNGs to prove nothing new.
    let opts = twip::Options { upsample: false };
    let swf = twip::compile_wick_with(&bytes, &opts)
        .map_err(|e| format!("compile {}: {e}", case.fixture))?;

    let swf_path = out_dir.join(format!("{}.swf", case.name));
    let png_path = out_dir.join(format!("{}.actual.png", case.name));
    std::fs::write(&swf_path, &swf).map_err(|e| format!("write swf: {e}"))?;

    let status = Command::new(&bin)
        .env("VK_ICD_FILENAMES", LVP_ICD)
        .env("VK_DRIVER_FILES", LVP_ICD)
        .arg(&swf_path)
        .arg(&png_path)
        .args(["--frames", "1"])
        .args(["--skipframes", &case.skipframes.to_string()])
        .args(["--graphics", "vulkan"])
        .args(["--power", "low"])
        .arg("--silent")
        .status()
        .map_err(|e| format!("spawn exporter: {e}"))?;
    if !status.success() {
        return Err(format!("exporter exited {status} for {}", case.name));
    }
    if !png_path.exists() {
        return Err(format!(
            "exporter produced no PNG at {}",
            png_path.display()
        ));
    }
    Ok(png_path)
}

/// Count per-channel outliers between two RGBA images. `Err` if dimensions differ.
fn compare(golden: &Path, actual: &Path) -> Result<(usize, u8), String> {
    let g = image::open(golden)
        .map_err(|e| format!("open golden {}: {e}", golden.display()))?
        .to_rgba8();
    let a = image::open(actual)
        .map_err(|e| format!("open render {}: {e}", actual.display()))?
        .to_rgba8();
    if g.dimensions() != a.dimensions() {
        return Err(format!(
            "size mismatch: golden {:?} vs render {:?}",
            g.dimensions(),
            a.dimensions()
        ));
    }
    let mut outliers = 0usize;
    let mut max_diff = 0u8;
    for (gp, ap) in g.pixels().zip(a.pixels()) {
        for c in 0..4 {
            let d = gp[c].abs_diff(ap[c]);
            max_diff = max_diff.max(d);
            if d > TOLERANCE {
                outliers += 1;
            }
        }
    }
    Ok((outliers, max_diff))
}

#[test]
// `outliers <= MAX_OUTLIERS` reads as "always true" to clippy while MAX_OUTLIERS is 0,
// but <= is the intended threshold semantics — it stays correct if the const is bumped.
#[allow(clippy::absurd_extreme_comparisons)]
fn goldens() {
    let bless = std::env::var_os("TWIP_BLESS").is_some();
    let out_dir = repo_root().join("target/golden");
    std::fs::create_dir_all(&out_dir).expect("create target/golden");
    let goldens_dir = repo_root().join("tests/goldens");
    if bless {
        std::fs::create_dir_all(&goldens_dir).expect("create tests/goldens");
    }

    let mut failures = Vec::new();
    for case in CASES {
        let actual = match render(case, &out_dir) {
            Ok(p) => p,
            Err(e) => {
                failures.push(format!("{}: {e}", case.name));
                continue;
            }
        };
        let golden = goldens_dir.join(format!("{}.png", case.name));

        if bless {
            if let Err(e) = std::fs::copy(&actual, &golden) {
                failures.push(format!("{}: bless copy failed: {e}", case.name));
            } else {
                eprintln!("blessed {}", golden.display());
            }
            continue;
        }

        if !golden.exists() {
            failures.push(format!(
                "{}: no golden at {} — run TWIP_BLESS=1 cargo test --features golden",
                case.name,
                golden.display()
            ));
            continue;
        }
        match compare(&golden, &actual) {
            Ok((outliers, max_diff)) if outliers <= MAX_OUTLIERS => {
                eprintln!(
                    "{} ok ({outliers} outliers, max diff {max_diff})",
                    case.name
                );
            }
            Ok((outliers, max_diff)) => failures.push(format!(
                "{}: {outliers} outliers > {MAX_OUTLIERS} allowed (max diff {max_diff}); \
                 see {}",
                case.name,
                actual.display()
            )),
            Err(e) => failures.push(format!("{}: {e}", case.name)),
        }
    }

    assert!(
        failures.is_empty(),
        "golden oracle failures:\n  {}",
        failures.join("\n  ")
    );
}
