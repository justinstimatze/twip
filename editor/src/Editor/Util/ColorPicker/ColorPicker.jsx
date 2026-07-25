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

import React, { useState } from 'react';
import { Popover, PopoverTrigger, PopoverContent } from '@/ui/popover';
import WickColorPicker  from 'Editor/Util/ColorPicker/WickColorPicker';

import './_colorpicker.scss';

export default function ColorPicker (props) {
  const [open, setOpen] = useState(false);

  let color = props.color ? props.color : new window.Wick.Color("#FFFFFF")

  // Radix maps `placement` onto a side and an alignment; the old prop only ever carried
  // a bare side ("bottom", "left"), so anything with a dash is dropped rather than
  // silently positioning somewhere else.
  const side = typeof props.placement === 'string' ? props.placement.split('-')[0] : 'bottom';

  return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            className={"btn-color-picker"}
            aria-label="color picker button"
            id={props.id}
            style={props.stroke ? {borderColor: color} : {backgroundColor: color}}
          />
        </PopoverTrigger>
        {/* Portalled, so the picker is no longer a descendant of the button that opens
            it. Interactive content inside a <button> is invalid, and it is why the old
            version needed a 200ms setTimeout to move focus by hand. */}
        <PopoverContent side={side} className="color-picker-popover">
          <WickColorPicker
            toggle={() => setOpen(false)}
            colorPickerType={props.colorPickerType}
            changeColorPickerType={props.changeColorPickerType}
            disableAlpha={props.disableAlpha}
            color={color}
            onChangeComplete={props.onChangeComplete}
            lastColorsUsed={props.lastColorsUsed}
          />
        </PopoverContent>
      </Popover>
  )
}
