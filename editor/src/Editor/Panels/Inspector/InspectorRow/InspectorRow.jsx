/*
 * The Inspector's row layout: a right-aligned label, then one to three fields.
 *
 * Eight row types each hand-wrote the same three class names against _inspectorrow.scss,
 * which is why the widths drifted — the SCSS carried `$row-identifier-width: 30%` and three
 * derived widths, and any row that wanted something else added another rule. The geometry
 * lives here now, once, in the same percentages the SCSS used.
 *
 * `small` fits two per row (X and Y, Width and Height), `large` is the only field on the
 * row, `medium` leaves room for a small one beside it.
 */
import React from 'react';
import { cn } from '@/lib/utils';

const FIELD_WIDTH = {
  small: 'w-[20%] min-w-[30px]',
  medium: 'w-[50%]',
  large: 'w-[70%]',
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
      /* first:pl-0 so the leading label sits flush with the panel padding, and the second
         label on a two-field row still gets its gutter. */
      className="mt-[3px] flex h-full w-[30%] max-w-[30%] flex-col overflow-hidden px-[1.5%] text-right text-sm font-bold whitespace-nowrap text-content first:pl-0"
    >
      {children}
    </label>
  );
}

export function InspectorField ({ size = 'large', className, children }) {
  return (
    <div className={cn('flex flex-col items-center pl-[1.5%] last:pr-0', FIELD_WIDTH[size], className)}>
      {children}
    </div>
  );
}
