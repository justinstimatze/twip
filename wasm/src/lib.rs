//! The twip compiler, compiled to wasm so a plain browser tab can do the job.
//!
//! Without this the editor's one button has two routes and both need something outside the
//! browser: the Tauri desktop shell (an in-process Rust call) or `dev/twip_bridge.py` on
//! :8752 (a POST to a local server). Someone who clones the repo and runs `pnpm dev` has
//! neither, so "Export to SWF" fails on the thing twip exists to do. This is the third
//! route, and the only one that needs nothing but the page.

use wasm_bindgen::prelude::*;

/// Install the panic hook once, when the module is instantiated.
#[wasm_bindgen(start)]
pub fn start() {
    console_error_panic_hook::set_once();
}

/// Compile serialized `.wick` bytes to `.swf` bytes.
///
/// Reaches JS as `compile_wick(Uint8Array, upsample?) -> Uint8Array`, throwing on a compile
/// error with the compiler's own message. `{:#}` rather than `{}` so anyhow's context chain
/// survives — "unsupported tween easing" alone does not say which frame.
///
/// `upsample` is optional and defaults to true, so the JS side can keep calling this with one
/// argument and get the same bytes it got before the knob existed.
#[wasm_bindgen]
pub fn compile_wick(wick: &[u8], upsample: Option<bool>) -> Result<Box<[u8]>, JsError> {
    let opts = twip::Options {
        upsample: upsample.unwrap_or(true),
    };
    twip::compile_wick_with(wick, &opts)
        .map(Vec::into_boxed_slice)
        .map_err(|e| JsError::new(&format!("{e:#}")))
}
