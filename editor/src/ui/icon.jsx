/*
 * The icon set.
 *
 * What was here: 236 files in ten directories, drawn over several years at several sizes in
 * several weights, some SVG and 46 PNG, every one of them rendered through `<img src>`. An
 * `<img>` cannot inherit `currentColor`, so each drawing's colour is baked into the file —
 * which is why the old set carried `add` *and* `add-dark`, `upload` and `upload-dark`,
 * `timeline` and `timeline-dark`, `settings` and `settings-white`, `delete` and
 * `delete-black`, `create`/`create-white`, `load`/`load-white`, `breakApart`/`breakApart-dark`
 * and three variants of the mark. Fourteen files existing because of a rendering choice.
 *
 * These are one family instead: 24×24, 1.5px stroke, round caps and joins, drawn on a 2px grid
 * with a 2px margin, and painted in `currentColor`. Hover, active, disabled and every future
 * state now come from the token layer for free, and the light/dark pairs collapse into
 * aliases. Nothing here is imported from an icon library — about forty of these are
 * domain-specific (brush modes, cursor transform modes, gradient modes, gap fill, layer
 * tween, onion skin) and no general set has them, and the general ones are drawn to match
 * rather than bolted on from a family with a different weight and grid.
 *
 * `solid` on a shape is deliberate and rare: a filled form reads as "this is the state you are
 * in" where an outline reads as "this is a thing". Play, keyframe dots and boolean-op results
 * are filled; everything else is a line drawing.
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const S = { fill: 'currentColor' };

/*
 * Boolean ops need fill to be legible at all — three outlines of the same two overlapping
 * rectangles are identical drawings. `evenodd` on a single path is what actually cuts the
 * hole for subtract, rather than faking it with a second shape in the background colour,
 * which would break the moment the icon sat on anything but the panel surface.
 */
const A = 'M4 4h11v11H4Z';
const B = 'M9 9h11v11H9Z';

