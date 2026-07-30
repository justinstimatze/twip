/*
 * Copyright 2020 WICKLETS LLC
 *
 * This file is part of Wick Editor.
 *
 * Wick Editor is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * Wick Editor is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with Wick Editor.  If not, see <https://www.gnu.org/licenses/>.
 */

/*
 * The active tool's options — docs/ui-research.md's "cryptic icon strip → a contextual
 * toolbar that reflows to the active tool, with labels".
 *
 * The reflow was already here and is not what dated it. What dated it was that the strip
 * said nothing: probing every tool in turn, the whole group held two glyphs and a bare
 * number field, `innerText` was the empty string, and not one control had an accessible
 * name. Picking the brush gave you 10 and 20 next to a circle and a squiggle.
 *
 * Two things changed. Each control now carries its word — for the numbers the word
 * REPLACED the icon rather than joining it, which costs nothing, since "Size" and a 24px
 * glyph are the same width and only one of them can be read. And the twelve
 * renderXSettings methods became one table, because what a tool offers is data: the old
 * shape hid that `text` and `eyedropper` render an empty div, and that renderFontSize,
 * renderFontFamily and renderDropperMode were written, never called, and could not have
 * worked — fontSize, fontFamily and pixelDropper are not settings the engine has.
 */
import React, { useState } from 'react';

import ToolIcon from 'Editor/Util/ToolIcon/ToolIcon';
import SettingsNumericSlider from './SettingsNumericSlider/SettingsNumericSlider';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover';
import { cn } from '@/lib/utils';

/* What each tool offers, in the order it is offered. A tool absent from here has no
 * options — text and eyedropper genuinely have none, and an empty group is the honest
 * rendering of that. */
const STROKE = { kind: 'number', setting: 'strokeWidth', label: 'Stroke' };

const TOOL_OPTIONS = {
  cursor: [{ kind: 'choice', setting: 'cursorTransformMode', label: 'Transform' }],
  brush: [
    { kind: 'number', setting: 'brushSize', label: 'Size' },
    { kind: 'number', setting: 'brushStabilizerWeight', label: 'Smooth' },
    { kind: 'toggle', setting: 'pressureEnabled', label: 'Pressure', icon: 'brushpressure' },
    { kind: 'toggle', setting: 'relativeBrushSize', label: 'Relative', icon: 'brushrelativesize' },
    { kind: 'choice', setting: 'brushMode', label: 'Mode' },
  ],
  pencil: [STROKE],
  eraser: [{ kind: 'number', setting: 'eraserSize', label: 'Size' }],
  rectangle: [STROKE, { kind: 'number', setting: 'cornerRadius', label: 'Corners' }],
  ellipse: [STROKE],
  line: [STROKE],
  fillbucket: [{ kind: 'number', setting: 'gapFillAmount', label: 'Gap fill' }],
  gradienttool: [{ kind: 'choice', setting: 'gradientToolMode', label: 'Transform' }],
};

/* The values a choice can take. The engine stores these as bare strings — 'skewscale',
 * 'none' — and the icon was the only thing that ever said what they meant. */
const CHOICES = {
  cursorTransformMode: [
    { value: 'freescale', label: 'Free scale', icon: 'cursortransformmodefreescale' },
    { value: 'uniform', label: 'Uniform', icon: 'cursortransformmodeuniform' },
    { value: 'skew', label: 'Skew', icon: 'cursortransformmodeskew' },
    { value: 'skewscale', label: 'Skew and scale', icon: 'cursortransformmodeskewscale' },
  ],
  brushMode: [
    { value: 'none', label: 'None', icon: 'brushmodenone' },
    { value: 'inside', label: 'Inside', icon: 'brushmodeinside' },
    { value: 'outside', label: 'Outside', icon: 'brushmodeoutside' },
    { value: 'merge', label: 'Merge', icon: 'brushmodemerge' },
  ],
  gradientToolMode: [
    { value: 'none', label: 'None', icon: 'gradienttoolmodenone' },
    { value: 'uniform', label: 'Uniform', icon: 'gradienttoolmodeuniform' },
  ],
};

/* Named so the group can say whose options these are. */
const TOOL_NAMES = {
  cursor: 'Cursor', brush: 'Brush', pencil: 'Pencil', eraser: 'Eraser',
  rectangle: 'Rectangle', ellipse: 'Ellipse', line: 'Line', pathcursor: 'Path cursor',
  text: 'Text', fillbucket: 'Fill bucket', eyedropper: 'Eyedropper',
  gradienttool: 'Gradient',
};

