/*
 * TimelineMirror — the timeline as a DOM grid, for the keyboard and the screen reader.
 *
 * The timeline is drawn to a <canvas> by 3,733 lines under engine/src/gui/, and a canvas has
 * no contents as far as assistive technology is concerned: no elements to enumerate, nothing
 * to focus, nothing to announce. The obvious fix is to rewrite the timeline in DOM, and the
 * measurement in dev/perf.mjs argues against it — FramesContainer culls to the scroll
 * viewport, so a 24-layer 400-frame document redraws in 1.0ms and a DOM grid of the same
 * document would have to reimplement that culling to keep up.
 *
 * So this is the other approach, and the one Figma took for the same problem: keep the canvas
 * renderer and mirror the model into a parallel DOM tree that is visually hidden and fully
 * focusable. It reads the same layers and frames the canvas draws, and it drives the same
 * setters the mouse does, so there is no second source of truth — just a second way in.
 *
 * A cell is a frame, not a playhead position. A layer 400 positions long is usually a handful
 * of frames, and ARIA models exactly this: aria-colcount carries the timeline's true length
 * while aria-colindex and aria-colspan place a frame across the columns it occupies. That is
 * both more truthful to a listener ("keyframe, frames 1 to 400" beats four hundred identical
 * cells) and bounded by the number of frames rather than the length of the document, which is
 * what keeps this from costing what the DOM rewrite would have.
 *
 * Gaps are cells too. A layer with a hole in it is a thing you can arrow into and be told
 * about, because the alternative is silence over the part of the timeline that is missing.
 *
 * Moving focus moves the playhead and the active layer, exactly as the arrow-key shortcuts in
 * EditorCore do, and redraws the canvas — so a sighted keyboard user sees the playhead track
 * their cursor. It deliberately does not go through projectDidChange: navigating is not an
 * edit, and one undo state per arrow key would bury the history.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/* Frames and the holes between them, left to right, covering the whole timeline. */
function segmentsFor (layer, length) {
  const frames = [...(layer.frames || [])].sort((a, b) => a.start - b.start);
  const out = [];
  let at = 1;
  for (const frame of frames) {
    if (frame.start > at) out.push({ kind: 'gap', start: at, end: frame.start - 1 });
    out.push({ kind: 'frame', start: frame.start, end: frame.end, frame });
    at = Math.max(at, frame.end + 1);
  }
  if (at <= length) out.push({ kind: 'gap', start: at, end: length });
  return out.length ? out : [{ kind: 'gap', start: 1, end: Math.max(1, length) }];
}

const span = (s) => (s.end > s.start ? `frames ${s.start} to ${s.end}` : `frame ${s.start}`);

function describe (segment) {
  if (segment.kind === 'gap') return `empty, ${span(segment)}`;
  const { frame } = segment;
  const parts = [`${frame.contentful ? 'drawing' : 'blank'} keyframe`, span(segment)];
  const tweens = frame.tweens ? frame.tweens.length : 0;
  if (tweens) parts.push(`${tweens} tween${tweens === 1 ? '' : 's'}`);
  if (frame.sound) parts.push('sound');
  return parts.join(', ');
}

function describeLayer (layer, index) {
  const parts = [layer.name || `Layer ${index + 1}`];
  if (layer.hidden) parts.push('hidden');
  if (layer.locked) parts.push('locked');
  return parts.join(', ');
}