export const ICONS = {
  // ---- tools ----
  cursor: <path d="M6 3.2 18.4 12.4l-5.5.5-2.3 5.1z" {...S} />,
  pathcursor: <>
    <path d="M7 3.6 17.6 11.5l-4.7.4-2 4.4z" />
    <rect x="2.6" y="18" width="3.4" height="3.4" rx=".6" {...S} />
    <rect x="18" y="18" width="3.4" height="3.4" rx=".6" {...S} />
  </>,
  /*
   * Brush and pencil are the two most-reached-for tools and they were the same drawing at
   * 20px — both a thin diagonal. The difference is the tip and nothing else: a pencil has a
   * hard point, a brush has a soft loaded head, so the brush's is filled and heavy.
   */
  brush: <>
    <path d="M20.4 3.6a2 2 0 0 0-2.8 0l-6.1 6.1 2.8 2.8 6.1-6.1a2 2 0 0 0 0-2.8z" />
    <path d="M10.9 10.2 8 13.1c-1.6 1.6-1.4 3.6-2.6 4.8-.6.6-1.4.9-2.4 1.1 1.9 1.9 5.4 2.4 7.5.3 1.4-1.4 1.5-3.2.9-4.4z" {...S} />
  </>,
  pencil: <>
    <path d="m4 20 1.1-4.6L15.6 4.9a2 2 0 0 1 2.9 2.9L8 18.3z" />
    <path d="m14.2 6.3 3.5 3.5M5.1 15.4 8 18.3" />
  </>,
  eraser: <>
    <path d="M9.5 20.5h10" />
    <path d="M13.9 5.6 5.6 13.9a2 2 0 0 0 0 2.8l2.8 2.8h4l8.1-8.1a2 2 0 0 0 0-2.8l-3.8-3.8a2 2 0 0 0-2.8 0z" />
    <path d="m9 10.5 5.5 5.5" />
  </>,
  rectangle: <rect x="4" y="6" width="16" height="12" rx="1" />,
  ellipse: <circle cx="12" cy="12" r="7.5" />,
  line: <>
    <path d="M6 18 18 6" />
    <circle cx="5" cy="19" r="1.7" {...S} />
    <circle cx="19" cy="5" r="1.7" {...S} />
  </>,
  text: <>
    <path d="M5 7V5h14v2" />
    <path d="M12 5v14" />
    <path d="M9 19h6" />
  </>,
  fillbucket: <>
    <path d="M9 3.6 3.9 8.7a1.8 1.8 0 0 0 0 2.6l5.4 5.4a1.8 1.8 0 0 0 2.6 0l5.1-5.1z" />
    <path d="m6.5 6.1 5.6 5.6" />
    <path d="M19.5 14.2c1 1.6 1.5 2.7 1.5 3.4a1.5 1.5 0 0 1-3 0c0-.7.5-1.8 1.5-3.4z" {...S} />
  </>,
  eyedropper: <>
    <path d="M17.4 2.7a2.5 2.5 0 0 1 3.9 3.1l-2.5 2.5-3.5-3.5z" {...S} />
    <path d="m15.3 5.2-9.5 9.5L4.5 19.5l4.8-1.3 9.5-9.5" />
  </>,
  gradienttool: <>
    <rect x="4" y="5" width="16" height="14" rx="1.5" />
    <path d="M6.5 13 12.5 7M7.5 17 17 7.5M11.5 18 17.5 12" />
  </>,
  pan: <>
    <path d="M12 3v18M3 12h18" />
    <path d="m9 6 3-3 3 3M18 9l3 3-3 3M15 18l-3 3-3-3M6 15l-3-3 3-3" />
  </>,
  zoom: <>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="m15.4 15.4 5.1 5.1" />
  </>,
  zoomin: <>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="m15.4 15.4 5.1 5.1M8 10.5h5M10.5 8v5" />
  </>,
  zoomout: <>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="m15.4 15.4 5.1 5.1M8 10.5h5" />
  </>,
  recenter: <>
    <path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" />
    <circle cx="12" cy="12" r="2.6" />
  </>,

  // ---- editing actions ----
  delete: <>
    <path d="M4 6.5h16" />
    <path d="M9.5 6.5v-2h5v2" />
    <path d="M6.5 6.5 7.4 19a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4l.9-12.5" />
    <path d="M10.5 10v6.5M13.5 10v6.5" />
  </>,
  copy: <>
    <rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2" />
    <path d="M15.5 8.5V6A2 2 0 0 0 13.5 4H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5" />
  </>,
  paste: <>
    <path d="M9.5 3h5a1 1 0 0 1 1 1v1.5h-7V4a1 1 0 0 1 1-1z" />
    <path d="M15.5 5.5H18A1.5 1.5 0 0 1 19.5 7v12a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 19V7A1.5 1.5 0 0 1 6 5.5h2.5" />
  </>,
  undo: <>
    <path d="M4.5 9.5H15a5.5 5.5 0 0 1 0 11H8.5" />
    <path d="m8.5 5.5-4 4 4 4" />
  </>,
  redo: <>
    <path d="M19.5 9.5H9a5.5 5.5 0 0 0 0 11h6.5" />
    <path d="m15.5 5.5 4 4-4 4" />
  </>,
  moreactions: <path d="m6 9.5 6 6 6-6" />,
  duplicate: <>
    <rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2" />
    <path d="M15.5 8.5V6A2 2 0 0 0 13.5 4H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5" />
    <path d="M14.2 14.2v3.5M12.5 16h3.5" />
  </>,
  flipHorizontal: <>
    <path d="M12 3v18" />
    <path d="M9.5 7 4 12l5.5 5z" />
    <path d="M14.5 7 20 12l-5.5 5z" {...S} />
  </>,
  flipVertical: <>
    <path d="M3 12h18" />
    <path d="M7 9.5 12 4l5 5.5z" />
    <path d="M7 14.5 12 20l5-5.5z" {...S} />
  </>,

  /* One family for the four stacking actions: the object, an arrow saying which way it
     travels, and a bar for the two that go all the way. */
  bringForwards: <>
    <rect x="4" y="10" width="10" height="10" rx="1.5" />
    <path d="M17.5 14V5M14 8.5 17.5 5 21 8.5" />
  </>,
  bringToFront: <>
    <rect x="4" y="10" width="10" height="10" rx="1.5" />
    <path d="M17.5 14V7M14 10.5 17.5 7 21 10.5M13.5 3.5h8" />
  </>,
  sendBackwards: <>
    <rect x="4" y="4" width="10" height="10" rx="1.5" />
    <path d="M17.5 10v9M21 15.5 17.5 19 14 15.5" />
  </>,
  sendToBack: <>
    <rect x="4" y="4" width="10" height="10" rx="1.5" />
    <path d="M17.5 10v7M21 13.5 17.5 17 14 13.5M13.5 20.5h8" />
  </>,

  group: <>
    <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" />
    <rect x="8" y="8" width="8" height="8" rx="1" />
  </>,
  breakApart: <>
    <path d="M4 4h9v9z" />
    <path d="M20 20h-9v-9z" />
  </>,
  leaveUp: <>
    <path d="M10 4H5.5A1.5 1.5 0 0 0 4 5.5v13A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V14" />
    <path d="M14 4h6v6M20 4l-8 8" />
  </>,

  /* Boolean ops. evenodd is doing real work in `subtract` — it cuts the overlap out of A
     rather than covering it with a shape in the panel colour, which would only look right
     on the one surface it was tuned against. */
  unite: <path d="M4 4h11v5h5v11H9v-5H4z" {...S} />,
  subtract: <>
    <rect x="9" y="9" width="11" height="11" />
    <path fillRule="evenodd" d={`${A}M9 9h6v6H9Z`} {...S} />
  </>,
  intersect: <>
    <path d={A} /><path d={B} />
    <rect x="9" y="9" width="6" height="6" {...S} />
  </>,

  script: <path d="m8.5 8.5-4.5 3.5 4.5 3.5M15.5 8.5l4.5 3.5-4.5 3.5M13.5 5l-3 14" />,
  /* A symbol is a shape plus a registration point — the corner everything inside it is
     measured from. That is the one thing that distinguishes it from the shape it was made
     out of, so it is what the icon shows. */
  symbol: <>
    <rect x="6" y="6" width="14" height="14" rx="1.5" />
    <circle cx="6" cy="6" r="2.6" />
    <path d="M6 3.4v5.2M3.4 6h5.2" />
  </>,
  animated: <>
    <rect x="3.5" y="6.5" width="12" height="12" rx="1.5" />
    <path d="M8 4.5h8.5a2 2 0 0 1 2 2V15" />
    <path d="M7.5 10 12 12.5 7.5 15z" {...S} />
  </>,
  action: <path d="M13.5 3 6 13.5h5L10 21l7.5-10.5h-5z" />,
  clear: <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="m8.8 8.8 6.4 6.4M15.2 8.8l-6.4 6.4" />
  </>,
  'reverse-gradient': <>
    <path d="M4 8.5h16M4 15.5h16" />
    <path d="m8 4.5-4 4 4 4M16 19.5l4-4-4-4" />
  </>,

  // ---- tool settings ----
  brushsize: <>
    <circle cx="5.5" cy="12" r="1.5" {...S} />
    <circle cx="11" cy="12" r="3" />
    <circle cx="18" cy="12" r="4.5" />
  </>,
  brushsmoothness: <path d="M3 16.5c3-9.5 6 6 9-2s6-4.5 9-4.5" />,
  brushpressure: <path d="M3.5 13.5c5.5-3.2 11.5-3.2 17 0-5.5 3.2-11.5 3.2-17 0z" {...S} />,
  /* Relative brush size means the nib tracks the zoom instead of the screen — a dot measured
     against the frame around it, not against the display. Concentric circles read as a gear
     at 16px, which is the icon two controls to the left. */
  brushrelativesize: <>
    <rect x="3.5" y="3.5" width="17" height="17" rx="2" strokeDasharray="2.5 2.5" />
    <circle cx="12" cy="12" r="4.5" {...S} />
  </>,

  /* The four brush modes, told apart by where the stroke survives relative to existing
     artwork: everywhere, only inside it, only outside it, or fused with it. */
  brushmodenone: <>
    <rect x="4" y="4" width="12" height="12" rx="1" />
    <path d="M7.5 20.5 20.5 7.5" strokeWidth="3.5" />
  </>,
  brushmodeinside: <>
    <rect x="4" y="4" width="12" height="12" rx="1" />
    <path d="M6 15 15 6" strokeWidth="3.5" />
  </>,
  brushmodeoutside: <>
    <rect x="4" y="4" width="12" height="12" rx="1" />
    <path d="M17 13.5 20.5 10M3.5 20.5 7 17" strokeWidth="3.5" />
  </>,
  brushmodemerge: <>
    <path d="M4 4h12v12H4z" {...S} />
    <path d="M7.5 20.5 20.5 7.5" strokeWidth="3.5" />
  </>,

  /* The cursor transform modes: what the bounding box lets you do. A rectangle keeps its
     angles, a parallelogram does not; the handles say which grips are live. */
  cursortransformmodeuniform: <>
    <rect x="6" y="6" width="12" height="12" />
    <rect x="4.4" y="4.4" width="3.2" height="3.2" {...S} />
    <rect x="16.4" y="16.4" width="3.2" height="3.2" {...S} />
  </>,
  cursortransformmodefreescale: <>
    <rect x="6" y="6" width="12" height="12" />
    <rect x="4.4" y="4.4" width="3.2" height="3.2" {...S} />
    <rect x="16.4" y="16.4" width="3.2" height="3.2" {...S} />
    <rect x="10.4" y="4.4" width="3.2" height="3.2" {...S} />
    <rect x="10.4" y="16.4" width="3.2" height="3.2" {...S} />
  </>,
  cursortransformmodeskew: <>
    <path d="M8 6h11l-3 12H5z" />
    <rect x="17.4" y="4.4" width="3.2" height="3.2" {...S} />
    <rect x="3.4" y="16.4" width="3.2" height="3.2" {...S} />
  </>,
  cursortransformmodeskewscale: <>
    <path d="M8 6h11l-3 12H5z" />
    <rect x="17.4" y="4.4" width="3.2" height="3.2" {...S} />
    <rect x="3.4" y="16.4" width="3.2" height="3.2" {...S} />
    <rect x="6.4" y="4.4" width="3.2" height="3.2" {...S} />
    <rect x="14.4" y="16.4" width="3.2" height="3.2" {...S} />
  </>,
  gradienttoolmodenone: <rect x="4" y="5" width="16" height="14" rx="1.5" />,
  gradienttoolmodeuniform: <>
    <rect x="4" y="5" width="16" height="14" rx="1.5" />
    <path d="M6.5 13 12.5 7M7.5 17 17 7.5M11.5 18 17.5 12" />
  </>,
  cornerradius: <>
    <path d="M4 20V9.5A5.5 5.5 0 0 1 9.5 4H20" />
    <path d="M4 17v3.5h3.5M16.5 4H20v3.5" />
  </>,
  strokewidth: <>
    <path d="M4 6.5h16" strokeWidth="1" />
    <path d="M4 12h16" strokeWidth="2.5" />
    <path d="M4 18h16" strokeWidth="4" />
  </>,
  gapfillamount: <>
    <path d="M12 4a8 8 0 1 1-4 14.9" />
    <path d="M3.5 12h6.5M7 9l3 3-3 3" />
  </>,
  /* Smooth on one side of the shape, faceted on the other — a plain blob was indistinguishable
     from the ellipse tool. */
  fillsmoothing: <>
    <path d="M12 4.5a7.5 7.5 0 0 0 0 15" />
    <path d="m12 4.5 2.4 1.9-2.4 1.9 2.4 1.9-2.4 1.9 2.4 1.9-2.4 1.9 2.4 1.9-2.4 1.7" />
  </>,
  /* Set in the interface's own face rather than drawn as paths. A font picker's icon is the
     one place where showing actual letterforms is more honest than a diagram of them. */
  fontfamily: (
    <text x="12" y="17.5" textAnchor="middle" fontSize="15" fontWeight="600"
      fontFamily="var(--font-ui)" stroke="none" {...S}>Aa</text>
  ),
  fontsize: <>
    <path d="M3 18 7 6l4 12M4.4 14.6h5.2" />
    <path d="M17.5 5.5v13M14.5 8.5l3-3 3 3M14.5 15.5l3 3 3-3" />
  </>,
  pixel: <>
    <rect x="4" y="4" width="16" height="16" rx="1" />
    <path d="M12 4v16M4 12h16" />
  </>,

  // ---- inspector properties ----
  position: <>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3.5V7M12 17v3.5M3.5 12H7M17 12h3.5" />
  </>,
  /* Size is two measurements; scale is one gesture. Drawn that way, because as two sets of
     diagonal corner arrows they were the same icon. */
  size: <>
    <rect x="3.5" y="3.5" width="12" height="12" rx="1" />
    <path d="M3.5 20h12M5 18.5 3.5 20 5 21.5M14 18.5l1.5 1.5-1.5 1.5" />
    <path d="M20 3.5v12M18.5 5 20 3.5 21.5 5M18.5 14 20 15.5l1.5-1.5" />
  </>,
  scale: <>
    <path d="M4 10V4h6M20 14v6h-6" />
    <path d="m4 4 5.5 5.5M20 20l-5.5-5.5" />
  </>,
  rotation: <>
    <path d="M20 12a8 8 0 1 1-2.6-5.9" />
    <path d="M20.5 4v4.5H16" />
  </>,
  opacity: <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 3.5a8.5 8.5 0 0 1 0 17z" {...S} />
  </>,
  name: <>
    <path d="M11.5 4H5.5A1.5 1.5 0 0 0 4 5.5v6l8.5 8.5 7.5-7.5L11.5 4z" />
    <circle cx="8" cy="8" r="1.4" {...S} />
  </>,
  ease: <>
    <path d="M4 19C11.5 19 12.5 5 20 5" />
    <circle cx="4" cy="19" r="1.7" {...S} />
    <circle cx="20" cy="5" r="1.7" {...S} />
  </>,
  framelength: <>
    <path d="M4.5 5.5v13M19.5 5.5v13" />
    <path d="M4.5 12h15" />
    <path d="m9 8.5-3.5 3.5L9 15.5M15 8.5l3.5 3.5L15 15.5" />
  </>,
  framerate: <>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 7v5l3.5 2" />
  </>,
  fillcolor: <>
    <rect x="4" y="4" width="16" height="16" rx="2" />
    <rect x="7.5" y="7.5" width="9" height="9" rx="1" {...S} />
  </>,
  strokecolor: <rect x="5" y="5" width="14" height="14" rx="2" strokeWidth="3.5" />,
  paint: <>
    <path d="M12 3.5a8.5 8.5 0 0 0 0 17c1.4 0 2-1 1.6-2-.5-1.4.4-2.6 1.9-2.6h1.6a4 4 0 0 0 4-4c0-4.7-4.1-8.4-9.1-8.4z" />
    <circle cx="8.2" cy="10.2" r="1.2" {...S} />
    <circle cx="12" cy="7.6" r="1.2" {...S} />
    <circle cx="15.8" cy="10.2" r="1.2" {...S} />
  </>,
  sound: <>
    <path d="M5 9.5h3l4-3.5v12l-4-3.5H5z" />
    <path d="M15.5 9.5a3.5 3.5 0 0 1 0 5M18 7a7 7 0 0 1 0 10" />
  </>,
  volume: <>
    <path d="M5 9.5h3l4-3.5v12l-4-3.5H5z" />
    <path d="M15.5 9.5a3.5 3.5 0 0 1 0 5" />
  </>,
  multipleobjects: <>
    <rect x="3.5" y="3.5" width="10" height="10" rx="1.5" />
    <rect x="10.5" y="10.5" width="10" height="10" rx="1.5" />
  </>,
  onionskinning: <>
    <circle cx="7" cy="12" r="3.4" />
    <circle cx="12" cy="12" r="3.4" />
    <circle cx="17" cy="12" r="3.4" />
  </>,
  tween: <>
    <path d="m4 12 3-3 3 3-3 3z" {...S} />
    <path d="m14 12 3-3 3 3-3 3z" {...S} />
    <path d="M10.5 12h3" />
  </>,
  /*
   * A keyframe inside a record ring. The diamond is the same solid the timeline draws a key
   * with — `tween` above is two of them — and the ring is the borrowed half of the metaphor:
   * this is the mode where moving something records a key, which is what Hype calls Record.
   */
  autokey: <>
    <circle cx="12" cy="12" r="8.2" />
    <path d="m12 8 4 4-4 4-4-4z" {...S} />
  </>,

  // ---- objects and assets ----
  'path-object': <>
    <path d="M5 17.5c3.5-10 10.5-10 14 0" />
    <rect x="3" y="16" width="3.4" height="3.4" rx=".5" {...S} />
    <rect x="17.6" y="16" width="3.4" height="3.4" rx=".5" {...S} />
  </>,
  'clip-object': <>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
    <path d="M10.2 9.3 15 12l-4.8 2.7z" {...S} />
  </>,
  'button-object': <>
    <rect x="3.5" y="5.5" width="13" height="9.5" rx="2" />
    <path d="m13.5 13.5 7.5 4.6-3.3.7-1.3 3z" {...S} />
  </>,
  'text-object': <>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
    <path d="M8 9V8h8v1M12 8v8M10 16h4" />
  </>,
  'image-object': <>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
    <circle cx="8.5" cy="9.5" r="1.6" />
    <path d="m4 17.5 5-5 4 4 3-2.5 4.5 4.5" />
  </>,
  'layer-object': <>
    <path d="m12 3.5 8.5 4.5-8.5 4.5L3.5 8z" />
    <path d="m3.5 12.5 8.5 4.5 8.5-4.5" />
    <path d="m3.5 16.5 8.5 4.5 8.5-4.5" />
  </>,
  frame: <>
    <rect x="4" y="5" width="16" height="14" rx="1.5" />
    <circle cx="12" cy="12" r="2.6" {...S} />
  </>,
  asset: <>
    <path d="M13 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V9z" />
    <path d="M13 3.5V9h5.5" />
  </>,
  svg: <>
    <path d="M13 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V9z" />
    <path d="M13 3.5V9h5.5" />
    <path d="m10 13-2 2 2 2M14 13l2 2-2 2" />
  </>,
  circle: <circle cx="12" cy="12" r="8" />,

  // ---- timeline ----
  lock: <>
    <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
    <path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3" />
  </>,
  unlock: <>
    <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
    <path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 6.8-1.1" />
  </>,
  shown: <>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="3" />
  </>,
  hidden: <>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="3" />
    <path d="M4 20 20 4" />
  </>,
  copyForward: <>
    <rect x="3.5" y="6.5" width="7" height="11" rx="1" />
    <path d="M13 12h7.5M17.5 9l3 3-3 3" />
  </>,
  split: <>
    <rect x="3" y="6" width="7" height="12" rx="1" />
    <rect x="14" y="6" width="7" height="12" rx="1" />
    <path d="M12 3.5v17" strokeDasharray="2.5 2.5" />
  </>,
  layerTween: <>
    <path d="M3.5 12h17" />
    <path d="m6 12 3-3 3 3-3 3z" {...S} />
    <path d="m12 12 3-3 3 3-3 3z" {...S} />
  </>,
  curve: <>
    <path d="M4 18c0-8.5 16-8.5 16 0" />
    <circle cx="4" cy="18" r="1.7" {...S} />
    <circle cx="20" cy="18" r="1.7" {...S} />
  </>,
  point: <>
    <circle cx="12" cy="12" r="7" />
    <circle cx="12" cy="12" r="2.6" {...S} />
  </>,
  timeline: <>
    <rect x="3" y="6" width="18" height="12" rx="1.5" />
    <path d="M3 10h18M8 6v4M13 6v4M18 6v4" />
    <path d="M9.5 18v-8" />
  </>,

  /*
   * The timeline's own buttons — frame density and the two gap-fill modes. These are drawn
   * as what they do to the cells rather than as symbols for it: density is cell width, and
   * gap fill is either new blank cells or the cell to the left stretched across.
   */
  'frames-small': <>
    <path d="M4 8v8M7 8v8M10 8v8M13 8v8M16 8v8M20 8v8" />
  </>,
  'frames-normal': <>
    <path d="M4 7v10M9.3 7v10M14.6 7v10M20 7v10" />
  </>,
  'frames-large': <>
    <path d="M4 6v12M12 6v12M20 6v12" />
  </>,
  'frame-size-menu': <>
    <path d="M3 7v10M9 7v10M15 7v10" />
    <path d="m17.5 10 2.5 2.5 2.5-2.5" />
  </>,
  'gap-fill-blank': <>
    <rect x="3" y="7" width="5" height="10" rx="1" {...S} />
    <rect x="9.5" y="7" width="5" height="10" rx="1" strokeDasharray="2 2" />
    <rect x="16" y="7" width="5" height="10" rx="1" strokeDasharray="2 2" />
  </>,
  'gap-fill-extend': <>
    <rect x="3" y="7" width="5" height="10" rx="1" {...S} />
    <path d="M9 12h11M17.5 9.5 20 12l-2.5 2.5" />
  </>,
  'edit-timeline': <>
    <rect x="3" y="6" width="12" height="12" rx="1.5" />
    <path d="M3 10h12M8 6v4" />
    <path d="m13 20 .8-3.2L20 10.6a1.5 1.5 0 0 1 2.1 2.1L15.9 19z" />
  </>,

  // ---- interface ----
  gear: <>
    <circle cx="12" cy="12" r="3.2" />
    <circle cx="12" cy="12" r="7" />
    <path d="M12 2.5V5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M18.7 5.3l-1.8 1.8M7.1 16.9l-1.8 1.8" />
  </>,
  search: <>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="m15.4 15.4 5.1 5.1" />
  </>,
  add: <path d="M12 5v14M5 12h14" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  check: <path d="m4.5 12.5 5 5 10-11" />,
  autosave: <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="m8 12 3 3 5.5-6" />
  </>,
  warning: <>
    <path d="M12 4.5 21 19.5H3z" />
    <path d="M12 10v4.5M12 17.2h.01" />
  </>,
  warningdelete: <>
    <path d="M12 4.5 21 19.5H3z" />
    <path d="m9.8 11.5 4.4 4.4M14.2 11.5l-4.4 4.4" />
  </>,
  upload: <>
    <path d="M12 16V4M8 8l4-4 4 4" />
    <path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" />
  </>,
  load: <>
    <path d="M12 4v12M8 12l4 4 4-4" />
    <path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" />
  </>,
  export: <>
    <path d="M14 4h5.5A1.5 1.5 0 0 1 21 5.5v13a1.5 1.5 0 0 1-1.5 1.5H14" />
    <path d="M3 12h11M10.5 8.5 14 12l-3.5 3.5" />
  </>,
  create: <>
    <path d="M13 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V9z" />
    <path d="M13 3.5V9h5.5M12 12v5M9.5 14.5h5" />
  </>,
  hamburger: <path d="M4 7h16M4 12h16M4 17h16" />,
  outliner: <path d="m10 6-5 6 5 6M17 6l-5 6 5 6" />,
  /* The outliner's expand arrow. Points right; the row rotates it when it opens. */
  dropdown: <path d="M9.5 6.5 16 12l-6.5 5.5z" {...S} />,
  /* Onion skin, before and after the playhead. The solid frame is now. */
  'onion-backward': <>
    <rect x="12" y="6" width="8" height="12" rx="1" {...S} />
    <path d="M8.5 7.5v9M5 9v6" />
  </>,
  'onion-forward': <>
    <rect x="4" y="6" width="8" height="12" rx="1" {...S} />
    <path d="M15.5 7.5v9M19 9v6" />
  </>,
  play: <path d="M7 4.5 19.5 12 7 19.5z" {...S} />,
  pause: <>
    <rect x="6.5" y="4.5" width="4" height="15" rx="1" {...S} />
    <rect x="13.5" y="4.5" width="4" height="15" rx="1" {...S} />
  </>,
  /* The continuous picker, against `swatches`' discrete grid. A ramp, not the stripes the
     gradient tool already owns. */
  spectrum: <>
    <rect x="3.5" y="3.5" width="17" height="17" rx="2" />
    <path d="M20.5 5.5v13a2 2 0 0 1-2 2h-13z" {...S} />
  </>,
  swatches: <>
    <rect x="4" y="4" width="7" height="7" rx="1" />
    <rect x="13" y="4" width="7" height="7" rx="1" />
    <rect x="4" y="13" width="7" height="7" rx="1" />
    <rect x="13" y="13" width="7" height="7" rx="1" {...S} />
  </>,

  // ---- code editor ----
  codeObject: <>
    <rect x="4" y="4" width="16" height="16" rx="2.5" />
    <circle cx="12" cy="12" r="3.2" />
  </>,
  codeEvent: <path d="M13.5 3 6 13.5h5L10 21l7.5-10.5h-5z" />,
  codeInput: <>
    <rect x="3" y="7" width="18" height="10" rx="2" />
    <path d="M7 11h.01M10 11h.01M13 11h.01M16.5 11h.01M8 14h8" />
  </>,
  codeProject: <path d="M3.5 7.5V6A1.5 1.5 0 0 1 5 4.5h4l2 2.5h8A1.5 1.5 0 0 1 20.5 8.5V18A1.5 1.5 0 0 1 19 19.5H5A1.5 1.5 0 0 1 3.5 18z" />,
  codeRandom: <>
    <rect x="4" y="4" width="16" height="16" rx="3" />
    <circle cx="8.5" cy="8.5" r="1.3" {...S} />
    <circle cx="12" cy="12" r="1.3" {...S} />
    <circle cx="15.5" cy="15.5" r="1.3" {...S} />
  </>,
  codeConsole: <>
    <rect x="3" y="4.5" width="18" height="15" rx="2" />
    <path d="m7 9.5 3.2 2.5L7 14.5M13 15h4.5" />
  </>,
  codeBack: <path d="M20 12H5M11 6l-6 6 6 6" />,
};

