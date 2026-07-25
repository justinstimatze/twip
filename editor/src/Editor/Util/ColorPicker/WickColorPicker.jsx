import React, { Component } from 'react'
import tinycolor from 'tinycolor2';
import { RgbaStringColorPicker, HexColorInput } from 'react-colorful';

import  ActionButton  from 'Editor/Util/ActionButton/ActionButton';
import WickInput from 'Editor/Util/WickInput/WickInput';
import WickSwatch from 'Editor/Util/ColorPicker/WickSwatch/WickSwatch'

import './_wickcolorpicker.scss';

/**
 * The editor passes colours around as `rgba(r, g, b, a)` strings — that is what
 * Wick.Color.rgba produces and what every onChange here is expected to hand back — so the
 * picker speaks that format end to end and never converts.
 */
export function toRgbaString (value, fallback = 'rgba(255, 255, 255, 1)') {
  if (value === null || value === undefined) return fallback;
  const parsed = tinycolor(typeof value === 'string' ? value : (value.rgba ?? String(value)));
  return parsed.isValid() ? parsed.toRgbString() : fallback;
}

/*
 * Replaces react-color 2 (2018), which supplied this file with a CustomPicker HOC and
 * five internals imported from react-color/lib/components/common — Saturation, Hue, Alpha,
 * Checkboard, Swatch — plus SketchFields out of the sketch picker. Reaching into a
 * package's lib/ for unexported internals is what made the dependency unupgradable.
 *
 * react-colorful ships one component covering saturation, hue and alpha. What comes with
 * it is keyboard control: each of the three areas is role="slider", tabbable, and moves on
 * the arrow keys, with aria-valuenow on hue and alpha and aria-valuetext on the saturation
 * square. react-color's versions were mouse-only, so the picker simply could not be
 * operated without a pointer.
 *
 * The RGB spinners from SketchFields are gone. The hex field takes the same values in
 * fewer inputs, and five text boxes never fit 200px anyway — alpha stays as its own field
 * because entering it as the last two digits of an eight-digit hex is not a thing anyone
 * would guess.
 */
class WickColorPicker extends Component {
    get rgba () {
        return toRgbaString(this.props.color);
    }

    /** @param {string} next an `rgba(...)` string */
    emit = (next) => {
        this.props.onChangeComplete && this.props.onChangeComplete(next);
    }

    setHex = (hex) => {
        const alpha = tinycolor(this.rgba).getAlpha();
        this.emit(tinycolor(hex).setAlpha(alpha).toRgbString());
    }

    setAlphaPercent = (percent) => {
        const clamped = Math.max(0, Math.min(100, Number(percent) || 0));
        this.emit(tinycolor(this.rgba).setAlpha(clamped / 100).toRgbString());
    }

    renderSwatchColumn = (colorList, i) => {
        return (
            <div key={"swatch-color-column-" + i} className="wick-swatch-picker-column">
                {colorList.map((color,i) => {
                    return (
                        <WickSwatch
                            color={color}
                            onChangeComplete={this.props.onChangeComplete}
                            selectedColor={this.props.color}
                            key={"swatch-color-"+color+"-"+i} />
                    );
                })}
            </div>
        );
    }

    renderSwatchbook = (colors) => {
        return (
            <div className="wick-swatch-picker-book">
                {colors.map((colorList, i) => {
                    return (this.renderSwatchColumn(colorList, i));
                })}
            </div>
        );
    }

    renderSwatches = () => {
        let colors = [
            ["#ff0000","#ffcccc","#ff9999","#ff4d4d","#cc0000","#800000"],
            ["#ff8000","#ffe6cc","#ffcc99","#ffa64d","#cc6600","#804000"],
            ["#ffff00","#ffffcc","#ffff99","#ffff4d","#cccc00","#808000"],
            ["#00ff00","#ccffcc","#99ff99","#4dff4d","#00cc00","#008000"],
            ["#00ff80","#ccffe6","#99ffcc","#4dffa6","#00cc66","#008040"],
            ["#00ffff","#ccffff","#99ffff","#4dffff","#00cccc","#008080"],
            ["#0080ff","#cce6ff","#99ccff","#4da6ff","#0066cc","#004080"],
            ["#0000ff","#ccccff","#9999ff","#4d4dff","#0000cc","#000080"],
            ["#8000ff","#e6ccff","#cc99ff","#a64dff","#6600cc","#400080"],
            ["#ff00ff","#ffccff","#ff99ff","#ff4dff","#cc00cc","#800080"],
            ["#ff0080","#ffcce6","#ff99cc","#ff4da6","#cc0066","#800040"],
            ["#000000","#ffffff","#cccccc","#999999","#666666","#333333"]
        ]

        return (
            <div className="wick-color-picker">
                {this.renderHeader()}
                <div className="wick-swatch-color-picker-body">
                    {this.renderSwatchbook(colors)}
                </div>
            </div>
        );
    }



