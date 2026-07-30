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
 * The toolbar: tools, colours, the active tool's options, and the actions on the selection.
 *
 * It used to be two hand-written layouts — one row above 1024px, two rows below — and both
 * of them lied about fitting. Measured at a 1024px window the row had 774px and its contents
 * wanted 1058, and the 284px that did not fit were simply painted off the right edge by
 * `overflow: hidden`: delete, copy, paste, undo and redo were not cryptic there, they were
 * absent, along with the last two brush settings. The two-row layout at 768px clipped its
 * second row the same way.
 *
 * So the reflow is the browser's now. One flex-wrap row, every group unshrinkable, no fixed
 * height — the toolbar takes the rows it needs and the panel below it takes the rest. At a
 * laptop width that is still one row and looks like it always did; at 1024 the actions drop
 * to a second row instead of off the edge; picking the brush at a middling width may cost a
 * row, which is what a toolbar that reflows to the active tool does.
 *
 * The one thing to preserve when editing this: nothing may be given a fixed height or
 * `overflow: hidden` again. dev/toolbar-check.mjs measures every control against the
 * toolbar's own box at four widths, for every tool, and that is the check that would have
 * caught the original.
 */
import React, { Component } from 'react';

import WickInput from 'Editor/Util/WickInput/WickInput';
import ToolboxBreak from './ToolboxBreak/ToolboxBreak';
import ToolButton, { TOOL_BUTTON_SIZE } from './ToolButton/ToolButton';
import ToolSettings, { hasToolOptions } from './ToolSettings/ToolSettings';
import CanvasActions from './CanvasActions/CanvasActions';
import { cn } from '@/lib/utils';

/* One square, one gutter — every direct child of a tool row is this size. */
const TOOLBOX_ITEM = `mx-[2px] max-w-[30px] ${TOOL_BUTTON_SIZE}`;

/* Groups sit on a line and never shrink; the line wraps instead. */
const GROUP = 'flex shrink-0 flex-row items-center';

/* .85 of a tool square, so a colour well reads as a swatch rather than a button. */
const COLOR_WELL = 'flex size-[25.5px] min-w-[25.5px] cursor-pointer items-center overflow-hidden';

/*
 * The outline is on the bottom and left only: the toolbox meets the menu bar above it and
 * the window edge on the right, and a border on either would double up.
 */
const TOOL_BOX = 'flex w-full flex-wrap items-center gap-y-1 border-b border-l border-line '
  + 'bg-surface-sunken py-[5px] pr-1 pl-[2px]';

const TOOLS = [
  ['cursor', 'Cursor'],
  ['brush', 'Brush'],
  ['pencil', 'Pencil'],
  ['eraser', 'Eraser'],
  ['rectangle', 'Rectangle'],
  ['ellipse', 'Ellipse'],
  ['line', 'Line'],
  ['pathcursor', 'Path Cursor'],
  ['text', 'Text'],
  ['fillbucket', 'Fill Bucket'],
  ['eyedropper', 'Eyedropper'],
  ['gradienttool', 'Gradient Tool'],
];

class Toolbox extends Component {
  constructor(props) {
    super(props);

    this.toolButtonProps = {
      setActiveTool: this.props.setActiveTool,
      className: TOOLBOX_ITEM,
      getActiveToolName: this.props.getActiveToolName,
    }
  }

  renderToolButtonFromAction = (action) => {
    return (
      <ToolButton
      {...this.toolButtonProps}
      keyMap={this.props.keyMap}
      action={action.action}
      name={action.icon}
      tooltip={action.tooltip} />
    );
  }

  renderToolButtons = () => {
    return (
      <div className={GROUP} role="group" aria-label="Tools">
        {TOOLS.map(([name, tooltip]) => (
          <ToolButton
            {...this.toolButtonProps}
            key={name}
            keyMap={this.props.keyMap}
            name={name}
            tooltip={tooltip} />
        ))}
      </div>
    )
  }

  renderColorPickers = () => {
    return (
      <div className={GROUP} role="group" aria-label="Colors">
        <div className={cn(TOOLBOX_ITEM, COLOR_WELL)} id="fill-color-picker-container">
          <WickInput
            type="color"
            color={this.props.getToolSetting('fillColor').rgba}
            onChange={(color) => {this.props.setToolSetting('fillColor', new window.Wick.Color(color));}}
            id="tool-box-fill-color"
            tooltipID="tool-box-fill-color"
            tooltip="Fill Color"
            placement="bottom"
            colorPickerType={this.props.colorPickerType}
            changeColorPickerType={this.props.changeColorPickerType}
            updateLastColors={this.props.updateLastColors}
            lastColorsUsed={this.props.lastColorsUsed}
            />
        </div>
        <div className={cn(TOOLBOX_ITEM, COLOR_WELL)} id="stroke-color-picker-container">
          <WickInput
            type="color"
            color= {this.props.getToolSetting('strokeColor').rgba}
            onChange={(color) => {this.props.setToolSetting('strokeColor', new window.Wick.Color(color));}}
            id="tool-box-stroke-color"
            tooltipID="tool-box-stroke-color"
            tooltip="Stroke Color"
            placement="bottom"
            stroke={true}
            colorPickerType={this.props.colorPickerType}
            changeColorPickerType={this.props.changeColorPickerType}
            lastColorsUsed={this.props.lastColorsUsed}
            />
        </div>
      </div>
    )
  }

  renderCanvasActions = () => {
    return (
      /* ml-auto right-anchors this group on whatever line it lands on, which is the line
         it should be at the end of whether or not the toolbar wrapped. */
      <div className={cn(GROUP, 'ml-auto')} role="group" aria-label="Selection actions">
        {/* The document actions are a different kind of thing from the tools to their left —
            they act on the selection rather than choosing a mode — so they get the same rule
            that separates every other group in this row. */}
        <ToolboxBreak/>

        <div id="more-canvas-actions-popover-button">
          {this.renderToolButtonFromAction(this.props.editorActions.showMoreCanvasActions)}
          <CanvasActions {...this.props} />
        </div>

        {this.renderToolButtonFromAction(this.props.editorActions.delete)}
        {this.renderToolButtonFromAction(this.props.editorActions.copy)}
        {this.renderToolButtonFromAction(this.props.editorActions.paste)}
        {this.renderToolButtonFromAction(this.props.editorActions.undo)}
        {this.renderToolButtonFromAction(this.props.editorActions.redo)}
      </div>
    )
  }

  render() {
    return (
      /* tool-box-container carries no style; dev/interact.mjs checks for the toolbox by it. */
      <div className="tool-box-container w-full" aria-label="Toolbox">
        <div className={TOOL_BOX}>
          {this.renderToolButtons()}

          <ToolboxBreak/>

          {this.renderColorPickers()}

          {hasToolOptions(this.props.activeToolName) && <ToolboxBreak/>}

          <ToolSettings
            activeTool={this.props.activeToolName}
            getToolSetting={this.props.getToolSetting}
            setToolSetting={this.props.setToolSetting}
            getToolSettingRestrictions={this.props.getToolSettingRestrictions}
          />

          {this.renderCanvasActions()}
        </div>
      </div>
    )
  }
}

export default Toolbox