/*
 * Aliases. Two kinds, and both are the point of the rewrite.
 *
 * The `-dark` / `-white` / `-black` names existed only because an <img> cannot change colour;
 * they are now the same drawing, tinted by whatever is around it. And several names are the
 * same idea reached by different call sites — an asset's `image` and an outliner row's
 * `image-object` were always going to be one picture.
 */
const ALIAS = {
  'add-dark': 'add',
  'upload-dark': 'upload',
  'timeline-dark': 'timeline',
  'breakApart-dark': 'breakApart',
  'button-object-dark': 'button-object',
  'clip-object-dark': 'clip-object',
  'layer-object-dark': 'layer-object',
  'delete-black': 'delete',
  'cancel-white': 'close',
  'create-white': 'create',
  'load-white': 'load',
  'gear-white': 'gear',
  cancel: 'close',
  closemodal: 'close',
  closetab: 'close',
  createGroup: 'group',
  addTween: 'tween',
  image: 'image-object',
  imageAsset: 'image-object',
  clip: 'clip-object',
  button: 'button-object',
  SoundAsset: 'sound',
  codeSound: 'sound',
  codeTimeline: 'timeline',
  font: 'fontfamily',
  Font: 'fontfamily',
  pressure: 'brushpressure',
  'outliner-hide': 'hidden',
  'outliner-lock': 'lock',
  layer: 'layer-object',
  path: 'path-object',
};

