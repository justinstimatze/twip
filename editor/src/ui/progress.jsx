/*
 * Determinate progress bar.
 *
 * The last thing reactstrap was doing, and the reason nine files imported bootstrap's
 * stylesheet: `<Progress striped animated color="warning">`. It is one filled div and one
 * gradient, and it was the only reactstrap component in the tree that was not a popover.
 *
 * The old one rendered `role="progressbar"` with aria-valuenow but no accessible name, so
 * a screen reader announced a number with nothing attached to it. `label` fixes that; the
 * value is announced as a percentage by the platform.
 */
import React from 'react';
import { cn } from '@/lib/utils';

export function Progress ({ value = 0, done = false, striped = false, animated = false, label, className }) {
  const pct = Math.max(0, Math.min(100, Number(value) || 0));

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn('h-4 w-full overflow-hidden rounded-sm bg-surface-input', className)}
    >
      <div
        className={cn(
          'h-full transition-[width] duration-150 ease-linear',
          done ? 'bg-accent' : 'bg-wick-yellow-dark',
          striped && 'progress-stripes',
          animated && 'progress-stripes-animated',
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
