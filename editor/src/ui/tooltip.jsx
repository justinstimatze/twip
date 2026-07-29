/*
 * Tooltip primitive on Radix.
 *
 * Replaces react-tooltip 4, whose model was a singleton component rendered next to the
 * trigger and wired by matching `data-for` to an `id` string. That indirection is why
 * WickInput has a `tooltipID` prop and a literal 'action-button-tooltip-nyi' fallback for
 * call sites that forgot one — two elements sharing an id silently shared a tooltip.
 *
 * Radix takes the trigger as a child instead, so there is no id to get wrong. It also
 * handles what the old one did not: Escape to dismiss, focus as well as hover (a
 * keyboard-only user never saw a tooltip before), and aria-describedby wiring so the text
 * is actually announced rather than being a floating div.
 */
import React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from '@/lib/utils';

export const TooltipProvider = TooltipPrimitive.Provider;

/**
 * Wraps `children` in a tooltip. Renders children untouched when there is no text, so a
 * call site can pass `tooltip={undefined}` without branching.
 */
export function Tooltip ({ content, side = 'bottom', delay = 200, children, className }) {
  if (!content) return children;
  return (
    <TooltipPrimitive.Root delayDuration={delay}>
      <TooltipPrimitive.Trigger
        asChild
        /*
         * Radix opens a tooltip on any focus, including focus moved by script. A popover
         * moves focus to the first control inside itself when it opens, and in the color
         * picker that control has a tooltip — so clicking the swatch popped a "Swatches"
         * tooltip on top of the picker, and because a tooltip is a dismissable layer and
         * it mounted last, it swallowed the first Escape. The picker looked like it was
         * ignoring the key.
         *
         * Radix's onFocus is composed with checkForDefaultPrevented, so preventing the
         * default here suppresses the open. `:focus-visible` is the line: it is true when
         * the user tabbed here and false when a pointer put focus here, which is exactly
         * the difference between wanting the label and not.
         */
        onFocus={(event) => {
          if (!event.target.matches?.(':focus-visible')) event.preventDefault();
        }}
      >{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className={cn(
            'z-50 max-w-xs rounded-sm border border-line bg-ash-950 px-2 py-1 text-micro text-content',
            'shadow-md select-none',
            'data-[state=delayed-open]:animate-in data-[state=closed]:animate-out',
            className,
          )}
        >
          {content}
          <TooltipPrimitive.Arrow className="fill-ash-950" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
