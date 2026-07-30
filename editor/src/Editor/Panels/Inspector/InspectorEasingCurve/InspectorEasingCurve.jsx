/*
 * The easing graph — a tween's curve, drawn and draggable.
 *
 * docs/ui-research.md lists "easing dropdown → a graph/curve editor with draggable Bézier
 * plus an auto-smooth option" among the things that date the interface. The dropdown stays:
 * twenty-five named curves are good presets, they are what the .wick format has always
 * carried, and picking "out-bounce" by name is faster than drawing it. What was missing is
 * being able to SEE the curve, and to draw one the list does not contain.
 *
 * Every easing plots the same way, named ones included, through Wick.Tween.sampleEasing. So
 * the graph is never blank and never lies: switch the dropdown to out-back and the overshoot
 * is right there, which is also how you learn what the names mean. Press "Edit as curve" and
 * the handles appear where that shape left off.
 *
 * The plotted band runs from -0.35 to 1.35 rather than 0 to 1, because the interesting curves
 * leave the unit square. Back overshoots, bounce undershoots, and a control point dragged
 * above the top is how you ask for anticipation. Clipping the graph at 1 would draw those as
 * flat lines against the ceiling and quietly teach that they do not exist.
 */
import React, { useCallback, useRef, useState } from 'react';
import ActionButton from 'Editor/Util/ActionButton/ActionButton';

/* Curve space -> SVG space. x is time and stays in [0,1]; y has room to leave it. */
const PAD = 6;
const SPAN = 100 - PAD * 2;
const Y_LOW = -0.35;
const Y_HIGH = 1.35;
const sx = (x) => PAD + x * SPAN;
const sy = (y) => PAD + (Y_HIGH - y) / (Y_HIGH - Y_LOW) * SPAN;
const fromSx = (x) => (x - PAD) / SPAN;
const fromSy = (y) => Y_HIGH - (y - PAD) / SPAN * (Y_HIGH - Y_LOW);

const round = (n) => Math.round(n * 100) / 100;
const clamp01 = (n) => Math.max(0, Math.min(1, n));

/* Enough samples that a bounce reads as a bounce rather than as a polygon. */
const SAMPLES = 64;

function curvePoints (easingType, bezier) {
  const sample = window.Wick.Tween.sampleEasing;
  const points = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    points.push(`${sx(t).toFixed(2)},${sy(sample(easingType, bezier, t)).toFixed(2)}`);
  }
  return points.join(' ');
}