export default function TimelineMirror ({ project, projectData, projectDidChange }) {
  const [cursor, setCursor] = useState({ row: 0, col: 0 });
  const [said, setSaid] = useState('');
  const gridRef = useRef(null);
  const wanted = useRef(null);

  const timeline = project && project.activeTimeline;

  /* Keyed on projectData, not on the project. The engine mutates its model in place, so the
   * `project` reference is the same object before and after a layer is added and a memo that
   * watches it never rebuilds — which is not a hypothetical, it is what the first version of
   * this did, and dev/a11y-timeline-check.mjs caught it announcing a one-layer timeline over a
   * three-layer document. `projectData` is Editor's serialization, replaced on every commit. */
  const rows = useMemo(() => {
    if (!timeline) return [];
    const length = Math.max(1, timeline.length || 1);
    return timeline.layers.map((layer, i) => ({
      layer,
      label: describeLayer(layer, i),
      segments: segmentsFor(layer, length),
    }));
  }, [timeline, projectData]);

  const length = timeline ? Math.max(1, timeline.length || 1) : 1;

  /* Keep the cursor inside a timeline that may have lost the row or frame it was on. */
  const row = Math.min(cursor.row, Math.max(0, rows.length - 1));
  const col = Math.min(cursor.col, Math.max(0, (rows[row]?.segments.length ?? 1) - 1));

  /* The same four calls EditorCore's playhead shortcuts make. Not projectDidChange: moving a
   * cursor is not an edit, and undo should not fill up with arrow keys. */
  const go = useCallback((nextRow, wantCol) => {
    const target = rows[nextRow];
    if (!target) return;
    /* Rows are different lengths — a layer holding one long frame is one cell, the layer
     * under it might be five — so moving between them clamps the column. Refusing the move
     * instead, which is what this did first, makes a short row a wall you cannot cross. */
    const nextCol = Math.max(0, Math.min(target.segments.length - 1, wantCol));
    const segment = target.segments[nextCol];
    if (!segment) return;
    setCursor({ row: nextRow, col: nextCol });
    wanted.current = `${nextRow}:${nextCol}`;
    if (!project) return;
    project.activeTimeline.activeLayerIndex = nextRow;
    project.activeTimeline.playheadPosition = segment.start;
    project.guiElement.checkForPlayheadAutoscroll();
    project.view.render();
    project.guiElement.draw();
  }, [rows, project]);

  /* Focus follows the cursor only when this grid moved it, so a re-render caused by something
   * else on the page cannot steal focus away from wherever the user actually is. */
  useEffect(() => {
    if (!wanted.current || !gridRef.current) return;
    const cell = gridRef.current.querySelector(`[data-cell="${wanted.current}"]`);
    wanted.current = null;
    if (cell) cell.focus();
  });

  const onKeyDown = (event) => {
    const segments = rows[row]?.segments ?? [];
    const keys = {
      ArrowRight: () => go(row, Math.min(segments.length - 1, col + 1)),
      ArrowLeft: () => go(row, Math.max(0, col - 1)),
      ArrowDown: () => go(Math.min(rows.length - 1, row + 1), col),
      ArrowUp: () => go(Math.max(0, row - 1), col),
      Home: () => go(row, 0),
      End: () => go(row, segments.length - 1),
    };
    const move = keys[event.key];
    if (move) {
      event.preventDefault();
      event.stopPropagation();
      move();
      return;
    }
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
    const segment = segments[col];
    if (!segment || segment.kind !== 'frame' || !project) return;
    project.selection.clear();
    project.selection.select(segment.frame);
    projectDidChange({ actionName: 'Select Frame' });
    setSaid(`Selected ${describe(segment)} on ${rows[row].label}`);
  };

  if (!timeline || !rows.length) return null;

  return (
    <>
      {/* sr-only rather than hidden: display:none and visibility:hidden both take an element
          out of the accessibility tree, which would remove the only thing this file is for. */}
      <div
        ref={gridRef}
        role="grid"
        aria-label="Timeline frames"
        aria-rowcount={rows.length}
        aria-colcount={length}
        className="sr-only"
        onKeyDown={onKeyDown}
      >
        {rows.map((r, i) => (
          <div key={i} role="row" aria-rowindex={i + 1}>
            <span role="rowheader" aria-colindex={1}>{r.label}</span>
            {r.segments.map((segment, j) => (
              <span
                key={`${segment.kind}-${segment.start}`}
                role="gridcell"
                data-cell={`${i}:${j}`}
                aria-colindex={segment.start}
                aria-colspan={segment.end - segment.start + 1}
                aria-selected={i === row && j === col}
                tabIndex={i === row && j === col ? 0 : -1}
                onFocus={() => setCursor({ row: i, col: j })}
              >
                {describe(segment)}
              </span>
            ))}
          </div>
        ))}
      </div>
      <div role="status" aria-live="polite" className="sr-only">{said}</div>
    </>
  );
}