    renderHeader () {
        return (
            <div className="wick-color-picker-header">
                <div className="wick-color-picker-action-button">
                    <ActionButton
                        color="tool"
                        id="color-picker-swatches-button"
                        tooltip="Swatches"
                        action={() => {this.props.changeColorPickerType("swatches")}}
                        isActive={ () => this.props.colorPickerType === "swatches" }
                        icon="swatches" />
                </div>
                <div className="wick-color-picker-action-button spacer">
                    <ActionButton
                        color="tool"
                        id="color-picker-spectrum-button"
                        tooltip="Spectrum"
                        action={() => {this.props.changeColorPickerType("spectrum")}}
                        isActive={ () => this.props.colorPickerType === "spectrum" }
                        icon="spectrum" />
                </div>
                <div className="color-picker-control-div">
                    <div id="btn-color-picker-close">
                        <ActionButton color="tool" icon="closemodal" action={this.props.toggle}/>
                    </div>
                </div>
            </div>
        );
    }


    renderSwatchContainer = (colors) => {
        return (
            <div className="wick-color-picker-swatches-container">
                {colors.map((color, i) => {
                    return (
                        <button
                            key={"color-swatch-" + color + "-" + i}
                            type="button"
                            className="wick-color-picker-small-swatch"
                            aria-label={color}
                            onClick={() => this.emit(toRgbaString(color))}>
                            <span style={{ backgroundColor: color }} />
                        </button>
                    );
                })}
            </div>
        );
    }

    renderSpectrum = () => {
        const rgba = this.rgba;
        const color = tinycolor(rgba);
        const hex = color.toHexString();
        const alphaPercent = Math.round(color.getAlpha() * 100);

        let colors = ['#D0021B', '#F8E71C', '#7ED321', '#4A90E2', '#000000', '#4A4A4A', '#FFFFFF', '#FFFFFF00']
        let lastUsedColorsDefaults = ["#000000","#000000","#000000","#000000","#000000","#000000","#000000","#000000"]
        let lastColors = this.props.lastColorsUsed || lastUsedColorsDefaults;

        return (
            <div className="wick-color-picker">
                {this.renderHeader()}
                <RgbaStringColorPicker
                    className="wick-color-picker-spectrum"
                    color={rgba}
                    onChange={this.emit} />
                <div className="wick-color-picker-control-body">
                    <div id="btn-color-picker-dropper">
                        <ActionButton
                            icon="eyedropper"
                            id="color-picker-eyedropper"
                            tooltip="Eyedropper"
                            color="tool"
                            action={this.openEyedropper}/>
                    </div>
                    <div className="wick-color-picker-fields">
                        <HexColorInput
                            className="wick-color-picker-hex"
                            aria-label="Hex colour"
                            color={hex}
                            onChange={this.setHex} />
                        <WickInput
                            type="numeric"
                            className="wick-color-picker-alpha"
                            aria-label="Alpha percent"
                            min={0}
                            max={100}
                            value={alphaPercent}
                            onChange={this.setAlphaPercent} />
                    </div>
                    {/* The checkerboard is a CSS gradient rather than react-color's
                        <Checkboard>, which rendered a base64 PNG. */}
                    <div className="wick-color-picker-color-block-container">
                        <div className="wick-color-picker-color-block" style={{ backgroundColor: rgba }} />
                    </div>
                </div>
                {this.renderSwatchContainer(colors)}
                {this.renderSwatchContainer(lastColors)}
            </div>
        );
    }

    render () {
        if (this.props.colorPickerType === "swatches" || !this.props.colorPickerType) {
            return this.renderSwatches();
        } else if (this.props.colorPickerType === "spectrum") {
            return this.renderSpectrum();
        };
    }

    openEyedropper = () => {
        window.editor.setActiveTool('eyedropper');
        // The picked colour arrives as a string, which is what emit() already takes. It
        // used to be handed react-color's injected onChange, which expected the HOC's
        // colour-object shape.
        window.editor._onEyedropperPickedColor = (color) => this.emit(toRgbaString(color));
    }
}

export default WickColorPicker;
