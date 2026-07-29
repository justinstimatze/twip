/*
 * theme.js — hand the canvas surfaces the same tokens the DOM gets.
 *
 * The timeline is not React. It is 3,723 lines of paper.js painting onto a <canvas> in
 * `engine/src/gui/`, and every colour it draws is a hex literal on `Wick.GUIElement` — 52 of
 * them, set at bundle-evaluation time. So a CSS token layer, however careful, stops at the
 * edge of the timeline, which is one of the two surfaces anyone actually looks at.
 *
 * Reassigning those statics after the bundle loads closes that gap without forking the
 * vendored engine, which matters: `engine/src/` is Wick's code under GPLv3 and every edit
 * there is a future upstream merge conflict. The statics are plain properties on a plain
 * object and the GUI reads them at draw time, so the assignment below is all it takes.
 *
 * Values come from `getComputedStyle` rather than being repeated here, so index.css stays
 * the single authority and a token edit reaches the canvas without a second edit. Anything
 * that resolves empty is left alone — a missing token should leave the engine's own default
 * standing, not paint the timeline transparent.
 */

const read = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/*
 * Mixes a token toward a target at `amount`, in plain sRGB. The engine wants a handful of
 * colours that only exist as a relationship — a hover state, a ghost, a grid line — and
 * inventing tokens for each would put values in index.css that nothing else ever reads.
 */
function mix (hex, toward, amount) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [r, g, b] = p(hex);
  const [tr, tg, tb] = p(toward);
  const c = (a, t) => Math.round(a + (t - a) * amount).toString(16).padStart(2, '0');
  return `#${c(r, tr)}${c(g, tg)}${c(b, tb)}`;
}

