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
/// Reaches JS as `compile_wick(Uint8Array) -> Uint8Array`, throwing on a compile error with
/// the compiler's own message. `{:#}` rather than `{}` so anyhow's context chain survives —
/// "unsupported tween easing" alone does not say which frame.
#[wasm_bindgen]
pub fn compile_wick(wick: &[u8]) -> Result<Box<[u8]>, JsError> {
    twip::compile_wick(wick)
        .map(Vec::into_boxed_slice)
        .map_err(|e| JsError::new(&format!("{e:#}")))
}
