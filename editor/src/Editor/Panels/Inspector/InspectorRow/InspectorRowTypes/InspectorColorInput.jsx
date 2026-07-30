/*
 * A row that is only a colour.
 *
 * The set had a colour-plus-number row (fill and its opacity, stroke and its weight) and no
 * plain one, because until the Document tab every colour in the panel came with a companion
 * number. A stage colour does not: the SWF tag that carries it is three bytes of RGB, so
 * there is no alpha to offer and nothing to put in the second cell.
 */
import React, { Component } from 'react';

import InspectorInput from 'Editor/Panels/Inspector/InspectorRow/InspectorInput/InspectorInput';

import { InspectorRow, InspectorLabel, InspectorField } from '../InspectorRow';

class InspectorColorInput extends Component {
  render() {
    let idLabel = this.props.tooltip.replace(/\s+/g, '-').toLowerCase();
    return (
      <InspectorRow>
        <InspectorLabel htmlFor={idLabel + "-input"}>
          {this.props.tooltip}
        </InspectorLabel>

        <InspectorField>
          <InspectorInput
            inputProps={{id: idLabel + "-input"}}
            input={
              {
                type: "color",
                color: this.props.val,
                onChange: this.props.onChange,
                id: this.props.id,
                disableAlpha: true,
                placement: "left",
                colorPickerType: this.props.colorPickerType,
                changeColorPickerType: this.props.changeColorPickerType,
                updateLastColors: this.props.updateLastColors,
                lastColorsUsed: this.props.lastColorsUsed,
              }
            } />
        </InspectorField>
      </InspectorRow>
    );
  }
}

export default InspectorColorInput
