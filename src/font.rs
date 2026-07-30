//! Glyph outlines out of a `.ttf`, in the coordinates a `DefineFont3` wants.
//!
//! A `.wick` bundles the font files it uses (the editor ships 152 of them and imports the one
//! you pick), so the typeface an author chose can travel into the movie rather than being
//! approximated by whatever the player happens to have. That is what Flash did, and it is why
//! Flash text could be rotated and masked while device text could not.
//!
//! Three details here fail in the same way — a shape, but wrong — and none of them is visible
//! in a structural assertion: the EM scale, the y-flip, and the curve mapping. They were
//! settled by rendering single glyphs and measuring the ink against the font's own metrics
//! (`A`, `S`, `g`, `8` in Abel: worst error 1px, which is the antialiased edge).

use std::collections::{BTreeMap, BTreeSet};

use anyhow::{Context, Result, anyhow};
use swf::{
    Font, FontFlag, Glyph, Language, Point, PointDelta, ShapeRecord, StyleChangeData, SwfStr, Twips,
};

/// The EM square `DefineFont3` glyph coordinates live in.
///
/// Ruffle divides by exactly this to get its render scale
/// (`core/src/font.rs:675`: `if tag.version >= 3 { 20480.0 } else { 1024.0 }`), so a glyph is
/// stored spanning 0..20480 per em and the text's `height` scales it at draw time. Using the
/// v2 number here would render every glyph at 1/20 size.
pub const EM_SQUARE: f64 = 20480.0;

/// One font's glyphs, subsetted to what the document actually uses, plus the lookup a text
/// needs to name them.
pub struct Subset {
    /// Ready for `Tag::DefineFont2` with `version: 3`.
    pub font: Font<'static>,
    /// Character to (index into `font.glyphs`, advance in EM-square units).
    ///
    /// The index is what a `TextRecord` carries, and it is a **position in this table** rather
    /// than a codepoint — ruffle looks glyphs up with `glyphs.get_by_index(i)`
    /// (`core/src/font.rs:782`). Handing it a codepoint indexes off the end of a subset and
    /// draws nothing at all.
    pub lookup: BTreeMap<char, (u16, u16)>,
}

/// Turns ttf-parser's outline callbacks into SWF shape records, in EM-square units.
///
/// TrueType is y-up and SWF is y-down, so every y is negated. That is one line and it is the
/// difference between a letter and its reflection about the baseline.
struct GlyphPen {
    records: Vec<ShapeRecord>,
    scale: f64,
    cursor: (f64, f64),
    started: bool,
}

impl GlyphPen {
    fn new(units_per_em: u16) -> Self {
        Self {
            records: Vec::new(),
            scale: EM_SQUARE / f64::from(units_per_em),
            cursor: (0.0, 0.0),
            started: false,
        }
    }

    fn at(&self, x: f32, y: f32) -> (f64, f64) {
        (f64::from(x) * self.scale, -f64::from(y) * self.scale)
    }

    fn step(&mut self, to: (f64, f64)) -> PointDelta<Twips> {
        let d = PointDelta::new(
            Twips::new((to.0 - self.cursor.0).round() as i32),
            Twips::new((to.1 - self.cursor.1).round() as i32),
        );
        self.cursor = to;
        d
    }
}

impl ttf_parser::OutlineBuilder for GlyphPen {
    fn move_to(&mut self, x: f32, y: f32) {
        let p = self.at(x, y);
        self.records
            .push(ShapeRecord::StyleChange(Box::new(StyleChangeData {
                move_to: Some(Point::new(
                    Twips::new(p.0.round() as i32),
                    Twips::new(p.1.round() as i32),
                )),
                fill_style_0: None,
                // A glyph carries no styles of its own — the text's colour is applied when it
                // is drawn — but fill style 1 has to be selected once or nothing fills.
                fill_style_1: if self.started { None } else { Some(1) },
                line_style: None,
                new_styles: None,
            })));
        self.started = true;
        self.cursor = p;
    }

