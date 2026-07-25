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

import React, { Component } from 'react';
import './_wickinput.scss';

import { Select } from '@/ui/select';
import { Tooltip } from '@/ui/tooltip';

import ColorPicker from 'Editor/Util/ColorPicker/ColorPicker';
import WickButton from './WickButton/WickButton';

import WickTextInput from './WickTextInput/WickTextInput';
import classNames from 'classnames';
/**
 * Creates an input to be used in the Wick Editor
 * prop {string} className The classname to apply to the input element
 *
 * prop {string} containerclassname The classname to apply to the container
 * element of the input.
 *
 * prop {string} tooltip The tooltip text to display on the container of the
 * element. No tooltip is shown if this is not provided.
 *
 * props {string} tooltipID A unique id which is required to properly display
 * the tooltip.
 *
 * prop {string} tooltipPlace 'top', 'bottom', 'left', 'right'. Defaults to 'bottom'.
 *
 * All remaining props will be applied directly to the input element.
 * @extends Component
 */
class WickInput extends Component {
  render() {
    if (!this.props.tooltip) return this.renderContent();

    /*
     * `tooltipID` is accepted and ignored — react-tooltip needed an id to pair a floating
     * <ReactTooltip> with its trigger, and Radix takes the trigger as a child instead. The
     * prop stays in the signature so the 17 call sites don't all have to change at once.
     *
     * The old code also suppressed tooltips entirely when the pointer cannot hover. Radix
     * opens on focus as well as hover and dismisses on Escape or on the next touch, so a
     * touch user gets the label on focus rather than never — which is what the old branch
     * cost them.
     */
    return (
      <Tooltip content={this.props.tooltip} side={this.props.tooltipPlace ?? 'bottom'}>
        <div className={classNames("wick-input-container", this.props.containerclassname)}>
          {this.renderContent()}
        </div>
      </Tooltip>
    );
  }

  renderContent = () => {
    if (this.props.type==="numeric") {
      return ( this.renderNumeric() );
    } else if (this.props.type==="text") {
      return ( this.renderText() );
    } else if (this.props.type === "slider") {
      return ( this.renderSlider() );
    } else if (this.props.type === "select") {
      return ( this.renderSelect() );
    } else if (this.props.type === "color") {
      return ( this.renderColor());
    } else if (this.props.type === "checkbox") {
      return ( this.renderCheckbox() );
    } else if (this.props.type === "radio") {
      return ( this.renderRadio() );
    } else if (this.props.type === "button") {
      return ( this.renderButton() );
    } else {
      return ( this.renderButton() ); // default to a button.
    }
  }

  renderNumeric = () => {
    let {min, max, ...rest} = this.props;

    let isValid = (input) => {

      let validNumber = !isNaN(input) && input !== ''; 

      if (typeof input === 'string') {
        validNumber = validNumber && !input.endsWith('.')
      }

      return validNumber;
    }

    // Used to clean up the number prior to display and updates.

    /**
     * Takes in a string and converts that string into a displayable value 
     * and converts that value to a number, with proper padding and styling. Value may not be valid,
     * in which case the same value will be returned.
     * @param {string} val - String to "Clean Up"
     * @returns {number | string}  Returns cleaned up number if valid string representation is passed in, string otherwise.
     */
    let cleanUp = (val) => {
      if (!isValid(val)) return val;

      val = parseFloat(val);
      // Constrain between min and max
      if (min) {
        val = Math.max(val, min);
      }

      if (max) {
        val = Math.min(val, max);
      }

      return Math.round(val * 1000) / 1000;
    }


    return <WickTextInput
    {...rest}
    className={classNames("wick-input", "numeric", {"read-only":this.props.readOnly}, this.props.className)}
    cleanUp={cleanUp}
    isValid={isValid}/>
  }

  renderText = () => {

    return <WickTextInput
         {...this.props}
         className={classNames("wick-input", {"read-only":this.props.readOnly}, this.props.className)}
         value={this.props.value ? this.props.value : ''}/>
  }

  renderSlider = () => {
    // Spit out the value of a text box back to the onChange function.
    let wrappedOnChange = (val) => {
      this.props.onChange(parseFloat(val.target.value));
    };
    return (
      <input
        {...this.props}
        className={classNames("wick-slider", this.props.className)}
        type='range'
        onChange={this.props.onChange ? wrappedOnChange : null}
        />
    );
  }

  renderColor = () => {
    let wrappedOnChange = (color) => {
      let newColor = color;

      // TODO: Check if we can just use HEX here.
      if (color.rgb) {
        let rgb = color.rgb;
        let str = "rgba(" + rgb.r + "," + rgb.g + "," + rgb.b + "," + rgb.a + ")";
        newColor = str;
      }

      this.props.updateLastColors && this.props.updateLastColors(newColor);
      this.props.onChange && this.props.onChange(newColor);
    };

    return (
      <ColorPicker
        className={classNames("wick-color-picker", this.props.className)}
        {...this.props}
        onChangeComplete={this.props.onChange ? wrappedOnChange : null}
        />
    );
  }

  renderSelect = () => {
    /*
     * `defaultValue` before, so the control was uncontrolled: it kept whatever the user
     * last picked even when the selection changed underneath it and the prop moved on.
     * `value` here makes it track the prop, which is what every call site already assumed.
     */
    return (
      <Select
        id={this.props.id}
        value={this.props.value}
        options={this.props.options}
        onChange={this.props.onChange}
        onOpenChange={this.props.onOpenChange}
        className={classNames("wick-input-select", this.props.className)}
      />
    );
  }

  renderCheckbox = () => {
    return (
      <div className="wick-checkbox-container">
        {this.props.label && 
          <label htmlFor={this.props.label} className="wick-checkbox-label">
            {this.props.label}
          </label>
        }
        <input 
          id={this.props.label}
          className="wick-checkbox"
          {...this.props} 
          type="checkbox" />
      </div>
    );
  }

  renderRadio = () => {
    if(!this.props.name) throw new Error("WickInput radio buttons require a name.");
    /*
     * Was reactstrap's <Input type="radio">, which is a plain <input> plus a Bootstrap
     * class. This was the only reactstrap use in the file, and dropping it here is most of
     * what lets the bootstrap CSS import go.
     */
    return (
      <input
        {...this.props}
        type="radio"
        className={classNames("wick-radio", this.props.className)}
      />
    );
  }

  renderButton = () => {
    return <WickButton {...this.props}>{this.props.children}</WickButton>
  }
}

export default WickInput
