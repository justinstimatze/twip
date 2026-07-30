/*
 * The Inspector's row layout: a right-aligned label, then one to three fields.
 *
 * Eight row types each hand-wrote the same three class names against _inspectorrow.scss,
 * which is why the widths drifted — the SCSS carried `$row-identifier-width: 30%` and three
 * derived widths, and any row that wanted something else added another rule. The geometry
 * lives here now, once.
 *
 * It no longer lives here as `30% / 70%`, because those percentages were of a sidebar the
 * user can only drag between 200px and 300px (Editor.jsx, the `sidebar` panel), and 30% of
 * that is 55px to 85px. Measured across all 38 label strings the panel can render, at 14px
 * bold Archivo: ten of them overflowed 55px, and "Full Rotations" (93px) and "Stroke Width"
 * (86px) overflowed at every width the panel can be, so they were clipped mid-word always
 * and no drag could reveal them. The same 30% was meanwhile spending 85px on "Y".
 *
 * So the label takes the width its text needs, over a floor of the old 30%, and the field
 * takes whatever is left. Every label that already fit still sits in that shared column,
 * which is what keeps a run of rows aligned down the panel; only the long ones push past it,
 * and every one of those is on a row with a single field to give the space up. The two-label
 * rows — Origin X/Y, Width/Height, Fill/Opacity — are short by construction, and give up a
 * pixel of input width at the 200px floor so that their labels never have to.
 *
 * `small` is a fixed cell that expects a sibling beside it (X next to Y). Everything else
 * fills the remainder, which is what `medium` at 50% and `large` at 70% were both hand-
 * computing from the label's 30% and each other.
 */
import React from 'react';
import { cn } from '@/lib/utils';

const FIELD_WIDTH = {
  small: 'w-[20%] min-w-[30px]',
  fill: 'flex-1',
};

export function InspectorRow ({ className, children }) {
  return (
    <div className={cn('mb-1 flex h-[26px] w-full flex-row last:mb-0', className)}>
      {children}
    </div>
  );
}

export function InspectorLabel ({ htmlFor, children }) {
  return (
    <label
      htmlFor={htmlFor}
      /* w-auto with nowrap sizes to the text; min-w-[30%] holds the shared column the short
         labels line up in. shrink-0 is what makes a two-label row work: its four cells add
         up to exactly 100%, so at the sidebar's 200px floor "Scale W" is a pixel over its
         share and something has to give. The label refusing means the two `small` fields
         give instead, by a pixel each, down to a 30px ceiling on how far they will go — and
         they are nowhere near it, since two labels and two floored inputs come to 171 of
         183px. A pixel off an input nobody can see beats a letter off a word they can.
         (A fixed px floor sized to fit "Scale W" was the other way to do this. It passed
         here and failed on CI by 0.7px: the same string measures wider in the runner's
         chromium, and any constant fitted to one renderer's metrics is fitted to one
         renderer.) A field is flex-1 off a zero base, so it never takes space a long label
         asked for. No left padding: right-aligned text only ever shrank the box. */
      className="mt-[3px] flex h-full w-auto min-w-[30%] shrink-0 flex-col overflow-hidden pr-[1.5%] pl-0 text-right text-sm font-bold whitespace-nowrap text-content"
    >
      {children}
    </label>
  );
}

export function InspectorField ({ size = 'fill', className, children }) {
  return (
    <div className={cn('flex flex-col items-center pl-[1.5%] last:pr-0', FIELD_WIDTH[size], className)}>
      {children}
    </div>
  );
}
