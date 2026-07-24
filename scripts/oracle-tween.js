// Confirms the twip tween-semantics decision empirically. Reproduces the RECONSTRUCT
// half of the wick-editor fork's default tweenMethod:'normal' path VERBATIM from
// engine/dist/wickengine.js (Wick.Transformation.toMatrixPaper @46830 + .fromMatrix
// @46770), and compares it to plain per-property lerp (what twip's interp_tween does).
//
// The fork's interpolate() 'normal' branch does:
//   paperTransform = lerp each of {x,y,scaleX,scaleY,rotation,skew}
//   result = fromMatrix( toMatrixPaper(paperTransform) )     // <-- the buggy round-trip
// We reproduce toMatrixPaper + fromMatrix exactly. (The input-side paperValues getter
// uses paper.Matrix.decompose and is ~identity for well-behaved matrices; not needed to
// show the reconstruct-side corruption.)

// ---- verbatim from the fork ----
function toMatrixPaper(args) {
  const { x, y, scaleX, scaleY, rotation, skew } = args;
  const degrees = 180 / Math.PI,
        rotateRad = rotation / degrees,
        skewRad = skew / degrees;
  let a, b, c, d;
  if (skew.x === 0) a = b = c = d = 0; else {   // <-- dead guard: skew is a Number, skew.x is undefined
    let r = scaleX, det = scaleY * r, at = Math.tan(skewRad) * r * r;
    a = Math.cos(rotateRad) * r;
    b = Math.sqrt(r * r - a * a) * (rotateRad > 0 ? 1 : -1);
    d = (b * at + a * det) / (a * a + b * b);
    c = (at - b * d) / a;
  }
  return [a, b, c, d, x, y];
}
function fromMatrix(values) {
  const [a, b, c, d, tx, ty] = values;
  const rotationX = Math.atan2(b, a) * 180 / Math.PI,
        rotationY = Math.atan2(-c, d) * 180 / Math.PI,
        scaleX = Math.sqrt(a * a + b * b),
        scaleY = Math.sqrt(c * c + d * d);
  return { x: tx, y: ty, scaleX, scaleY, rotation: rotationX, skew: rotationY - rotationX };
}
// the fork's reconstruct, and the sane per-property identity
const forkNormal = (s) => fromMatrix(toMatrixPaper(s));
const round = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v * 1e4) / 1e4]));

const show = (label, s) => {
  const out = forkNormal(s);
  console.log(`\n${label}`);
  console.log(`  input (per-property, = twip): ${JSON.stringify(s)}`);
  console.log(`  fork 'normal' reconstruct   : ${JSON.stringify(round(out))}`);
};

console.log("=== 1. WELL-BEHAVED: fork round-trip is identity (twip agrees exactly) ===");
show("scaleX=2 scaleY=1 rot=45 skew=0", { x: 50, y: 0, scaleX: 2, scaleY: 1, rotation: 45, skew: 0 });

console.log("\n=== 2. NEGATIVE SCALE (horizontal flip): fork corrupts it ===");
show("scaleX=-2 scaleY=1 rot=0 skew=0", { x: 0, y: 0, scaleX: -2, scaleY: 1, rotation: 0, skew: 0 });
console.log("  -> fork turns a MIRROR (scaleX<0) into +scale + 180deg rotation: visually wrong.");

console.log("\n=== 3. A FLIP TWEEN scaleX 1 -> -1 (per-property lerp of scaleX): where the fork breaks ===");
for (const t of [0, 0.25, 0.5, 0.75, 1]) {
  const sx = 1 - 2 * t;                                  // per-property linear
  show(`t=${t}  scaleX=${sx}`, { x: 0, y: 0, scaleX: sx, scaleY: 1, rotation: 0, skew: 0 });
}
console.log("\n  twip keeps scaleX linear through 0 to -1 (a smooth flip).");
console.log("  the fork's scaleX stays >=0 and instead SNAPS rotation 0->180 at the midpoint.");

console.log("\n=== 4. DEAD skew.x===0 GUARD: skew is a Number, so skew.x is undefined ===");
console.log("  (0).x =", (0).x, " -> (skew.x === 0) is", ((0).x === 0), "-> guard never fires, always takes else.");

// ---- toMatrix: the RENDER matrix, verbatim from engine/src/Transformation.js:102 ----
// View.Clip.js:176 does `group.matrix.set(transformation.toMatrix())`, so this — not the
// paper round-trip above — defines what skew MEANS on screen. twip's Transform::matrix()
// reproduces it; the numbers below are the expected values pasted into the Rust tests.
function toMatrix({ x, y, scaleX, scaleY, rotation, skew }) {
  const rotationX = rotation * Math.PI / 180,
        rotationY = (skew + rotation) * Math.PI / 180;
  const a = scaleX * Math.cos(rotationX),
        b = scaleX * Math.sin(rotationX),
        d = scaleY * Math.cos(rotationY),
        c = -scaleY * Math.sin(rotationY);
  return [a, b, c, d, x, y];
}

console.log("\n=== 5. SKEW -> RENDER MATRIX (Transformation.toMatrix, what the fork draws) ===");
const skewCases = [
  ["identity, skew=0", { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, skew: 0 }],
  ["skew=30", { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, skew: 30 }],
  ["skew=-30 (mirror of the above)", { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, skew: -30 }],
  ["skew=30 scaleY=2", { x: 0, y: 0, scaleX: 1, scaleY: 2, rotation: 0, skew: 30 }],
  ["rot=45 skew=30", { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 45, skew: 30 }],
  ["skew tween midpoint 0->30", { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, skew: 15 }],
];
for (const [label, s] of skewCases) {
  const [a, b, c, d] = toMatrix(s).map((v) => Math.round(v * 1e6) / 1e6);
  console.log(`  ${label.padEnd(32)} a=${a}  b=${b}  c=${c}  d=${d}`);
}
console.log("  determinant is scaleX*scaleY*cos(skew): area SHRINKS as skew grows, and");
console.log("  skew=+-90 collapses it to zero. Signed skew round-trips through fromMatrix");
console.log("  (skew = rotationY - rotationX) with no decompose, unlike the paper path above.");
