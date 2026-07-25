/*
 * Popover primitive on Radix.
 *
 * Replaces two separate popover libraries that were doing the same job: reactstrap's
 * `Popover` (PopupMenu, ColorPicker) and react-popover (SettingsNumericSlider). reactstrap
 * is the reason `bootstrap/dist/css/bootstrap.min.css` was imported in nine files — its
 * popover has no styles of its own and reads `.popover` out of the bootstrap sheet.
 *
 * Both old libraries anchored by passing a DOM id string (`target="..."`), looked up with
 * getElementById. `AnchoredPopover` keeps that shape so the three call sites don't have to
 * restructure, but it feeds the resolved element to Radix as a virtual anchor rather than
 * measuring it by hand on a 200ms interval, which is what react-popover's
 * `refreshIntervalMs={200}` was doing.
 *
 * What the swap adds: Escape closes, focus moves into the content and is trapped there
 * while open, focus returns to the anchor on close, and the content is portalled so a
 * panel's `overflow: hidden` can't clip it.
 */
import React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { cn } from '@/lib/utils';

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
// Renders a plain div wrapping its children and positions against it. For anchors that
// are not themselves the thing you click to open — SettingsNumericSlider opens on focus.
export const PopoverAnchor = PopoverPrimitive.Anchor;

export const PopoverContent = React.forwardRef(function PopoverContent (
  { className, side = 'bottom', align = 'center', sideOffset = 6, ...props }, ref,
) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        ref={ref}
        side={side}
        align={align}
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn('z-50 rounded-md shadow-lg outline-none', className)}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
});

/**
 * Popover anchored to an element found by id, for call sites written against
 * reactstrap's `target` prop.
 *
 * The lookup runs on open rather than on mount: at mount the anchor may not exist yet
 * (Toolbox builds its dropdown anchors from a map during the same render), and an id that
 * resolved once can point at a different element after a re-render.
 */
export function AnchoredPopover ({ target, open, onOpenChange, children, ...contentProps }) {
  const anchorRef = React.useRef(null);
  // Held in state, not just the ref, so that resolving the anchor triggers the render
  // Radix needs in order to read `virtualRef.current`.
  const [anchor, setAnchor] = React.useState(null);

  React.useLayoutEffect(() => {
    const element = open ? document.getElementById(target) : null;
    anchorRef.current = element;
    setAnchor(element);
  }, [target, open]);

  return (
    <PopoverPrimitive.Root open={open && !!anchor} onOpenChange={onOpenChange}>
      <PopoverPrimitive.Anchor virtualRef={anchorRef} />
      <PopoverContent {...contentProps}>{children}</PopoverContent>
    </PopoverPrimitive.Root>
  );
}