const CONTROL = 'flex h-[26px] items-center gap-1.5 rounded-sm px-1.5 text-micro '
  + 'transition-colors focus-visible:outline-2 focus-visible:outline-focus';

/** Whether a tool has anything to set. The toolbar asks so it can skip the rule that
 *  would otherwise hang off the colour swatches with nothing after it. */
export function hasToolOptions (tool) {
  return (TOOL_OPTIONS[tool] ?? []).length > 0;
}

/* On/off, with the word beside the mark. A switch rather than a checkbox: nothing here
 * is submitted, the setting takes effect the moment it flips. */
function Toggle ({ label, icon, value, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!!value}
      onClick={() => onChange(!value)}
      className={cn(
        CONTROL, 'whitespace-nowrap',
        value
          ? 'bg-accent text-accent-content'
          : 'bg-surface-raised text-content-muted hover:bg-surface-hover hover:text-content',
      )}
    >
      {icon && <ToolIcon name={icon} className="size-4" />}
      {label}
    </button>
  );
}

/* One of a handful of named modes. The trigger shows the mode you are in rather than a
 * glyph you have to already know, which is the whole complaint the item names. */
function Choice ({ label, options, value, onChange }) {
  const [open, setOpen] = useState(false);
  const current = options.find((option) => option.value === value) ?? options[0];

  /* A row of options is a row: left and right walk it, and the popover already handles
     Escape and returning focus to the trigger. */
  const onKeyDown = (event) => {
    const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    if (step === undefined) return;
    const buttons = Array.from(event.currentTarget.querySelectorAll('[role="menuitemradio"]'));
    const here = buttons.indexOf(document.activeElement);
    if (here === -1) return;
    event.preventDefault();
    event.stopPropagation();
    buttons[(here + step + buttons.length) % buttons.length].focus();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {/* No aria-label. "Mode: None" would be a nicer string to hear, and it would also
          replace the accessible name with one the visible text is not a substring of —
          WCAG's Label in Name, and the thing that breaks voice control. The two words are
          the name. */}
      <PopoverTrigger
        className={cn(CONTROL, 'whitespace-nowrap bg-surface-raised text-content-muted',
          'hover:bg-surface-hover hover:text-content')}
      >
        <ToolIcon name={current.icon} className="size-4" />
        <span className="text-content-subtle">{label}</span>
        <span>{current.label}</span>
      </PopoverTrigger>
      <PopoverContent className="border border-line bg-surface p-1">
        <div role="menu" aria-label={label} className="flex items-center gap-1" onKeyDown={onKeyDown}>
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={option.value === current.value}
              onClick={() => { onChange(option.value); setOpen(false); }}
              className={cn(
                CONTROL, 'whitespace-nowrap',
                option.value === current.value
                  ? 'bg-accent text-accent-content'
                  : 'text-content-muted hover:bg-surface-hover hover:text-content',
              )}
            >
              <ToolIcon name={option.icon} className="size-4" />
              {option.label}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default function ToolSettings ({ activeTool, getToolSetting, setToolSetting, getToolSettingRestrictions }) {
  const options = TOOL_OPTIONS[activeTool] ?? [];
  if (options.length === 0) return null;

  return (
    /* settings-panel-container carries no style; the dev checks find the group by it. */
    <div
      id="settings-panel-container"
      role="group"
      aria-label={`${TOOL_NAMES[activeTool] ?? activeTool} options`}
      className="flex shrink-0 items-center gap-1.5"
    >
      {options.map((option) => {
        if (option.kind === 'number') {
          return (
            <SettingsNumericSlider
              key={option.setting}
              id={`tool-setting-${option.setting}`}
              label={option.label}
              value={getToolSetting(option.setting)}
              onChange={(value) => setToolSetting(option.setting, value)}
              inputRestrictions={getToolSettingRestrictions(option.setting)} />
          );
        }
        if (option.kind === 'toggle') {
          return (
            <Toggle
              key={option.setting}
              label={option.label}
              icon={option.icon}
              value={getToolSetting(option.setting)}
              onChange={(value) => setToolSetting(option.setting, value)} />
          );
        }
        return (
          <Choice
            key={option.setting}
            label={option.label}
            options={CHOICES[option.setting]}
            value={getToolSetting(option.setting)}
            onChange={(value) => setToolSetting(option.setting, value)} />
        );
      })}
    </div>
  );
}
