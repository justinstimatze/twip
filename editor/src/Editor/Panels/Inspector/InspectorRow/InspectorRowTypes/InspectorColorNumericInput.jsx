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

import InspectorInput from 'Editor/Panels/Inspector/InspectorRow/InspectorInput/InspectorInput';

import { InspectorRow, InspectorLabel, InspectorField } from '../InspectorRow';


class InspectorColorNumericInput extends Component {
  render() {
    let idLabel1 = this.props.tooltip1.replace(/\s+/g, '-').toLowerCase();
    let idLabel2 = this.props.tooltip2.replace(/\s+/g, '-').toLowerCase();
    return(
      <InspectorRow>
      {/* Identifier1 */} 
      <InspectorLabel htmlFor={idLabel1 + "-input"}>
        {this.props.tooltip1}
      </InspectorLabel>

      {/* Input1 */}
      <InspectorField size="small">
        <InspectorInput 
          inputProps={{id: idLabel1 + "-input"}}
          input={
            {
              type: "color",
              color: this.props.val1,
              onChange: this.props.onChange1,
              id: this.props.id,
              stroke: !this.props.stroke ? false : this.props.stroke,
              placement: "left",
              colorPickerType: this.props.colorPickerType,
              changeColorPickerType:this.props.changeColorPickerType,
              updateLastColors:this.props.updateLastColors,
              lastColorsUsed:this.props.lastColorsUsed,
            }
          }
        />
      </InspectorField>

      {/* Identifier2 */}
      <InspectorLabel htmlFor={idLabel2+"-"+this.props.tooltip2 + "-input"}>
        {this.props.tooltip2}
      </InspectorLabel>

      {/* Input2 */}
      <InspectorField size="small">
        <InspectorInput 
          inputProps={{id: idLabel2+"-"+this.props.tooltip2 + "-input"}}
          input={
            {type: "numeric",
            value: this.props.val2,
            onChange: this.props.onChange2}
          } />
      </InspectorField>
    </InspectorRow>
    );
  }
}

export default InspectorColorNumericInput