/** Resolves a name through the alias table. Exported so the coverage test can use it too. */
export function resolveIcon (name) {
  const key = ALIAS[name] ?? name;
  return ICONS[key] ?? null;
}

/*
 * `stroke-width` and the cap/join defaults live on the <svg>, not on every path, so a shape
 * that wants a heavier line (the brush modes, strokewidth) overrides one attribute instead of
 * restating four. `fill="none"` is the default for the same reason — the handful of filled
 * shapes opt in.
 */
/*
 * The same drawing as a data URI, for the one consumer that cannot take a DOM node: the
 * canvas timeline. `engine/src/gui/ActionButton.js` and `LayerButton.js` blit their icons
 * with `ctx.drawImage`, which needs a loaded <img>, which is why those sixteen buttons were
 * the last PNGs in the tree. An SVG data URI loads into an Image and draws vector-sharp.
 *
 * `color` has to be a resolved value, not `currentColor` — a data URI is its own document
 * with no element to inherit from. It is set on the root so the filled shapes, which do say
 * `currentColor`, still follow it.
 */
export function iconDataUri (name, { color = '#000', size = 64 } = {}) {
  const body = resolveIcon(name);
  if (!body) return null;
  const markup = renderToStaticMarkup(
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      color={color}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {body}
    </svg>,
  );
  return `data:image/svg+xml,${encodeURIComponent(markup)}`;
}

export function Icon ({ name, className, title }) {
  const body = resolveIcon(name);
  if (!body) return null;
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? 'img' : 'presentation'}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : 'true'}
      focusable="false"
    >
      {body}
    </svg>
  );
}
