import React, { useState } from 'react';
import { Popover, PopoverAnchor, PopoverContent } from '@/ui/popover';

import WickInput from 'Editor/Util/WickInput/WickInput';
import ToolIcon from 'Editor/Util/ToolIcon/ToolIcon';

import 'Editor/styles/Panels/Toolbox/settingsnumericslider.css';
import classNames from 'classnames';
export default function SettingsNumericSlider (props) {

  const [sliderOn, setSliderOn] = useState(false);

  return (
    <div className="settings-numeric-slider">
      <ToolIcon
        name={props.icon}
        className={classNames("settings-numeric-slider-icon", {mobile: props.isMobile})}/>

      <Popover open={sliderOn} onOpenChange={setSliderOn}>
        <PopoverAnchor>
          <WickInput
            type="numeric"
            className={classNames("settings-numeric-input", {"mobile": props.isMobile})}
            onChange={props.onChange}
            onFocus={() => {setSliderOn(true)}}
            onClick={() => {setSliderOn(true)}}
            value={props.value}
            {...props.inputRestrictions}
          />
        </PopoverAnchor>
        {/* The slider is the only thing in here, so opening must not steal focus from the
            number field — you type a value, the slider appears, and you keep typing.
            The old version's onBlur close did this by accident and also closed the popover
            the moment you grabbed the slider thumb. */}
        <PopoverContent
          className="settings-numeric-slider-container"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <WickInput
            type="slider"
            containerclassname="settings-slider-wick-input-container"
            className="settings-numeric-slider"
            onChange={props.onChange}
            value={props.value}
            {...props.inputRestrictions} />
        </PopoverContent>
      </Popover>
    </div>
  )
}