export default function InspectorEasingCurve ({ easingType, bezier, onChange, onSmooth, onEdit }) {
  const svgRef = useRef(null);
  const [dragging, setDragging] = useState(null);
  const editable = easingType === 'custom';
  const points = bezier || window.Wick.Tween.DEFAULT_BEZIER;

  /* A control point is (x, y); handle 0 is [0],[1] and handle 1 is [2],[3]. */
  const at = (which) => [points[which * 2], points[which * 2 + 1]];

  const move = useCallback((which, x, y, commit) => {
    const next = points.slice();
    next[which * 2] = clamp01(round(x));
    next[which * 2 + 1] = round(y);
    onChange(next, commit);
  }, [points, onChange]);

  /*
   * Pointer capture on the svg rather than the handle: a fast drag leaves the 4px circle
   * behind between two pointermove events, and without capture the gesture would end wherever
   * the pointer happened to escape.
   */
  const toCurve = (event) => {
    const box = svgRef.current.getBoundingClientRect();
    return [
      fromSx(((event.clientX - box.left) / box.width) * 100),
      fromSy(((event.clientY - box.top) / box.height) * 100),
    ];
  };

  const onPointerDown = (which) => (event) => {
    if(!editable) return;
    event.preventDefault();
    event.stopPropagation();
    svgRef.current.setPointerCapture(event.pointerId);
    setDragging(which);
  };

  const onPointerMove = (event) => {
    if(dragging === null) return;
    const [x, y] = toCurve(event);
    move(dragging, x, y, false);
  };

  const onPointerUp = (event) => {
    if(dragging === null) return;
    const [x, y] = toCurve(event);
    move(dragging, x, y, true);
    setDragging(null);
    if(svgRef.current.hasPointerCapture(event.pointerId)) svgRef.current.releasePointerCapture(event.pointerId);
  };

  /* Arrow keys, because a handle you can only reach with a mouse is a handle half the
   * people who need precision cannot use. Shift takes the coarse step. */
  const onKeyDown = (which) => (event) => {
    const step = event.shiftKey ? 0.1 : 0.02;
    const deltas = {
      ArrowLeft: [-step, 0], ArrowRight: [step, 0],
      ArrowUp: [0, step], ArrowDown: [0, -step],
    };
    const delta = deltas[event.key];
    if(!delta) return;
    event.preventDefault();
    event.stopPropagation();
    const [x, y] = at(which);
    move(which, x + delta[0], y + delta[1], true);
  };

  /*
   * Only while the curve is editable. A named easing is not a Bézier, so the stored control
   * points have nothing to do with the line being drawn — showing them anyway puts two
   * handles and their tangents next to a curve they do not touch, which reads as a broken
   * graph rather than as a read-only one.
   */
  const handle = (which) => {
    const [x, y] = at(which);
    return (
      <g key={which}>
        <line
          x1={sx(which === 0 ? 0 : 1)} y1={sy(which === 0 ? 0 : 1)}
          x2={sx(x)} y2={sy(y)}
          className="stroke-content-subtle" strokeWidth="0.8" />
        <circle
          cx={sx(x)} cy={sy(y)} r="3.4"
          tabIndex={0}
          role="button"
          aria-label={`Control point ${which + 1}, x ${x.toFixed(2)}, y ${y.toFixed(2)}`}
          onPointerDown={onPointerDown(which)}
          onKeyDown={onKeyDown(which)}
          className="fill-accent cursor-grab focus:outline-none focus-visible:stroke-content"
          strokeWidth="1.2" />
      </g>
    );
  };

  return (
    <div className="flex w-full flex-col gap-1">
      <svg
        ref={svgRef}
        viewBox="0 0 100 100"
        role="img"
        aria-label={`Easing curve, ${easingType}${editable ? `, cubic-bezier(${points.map(round).join(', ')})` : ''}`}
        className="w-full touch-none rounded-sm bg-surface-sunken"
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}>
        {/* The unit square, so "finished" and "not started yet" have somewhere to be read
            against once the curve leaves them. */}
        <rect
          x={sx(0)} y={sy(1)} width={SPAN} height={sy(0) - sy(1)}
          className="fill-none stroke-line" strokeWidth="0.6" />
        {/* Linear, for comparison. Every curve is a departure from this line. */}
        <line
          x1={sx(0)} y1={sy(0)} x2={sx(1)} y2={sy(1)}
          className="stroke-line" strokeWidth="0.6" strokeDasharray="2 2" />
        <polyline
          points={curvePoints(easingType, points)}
          className="fill-none stroke-accent" strokeWidth="1.6"
          strokeLinecap="round" strokeLinejoin="round" />
        {editable && handle(0)}
        {editable && handle(1)}
      </svg>

      <div className="flex flex-row items-center gap-1">
        <span className="flex-1 truncate font-mono text-[10px] text-content-subtle" data-curve>
          {editable ? `cubic-bezier(${points.map(round).join(', ')})` : easingType}
        </span>
        {!editable && (
          <ActionButton
            color="inspector"
            id="inspector-button-edit-curve"
            action={onEdit}
            text="Edit as curve" />
        )}
        <ActionButton
          color="inspector"
          id="inspector-button-smooth-curve"
          action={onSmooth}
          text="Smooth" />
      </div>
    </div>
  );
}