const rgba = (hex, a) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgba(${r},${g},${b},${a})`;
};

/*
 * The timeline's own inversion, and the one real design decision in this file.
 *
 * Wick drew a frame as a white cell on a dark bed. At 38x42 and forty cells across that is a
 * wall of white, it outshines the stage, and the playhead — the one thing you need to find
 * instantly — has to compete with it. twip draws a frame as a filled ash cell instead, and
 * lets flare be the only saturated thing in the panel.
 */
export function themeTimeline (Wick) {
  const G = Wick && Wick.GUIElement;
  if (!G) return false;

  const bed = read('--color-timeline-bed');
  const gutter = read('--color-timeline-gutter');
  const frame = read('--color-timeline-frame');
  const empty = read('--color-timeline-frame-empty');
  const audio = read('--color-timeline-frame-audio');
  const playhead = read('--color-timeline-playhead');
  const tween = read('--color-timeline-tween');
  const tweenAlt = read('--color-timeline-tween-alt');
  const script = read('--color-timeline-script-dot');
  const layerOn = read('--color-timeline-layer-active');
  const layerOff = read('--color-timeline-layer-inactive');
  const selected = read('--color-selected');
  const accent = read('--color-accent');
  const content = read('--color-content');
  const ink = read('--color-content-inverse');
  const line = read('--color-line');
  const danger = read('--color-danger');

  if (!bed || !frame || !playhead) return false;

  G.TIMELINE_BACKGROUND_COLOR = bed;
  G.SELECTED_ITEM_BORDER_COLOR = selected;

  G.BREADCRUMBS_BG_COLOR = gutter;
  G.BREADCRUMBS_ACTIVE_BUTTON_FILL_COLOR = bed;
  G.BREADCRUMBS_INACTIVE_BUTTON_FILL_COLOR = gutter;
  G.BREADCRUMBS_HOVER_BUTTON_FILL_COLOR = empty;
  G.BREADCRUMBS_SHADOW_COLOR = gutter;
  G.BREADCRUMBS_ACTIVE_BORDER_COLOR = accent;

  G.NUMBER_LINE_NUMBERS_HIGHLIGHT_COLOR = content;
  G.NUMBER_LINE_NUMBERS_COMMON_COLOR = read('--color-content-faint') || tweenAlt;

  G.FRAME_CONTENTFUL_FILL_COLOR = frame;
  G.FRAME_TWEENED_FILL_COLOR = frame;
  G.FRAME_UNCONTENTFUL_FILL_COLOR = empty;
  G.FRAME_AUDIO_FILL_COLOR = audio;
  G.FRAME_CONTENT_DOT_COLOR = content;
  G.FRAME_SCRIPT_DOT_COLOR = script;
  G.FRAME_HANDLE_HOVER_FILL_COLOR = selected;
  G.FRAME_GHOST_COLOR = selected;
  G.FRAME_GHOST_NOT_ALLOWED_COLOR = danger;
  G.FRAME_HOVERED_OVER = mix(frame, content, 0.35);
  G.FRAME_TWEENED_HOVERED_OVER = mix(frame, content, 0.35);
  G.FRAME_IDENTIFIER_FONT_COLOR = ink;
  G.FRAME_DROP_SHADOW_FILL = rgba(gutter, 0.9);
  // 5px on a 38px cell rounds the grid into a row of lozenges. 2px keeps it a grid.
  G.FRAME_BORDER_RADIUS = 2;
  G.LAYER_LABEL_BORDER_RADIUS = 2;

  G.TWEEN_FILL_COLOR_1 = tween;
  G.TWEEN_FILL_COLOR_2 = tweenAlt;
  G.TWEEN_HOVER_COLOR_1 = accent;
  G.TWEEN_HOVER_COLOR_2 = read('--color-accent-hover') || accent;
  G.TWEEN_STROKE_COLOR = gutter;
  G.TWEEN_ARROW_STROKE_COLOR = read('--color-content-subtle') || tweenAlt;

  // The strips behind a layer's frames. Both were translucent light-on-dark; keeping them
  // translucent means they still read as "this layer is live" over any bed colour.
  G.FRAMES_STRIP_ACTIVE_FILL_COLOR = rgba(frame, 0.22);
  G.FRAMES_STRIP_INACTIVE_FILL_COLOR = rgba(empty, 0.55);

  G.ADD_FRAME_OVERLAY_FILL_COLOR = mix(empty, frame, 0.35);
  G.ADD_FRAME_OVERLAY_PLUS_COLOR = content;

  G.FRAMES_CONTAINER_VERTICAL_GRID_STROKE_COLOR = rgba(gutter, 0.8);
  G.FRAMES_CONTAINER_VERTICAL_GRID_HIGHLIGHT_STROKE_COLOR = rgba(content, 0.16);

  G.PLAYHEAD_FILL_COLOR = playhead;
  G.PLAYHEAD_STROKE_COLOR = read('--color-accent-active') || playhead;

  /*
   * The active layer is named in flare rather than filled with it. Wick painted the whole
   * label solid — a saturated bar the width of the layer column, permanently, on a panel
   * whose entire job is to let you find the playhead. One row of coloured text says the
   * same thing and leaves the accent free to mean something.
   */
  G.LAYER_LABEL_ACTIVE_FILL_COLOR = read('--color-surface-hover') || empty;
  G.LAYER_LABEL_INACTIVE_FILL_COLOR = empty;
  G.LAYER_LABEL_HIDDEN_FILL_COLOR = rgba(empty, 0.4);
  G.LAYER_LABEL_ACTIVE_FONT_COLOR = layerOn;
  G.LAYER_LABEL_INACTIVE_FONT_COLOR = layerOff;
  G.LAYER_LABEL_GHOST_COLOR = selected;
  G.LAYER_LABEL_HOVER_COLOR = read('--color-accent-hover') || accent;

  // The add-layer button, which was a 30%-white slab and read as the loudest thing in the
  // panel. It is an affordance, not an announcement.
  G.LAYER_CREATE_LABEL_FILL_COLOR = empty;
  G.LAYER_CREATE_LABEL_HOVER_FILL_COLOR = read('--color-surface-hover') || empty;

  G.LAYER_BUTTON_ICON_COLOR = read('--color-content-subtle') || tweenAlt;
  G.LAYER_BUTTON_HOVER_COLOR = selected;
  G.LAYER_BUTTON_MOUSEDOWN_COLOR = read('--color-accent-active') || accent;
  G.LAYER_BUTTON_TOGGLE_ACTIVE_COLOR = rgba(content, 0.75);
  G.LAYER_BUTTON_TOGGLE_INACTIVE_COLOR = rgba(content, 0.02);

  G.ACTION_BUTTON_COLOR = read('--color-content-subtle') || tweenAlt;
  G.ACTION_BUTTON_HOVER_COLOR = content;

  G.SCROLLBAR_BACKGROUND_COLOR = gutter;
  G.SCROLLBAR_FILL_COLOR = line;
  G.SCROLLBAR_ACTIVE_FILL_COLOR = read('--color-content-faint') || line;

  // '12px Courier New' was the engine's own choice and it is the only place in the app that
  // renders type outside the font stack. Frame numbers are numbers; they get the same mono
  // the inspector's numeric fields do.
  const first = (stack, fallback) => (read(stack) || fallback).split(',')[0].trim().replace(/^["']|["']$/g, '');
  G.NUMBER_LINE_NUMBERS_FONT_FAMILY = first('--font-mono', 'monospace');
  G.NUMBER_LINE_NUMBERS_FONT_SIZE = '15';
  G.UI_FONT_FAMILY = first('--font-ui', 'sans-serif');
  G.LAYER_LABEL_FONT_FAMILY = G.UI_FONT_FAMILY;
  G.LAYER_LABEL_FONT_SIZE = 15;

  return true;
}

/** The void the stage floats in. Darkest surface in the app, so the artwork is the brightest. */
export function stageBackground () {
  return read('--color-surface-void') || '#110F0E';
}
