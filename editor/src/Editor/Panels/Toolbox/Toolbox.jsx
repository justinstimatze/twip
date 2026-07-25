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
import './_toolbox.scss';

import WickInput from 'Editor/Util/WickInput/WickInput';
import ToolboxBreak from './ToolboxBreak/ToolboxBreak';
import ToolButton from './ToolButton/ToolButton';
import ToolSettings from './ToolSettings/ToolSettings';
import CanvasActions from './CanvasActions/CanvasActions';
import classNames from 'classnames';
class Toolbox extends Component {
  constructor(props) {
    super(props);

    this.state = {
      openSettings: null,
      moreCanvasActionsPopoverOpen: false,
    }

    this.toolButtonProps = {
      setActiveTool: this.props.setActiveTool,
      className: "toolbox-item",
      getActiveToolName: this.props.getActiveToolName,
    }

    // List of callbacks to call on Scroll.
    this.scrollFns = [];
  }

  renderAction = (action, i) => {
    if (action === 'break') {
      return (
        <ToolboxBreak/>
      );
    }
    return(
      <ToolButton
        {...this.toolButtonProps}
        activeTool={this.props.activeToolName}
        action={action.action}
        className='toolbox-item'
        name={action.icon}
        key={i}
        tooltip={action.tooltip} />
    );
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
      <div className="tool-collection-container">
        <ToolButton {...this.toolButtonProps} keyMap={this.props.keyMap} name='cursor' tooltip="Cursor" />
        <ToolButton {...this.toolButtonProps} keyMap={this.props.keyMap} name='brush' tooltip="Brush" />
        <ToolButton {...this.toolButtonProps} keyMap={this.props.keyMap} name='pencil' tooltip="Pencil" />
        <ToolButton {...this.toolButtonProps} keyMap={this.props.keyMap} name='eraser' tooltip="Eraser" />
        <ToolButton {...this.toolButtonProps} keyMap={this.props.keyMap} name='rectangle' tooltip="Rectangle" />
        <ToolButton {...this.toolButtonProps} keyMap={this.props.keyMap} name='ellipse' tooltip="Ellipse" />
        <ToolButton {...this.toolButtonProps} keyMap={this.props.keyMap} name='line' tooltip="Line" />
        <ToolButton {...this.toolButtonProps} keyMap={this.props.keyMap} name='pathcursor' tooltip="Path Cursor" />
        <ToolButton {...this.toolButtonProps} keyMap={this.props.keyMap} name='text' tooltip="Text" />
        <ToolButton {...this.toolButtonProps} keyMap={this.props.keyMap} name='fillbucket' tooltip="Fill Bucket" />
        <ToolButton {...this.toolButtonProps} keyMap={this.props.keyMap} name='eyedropper' tooltip="Eyedropper" />
        <ToolButton {...this.toolButtonProps} keyMap={this.props.keyMap} name='gradienttool' tooltip="Gradient Tool" />
      </div>
    )
  }

  renderColorPickers = () => {
    return (
      <div className="tool-collection-container">
        <div className="color-container toolbox-item" id="fill-color-picker-container">
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
        <div className="color-container toolbox-item" id="stroke-color-picker-container">
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
      <div className="toolbox-actions-right-container">
        <div className="toolbox-actions-right">

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
    </div>
    )
  }

  renderLargeToolbox = () => {
    return (
      <div className={classNames("tool-box", "tool-box-large")}>
        {this.renderToolButtons()}

        <ToolboxBreak/>

        {this.renderColorPickers()}

        <ToolboxBreak/>

        <ToolSettings
          activeTool={this.props.activeToolName}
          getToolSetting={this.props.getToolSetting}
          setToolSetting={this.props.setToolSetting}
          getToolSettingRestrictions={this.props.getToolSettingRestrictions}
          toggleBrushModes={this.props.toggleBrushModes}
          toggleCursorTransformModes={this.props.toggleCursorTransformModes}
          toggleGradientToolModes={this.props.toggleGradientToolModes}
          showCanvasActions={this.props.showCanvasActions}
          showBrushModes={this.props.showBrushModes}
          showCursorTransformModes={this.props.showCursorTransformModes}
          showGradientToolModes={this.props.showGradientToolModes}
        />

        {this.renderCanvasActions()}
      </div>
    )

  }

  renderMediumToolbox = () => {
    return (
      <div className={classNames("tool-box", "tool-box-medium")}>
        <div className="medium-toolbox-row">
          {this.renderToolButtons()}
          <ToolboxBreak/>
          {this.renderColorPickers()}
          <ToolboxBreak/>
        </div>
        <div className="medium-toolbox-row">
          <ToolSettings
            activeTool={this.props.activeToolName}
            getToolSetting={this.props.getToolSetting}
            setToolSetting={this.props.setToolSetting}
            getToolSettingRestrictions={this.props.getToolSettingRestrictions}
            toggleBrushModes={this.props.toggleBrushModes}
            toggleCursorTransformModes={this.props.toggleCursorTransformModes}
            toggleGradientToolModes={this.props.toggleGradientToolModes}
            showCanvasActions={this.props.showCanvasActions}
            showBrushModes={this.props.showBrushModes}
            showCursorTransformModes={this.props.showCursorTransformModes}
            showGradientToolModes={this.props.showGradientToolModes}/>
            {this.renderCanvasActions()}
        </div>

      </div>
    )
  }

  render() {
    return (
      <div className="tool-box-container" aria-label="Toolbox">
        {this.props.renderSize === 'large' ? this.renderLargeToolbox() : this.renderMediumToolbox()}
      </div>
    )
  }
}

export default Toolbox
