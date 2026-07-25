/*
 * Resizable panel primitives, wrapping react-resizable-panels v4.
 *
 * Replaces react-reflex, which is where the React 19 upgrade actually stopped: reflex 3 and
 * 5 both throw "Expected ref to be a function, an object returned by React.createRef(), or
 * undefined/null" out of <ReflexElement> under React 19, and reflex has not shipped since.
 *
 * Two things improve beyond the swap being forced. v4's <Separator> renders a real
 * role="separator" with the WAI-ARIA properties and arrow-key resizing, which reflex's
 * splitter never had — panel layout becomes reachable without a mouse. And sizes accept
 * explicit units, so the pixel sizes the old shell was written against (250px sidebar,
 * 175px timeline) survive the move rather than being re-guessed as percentages.
 */
import React from 'react';
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels';
import { cn } from '@/lib/utils';

export { Panel, useDefaultLayout };

export function PanelGroup ({ className, ...props }) {
  return (
    <Group
      className={cn('flex h-full w-full data-[orientation=vertical]:flex-col', className)}
      {...props}
    />
  );
}

/*
 * The drag target is deliberately larger than the visible line. The visible rule is 1px of
 * surface-sunken, matching the old splitter's colour, but the hit area is the full
 * --spacing-splitter (4px) plus 2px of invisible padding either side via the ::after — a
 * 1px grab target is the kind of thing that reads as "the panels don't resize".
 */
export function PanelSeparator ({ className, ...props }) {
  return (
    <Separator
      className={cn(
        'relative shrink-0 bg-surface-sunken transition-colors',
        'data-[orientation=horizontal]:h-full data-[orientation=horizontal]:w-[var(--spacing-splitter)]',
        'data-[orientation=vertical]:h-[var(--spacing-splitter)] data-[orientation=vertical]:w-full',
        'hover:bg-accent data-[state=drag]:bg-accent',
        'focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-0',
        'after:absolute after:inset-0',
        'data-[orientation=horizontal]:after:-inset-x-1',
        'data-[orientation=vertical]:after:-inset-y-1',
        className,
      )}
      {...props}
    />
  );
}
