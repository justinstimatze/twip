import React, { useState } from 'react';
import { Popover, PopoverAnchor, PopoverContent } from '@/ui/popover';

import WickInput from 'Editor/Util/WickInput/WickInput';

/*
 * A number a tool is set by: brush size, stroke width, gap fill.
 *
 * The icon that used to sit where the word is now was doing no work. `brushsize` and
 * `eraser` are both a circle, `brushsmoothness` is a squiggle, and `gapfillamount` is a
 * shape nobody has ever guessed — and the icon cost the same 24px the word costs, so the
 * strip was never denser for it, only quieter. The label is a real <label>, so it also
 * gives the field an accessible name; before this the input announced itself as "edit
 * text, blank" and nothing anywhere on the page said what it set.
 */
export default function SettingsNumericSlider ({ id, label, value, onChange, inputRestrictions }) {
  const [sliderOn, setSliderOn] = useState(false);

  return (
    <div className="flex items-center gap-1.5">
      <label htmlFor={id} className="text-micro whitespace-nowrap text-content-muted">
        {label}
      </label>

      <Popover open={sliderOn} onOpenChange={setSliderOn}>
        <PopoverAnchor>
          {/* settings-numeric-input and settings-numeric-slider-container carry no style;
              dev/interact.mjs drives the slider through both. */}
          <WickInput
            type="numeric"
            id={id}
            className="settings-numeric-input w-11 text-center"
            onChange={onChange}
            onFocus={() => {setSliderOn(true)}}
            onClick={() => {setSliderOn(true)}}
            value={value}
            {...inputRestrictions}
          />
        </PopoverAnchor>
        {/* The slider is the only thing in here, so opening must not steal focus from the
            number field — you type a value, the slider appears, and you keep typing.
            The old version's onBlur close did this by accident and also closed the popover
            the moment you grabbed the slider thumb. */}
        <PopoverContent
          className="settings-numeric-slider-container rounded-sm bg-surface p-1"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <WickInput
            type="slider"
            aria-label={label}
            className="flex h-4"
            onChange={onChange}
            value={value}
            {...inputRestrictions} />
        </PopoverContent>
      </Popover>
    </div>
  )
}
