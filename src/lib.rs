//! twip — a compiler from Wick (`.wick`) documents to SWF.
//!
//! Status: scaffold only. No compilation is implemented yet; the design and
//! the verified `.wick` structure live in `HANDOFF.md`. Phase 0 (hello-square)
//! is the first executable step.

/// Returns the crate version. Placeholder so the crate builds and CI stays green.
pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}
