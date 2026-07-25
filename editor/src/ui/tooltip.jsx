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
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className={cn(
            'z-50 max-w-xs rounded-sm bg-wick-sky px-2 py-1 text-sm text-[#222222]',
            'shadow-md select-none',
            'data-[state=delayed-open]:animate-in data-[state=closed]:animate-out',
            className,
          )}
        >
          {content}
          <TooltipPrimitive.Arrow className="fill-wick-sky" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
