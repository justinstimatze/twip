import React, { useState } from 'react';
import { Popover, PopoverAnchor, PopoverContent } from '@/ui/popover';

import WickInput from 'Editor/Util/WickInput/WickInput';
import ToolIcon from 'Editor/Util/ToolIcon/ToolIcon';

/*
 * The slider inside the popover has always carried the same class as the row that holds
 * the icon and the number field, so it inherits the row's height and right margin. Kept
 * as-is rather than quietly changing what the popover looks like.
 */
const SLIDER_ROW = 'mr-2 flex h-4/5';

export default function SettingsNumericSlider (props) {

  const [sliderOn, setSliderOn] = useState(false);

  return (
    <div className={SLIDER_ROW}>
      {/* Same reason as the field below: `.img-tool-icon` sets `height: 100%` unlayered,
          so the 24px square has to be the box the icon fills. */}
      <div className="my-auto mr-2 size-6 p-0.5">
        <ToolIcon name={props.icon} className="w-full"/>
      </div>

      <Popover open={sliderOn} onOpenChange={setSliderOn}>
        <PopoverAnchor>
          {/* The width is on this wrapper rather than on the field: `.wick-input` sets
              `width: 100%` from un-migrated SCSS, which is unlayered and so outranks any
              Tailwind utility no matter how specific. Sizing the box the input fills is
              the version that survives until _wickinput.scss goes.
              settings-numeric-input and settings-numeric-slider-container carry no style;
              dev/interact.mjs drives the slider through both. */}
          <div className="h-full w-10">
            <WickInput
              type="numeric"
              className="settings-numeric-input text-center"
              onChange={props.onChange}
              onFocus={() => {setSliderOn(true)}}
              onClick={() => {setSliderOn(true)}}
              value={props.value}
              {...props.inputRestrictions}
            />
          </div>
        </PopoverAnchor>
        {/* The slider is the only thing in here, so opening must not steal focus from the
            number field — you type a value, the slider appears, and you keep typing.
            The old version's onBlur close did this by accident and also closed the popover
            the moment you grabbed the slider thumb. */}
        <PopoverContent
          className="settings-numeric-slider-container rounded-sm bg-surface"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <WickInput
            type="slider"
            className={SLIDER_ROW}
            onChange={props.onChange}
            value={props.value}
            {...props.inputRestrictions} />
        </PopoverContent>
      </Popover>
    </div>
  )
}
