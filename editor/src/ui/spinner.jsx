/*
 * Spinner.
 *
 * Replaces react-spinners, a whole dependency for what one element and one keyframe does.
 * `border-t-transparent` on a round border is the ring-with-a-gap; `animate-spin` is
 * Tailwind's built-in rotate keyframe.
 *
 * `role="status"` plus the visually-hidden label is the part react-spinners left to the
 * caller and the caller did not do: without it a screen reader hears nothing at all while
 * the audio decodes, and the play button simply appears later with no explanation.
 */
import React from 'react';
import { cn } from '@/lib/utils';

export function Spinner ({ size = 20, className, label = 'Loading' }) {
  return (
    <span role="status" className={cn('inline-block', className)}>
      <span
        aria-hidden
        className="block animate-spin rounded-full border-2 border-current border-t-transparent"
        style={{ width: size, height: size }}
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}
