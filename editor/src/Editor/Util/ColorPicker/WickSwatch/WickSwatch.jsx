import React from 'react'
import tinycolor from 'tinycolor2';
import { toRgbaString } from 'Editor/Util/ColorPicker/WickColorPicker';

/*
 * One swatch in the swatchbook.
 *
 * Was react-color's <Swatch> inside a div that tracked hover and focus in state purely to
 * draw a border. A button draws its own :hover and :focus-visible in CSS, so the state,
 * the two handlers and the inline style object all go.
 *
 * The old version also had no accessible name — a screen reader heard eighty-odd
 * unlabelled clickables. It has the colour now.
 */
function WickSwatch ({ color, selectedColor, onChangeComplete }) {
  // Normalised first: selectedColor arrives as an rgba string from the Toolbox but as a
  // Wick.Color object when a caller passes no colour at all, and tinycolor reads an
  // unrecognised object as opaque black — which would mark the black swatch selected
  // everywhere it happened.
  const selected = tinycolor.equals(color, toRgbaString(selectedColor));
  // A light swatch needs a dark ring and vice versa, or the selection marker vanishes
  // into its own colour.
  const contrast = tinycolor(color).isLight() ? '#333333' : '#CCCCCC';

  return (
    <button
      type="button"
      className="column-swatch"
      aria-label={color}
      aria-pressed={selected}
      style={{ backgroundColor: color, '--swatch-contrast': contrast }}
      onClick={() => onChangeComplete && onChangeComplete(color)}
    />
  );
}

export default WickSwatch
