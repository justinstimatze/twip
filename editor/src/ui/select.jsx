/*
 * Select primitive on Radix.
 *
 * Replaces react-select 2 (2018), which rendered a div-based listbox and needed a
 * 20-line inline `styles` object in WickInput to look like the rest of the editor —
 * including `control: () => ({})`, which threw away react-select's own control styling
 * entirely so the SCSS could take over. Radix styles through className, so the control
 * lives with every other control's styling instead of in a JS object.
 *
 * What comes with it: typeahead, Home/End, Escape, arrow-key navigation with the listbox
 * roles and aria-activedescendant already wired, and a portal that positions against the
 * trigger without the `menuPortalTarget: document.body` + `menuPosition: 'fixed'` pair the
 * old call site needed to escape the panel's overflow.
 */
import React from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * @param {{label: string, value: string}[]} options
 * @param {(option: {label: string, value: string}) => void} onChange
 *   Called with the whole option object, not the bare value — matching what react-select
 *   passed, because all 17 WickInput call sites are written against that shape.
 */
export function Select ({ options = [], value, onChange, onOpenChange, id, className, itemClassName, placeholder, disabled }) {
  const selected = options.find((o) => o.value === value);

  return (
    <SelectPrimitive.Root
      value={value === undefined || value === null ? undefined : String(value)}
      disabled={disabled}
      onOpenChange={onOpenChange}
      onValueChange={(next) => {
        if (!onChange) return;
        onChange(options.find((o) => String(o.value) === next) ?? { label: next, value: next });
      }}
    >
      <SelectPrimitive.Trigger
        id={id}
        className={cn(
          'flex h-[26px] w-full items-center justify-between gap-1 rounded-md',
          'bg-white px-2 text-base text-[#535353]',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'data-[placeholder]:text-content-on-light',
          className,
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder}>
          {selected ? selected.label : undefined}
        </SelectPrimitive.Value>
        <SelectPrimitive.Icon asChild>
          <ChevronDown className="size-4 opacity-60" aria-hidden />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>

      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          className="z-50 max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md bg-white shadow-lg"
        >
          <SelectPrimitive.Viewport className="p-1">
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={String(option.value)}
                className={cn(
                  'relative flex h-[26px] cursor-default items-center rounded-xs pr-7 pl-2',
                  'text-base whitespace-nowrap text-black select-none',
                  'data-[highlighted]:bg-accent data-[highlighted]:outline-none',
                  itemClassName,
                  // Per-option, for the font list's "already in this project" highlight.
                  // react-select read option.className and the Radix swap stopped, which
                  // dropped that affordance silently.
                  option.className,
                )}
                // Per-option style, which is how the font list previews each face in its own
                // font. Was `className === 'font-family'` and never fired: WickInput sends
                // "wick-input-select font-family", so the equality failed and the preview had
                // been dead since the react-select swap.
                style={option.style}
              >
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="absolute right-2">
                  <Check className="size-4" aria-hidden />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