    fn line_to(&mut self, x: f32, y: f32) {
        let p = self.at(x, y);
        let delta = self.step(p);
        self.records.push(ShapeRecord::StraightEdge { delta });
    }

    fn quad_to(&mut self, x1: f32, y1: f32, x: f32, y: f32) {
        // The reason embedding is cheap rather than a research project: TrueType's native
        // curve and SWF's are both quadratic, so control and anchor transcribe directly with
        // no conversion and no error.
        let c = self.at(x1, y1);
        let p = self.at(x, y);
        let control_delta = self.step(c);
        let anchor_delta = self.step(p);
        self.records.push(ShapeRecord::CurvedEdge {
            control_delta,
            anchor_delta,
        });
    }

    fn curve_to(&mut self, _: f32, _: f32, _: f32, _: f32, _: f32, _: f32) {
        // Cubic outlines mean a CFF-flavoured font. Every file the editor bundles is `glyf`,
        // so rather than quietly subdividing — which would work, and would hide that the
        // assumption had changed — this records the shortfall for the caller to report.
        self.records.clear();
        self.started = false;
    }

    fn close(&mut self) {}
}

/// Build a subsetted `DefineFont3` payload for one font file.
///
/// Only the characters in `used` are embedded. A whole family is a few hundred kilobytes of
/// outlines and a title card needs a dozen letters, so subsetting is the difference between a
/// movie and a font distribution.
pub fn subset(id: u16, name: &str, bytes: &[u8], used: &BTreeSet<char>) -> Result<Subset> {
    let face = ttf_parser::Face::parse(bytes, 0).context("parse font file")?;
    let upem = face.units_per_em();
    if upem == 0 {
        return Err(anyhow!("font declares no EM size"));
    }

    let mut glyphs = Vec::new();
    let mut lookup = BTreeMap::new();
    for &ch in used {
        // A character the font has no glyph for is left out of the lookup rather than
        // embedded blank, so the layout can say so instead of drawing a hole.
        let Some(gid) = face.glyph_index(ch) else {
            continue;
        };
        let advance_units = face.glyph_hor_advance(gid).unwrap_or(0);
        let advance = ((f64::from(advance_units) * EM_SQUARE / f64::from(upem)).round() as i64)
            .clamp(0, i64::from(u16::MAX)) as u16;

        let mut pen = GlyphPen::new(upem);
        // A space has no outline and that is not a failure — it advances and draws nothing.
        let outlined = face.outline_glyph(gid, &mut pen).is_some();
        if outlined && pen.records.is_empty() {
            return Err(anyhow!(
                "{ch:?} has cubic outlines — this font is CFF, not TrueType"
            ));
        }

        lookup.insert(ch, (glyphs.len() as u16, advance));
        glyphs.push(Glyph {
            shape_records: pen.records,
            code: ch as u16,
            advance,
            bounds: None,
        });
    }

    Ok(Subset {
        font: Font {
            version: 3,
            id,
            // Leaked so the tag can be 'static: one small allocation per font per compile,
            // against threading a lifetime here purely for a name nothing reads back.
            name: SwfStr::from_utf8_str(Box::leak(name.to_owned().into_boxed_str())),
            language: Language::Latin,
            layout: None,
            glyphs,
            // Wide codes because `Glyph.code` is a u16 and DefineFont3 stores them as such.
            // Bold and italic are read off the face rather than the family name: the library
            // ships one file per variant, so the file is the authority on which it is.
            flags: FontFlag::HAS_WIDE_CODES
                | if face.is_bold() {
                    FontFlag::IS_BOLD
                } else {
                    FontFlag::empty()
                }
                | if face.is_italic() {
                    FontFlag::IS_ITALIC
                } else {
                    FontFlag::empty()
                },
        },
        lookup,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const ABEL: &str = "editor/public/fonts/Abel/Abel_regular.ttf";

    fn abel() -> Option<Vec<u8>> {
        std::fs::read(ABEL).ok()
    }

    fn chars(s: &str) -> BTreeSet<char> {
        s.chars().collect()
    }

    #[test]
    fn only_the_characters_used_are_embedded() {
        let Some(bytes) = abel() else { return };
        let s = subset(1, "Abel", &bytes, &chars("Hi")).unwrap();
        assert_eq!(
            s.font.glyphs.len(),
            2,
            "a two-letter movie embeds two glyphs"
        );
        assert_eq!(s.lookup.len(), 2);
    }

    /// The index a TextRecord carries is a position in this table, not a codepoint. Feeding a
    /// codepoint in reads off the end of a subset and silently draws nothing.
    #[test]
    fn the_lookup_indexes_the_table_not_the_codepoint() {
        let Some(bytes) = abel() else { return };
        let s = subset(1, "Abel", &bytes, &chars("AZ")).unwrap();
        let (a, _) = s.lookup[&'A'];
        let (z, _) = s.lookup[&'Z'];
        assert_eq!((a, z), (0, 1), "sorted by char, indexed by position");
        assert!(u32::from(a) < 128 && (a as usize) < s.font.glyphs.len());
        assert_eq!(s.font.glyphs[a as usize].code, u16::from(b'A'));
    }

    /// Abel is 2048 units/em, so the EM square scale is exactly 10x. A glyph spanning the full
    /// em must come out spanning 20480 — the v2 number would make this 1024 and every glyph
    /// would render at a twentieth of its size.
    #[test]
    fn glyphs_are_scaled_to_the_v3_em_square() {
        let Some(bytes) = abel() else { return };
        let s = subset(1, "Abel", &bytes, &chars("A")).unwrap();
        let g = &s.font.glyphs[0];
        // Abel's 'A' advances 950 of 2048 units.
        assert_eq!(g.advance, (950.0 * EM_SQUARE / 2048.0).round() as u16);
        assert_eq!(s.font.version, 3);
    }

    /// y-up to y-down. Abel's 'A' sits on the baseline and rises, so every point of it must be
    /// at or above y=0 in SWF space, i.e. negative.
    #[test]
    fn the_outline_is_flipped_into_swfs_y_down_space() {
        let Some(bytes) = abel() else { return };
        let s = subset(1, "Abel", &bytes, &chars("A")).unwrap();
        let mut y = 0i32;
        let mut lowest = 0i32;
        for r in &s.font.glyphs[0].shape_records {
            match r {
                ShapeRecord::StyleChange(c) => {
                    if let Some(p) = c.move_to {
                        y = p.y.get();
                    }
                }
                ShapeRecord::StraightEdge { delta } => y += delta.dy.get(),
                ShapeRecord::CurvedEdge {
                    control_delta,
                    anchor_delta,
                } => y += control_delta.dy.get() + anchor_delta.dy.get(),
            }
            lowest = lowest.min(y);
        }
        assert!(
            lowest < -10_000,
            "a capital A should rise ~0.7em above the baseline; got {lowest}"
        );
    }

    /// A space advances and draws nothing. Treating "no outline" as a failure would refuse
    /// every sentence.
    #[test]
    fn a_space_carries_an_advance_and_no_outline() {
        let Some(bytes) = abel() else { return };
        let s = subset(1, "Abel", &bytes, &chars(" ")).unwrap();
        let g = &s.font.glyphs[0];
        assert!(g.shape_records.is_empty());
        assert!(g.advance > 0, "a space with no advance collapses the text");
    }

    #[test]
    fn a_character_the_font_lacks_is_left_out_rather_than_blank() {
        let Some(bytes) = abel() else { return };
        let s = subset(1, "Abel", &bytes, &chars("A\u{1F600}")).unwrap();
        assert_eq!(s.font.glyphs.len(), 1);
        assert!(!s.lookup.contains_key(&'\u{1F600}'));
    }
}
