import React, { Component } from 'react';

import ActionButton from 'Editor/Util/ActionButton/ActionButton';
import PlayButton from 'Editor/Util/PlayButton/PlayButton';
import { Tooltip } from '@/ui/tooltip';
import HotKeyInterface from 'Editor/hotKeyMap';
import './_canvastransforms.scss';
import classNames from 'classnames';
class CanvasTransforms extends Component {
  getHotkey (action) {
    return HotKeyInterface.getHotKey(this.props.keyMap, action);
  }

  renderTransformButton(options) {
    const isActive = options.isActive ? options.isActive : () => this.props.activeToolName === options.name;
    return (
      <ActionButton
        color="tool"
        isActive={isActive}
        id={"canvas-transform-button-" + options.name}
        tooltip={options.tooltip}
        tooltipPlace={"top"}
        tooltipHotkey={this.getHotkey(options.tooltipHotkey)}
        /*
         * These six are icon-only buttons, so without this they reach a screen reader as
         * "button" and nothing else — the tooltip is a hover affordance and never becomes an
         * accessible name. The label was always sitting right there in `tooltip`. Two of them
         * are switches rather than actions, and aria-pressed is what carries the on/off that
         * `active-button` only says in colour.
         */
        buttonProps={{
          'aria-label': options.tooltip,
          'aria-pressed': options.isActive ? isActive() : undefined,
        }}
        action={options.action}
        icon={options.name}
        className={classNames("canvas-transform-button", options.className)}
        buttonClassName={"canvas-transform-wick-button"}
        iconClassName="canvas-transform-icon"
        />
    );
  }

  renderTransformations = () => {
    return (
      <div className='transforms-container'>
        {/* Beside onion skinning because they are the same kind of switch: neither draws
            anything, both change what the timeline means while you work. */}
        {this.renderTransformButton({
          action: this.props.toggleAutoKey,
          name: 'autokey',
          tooltip: 'Auto-Key',
          className: 'canvas-transform-item',
          isActive: (() => this.props.autoKeyEnabled),
          tooltipHotkey: 'toggle-auto-key'
        })}
        {this.renderTransformButton({
          action:this.props.toggleOnionSkin,
          name:'onionskinning',
          tooltip:'Onion Skinning',
          className:'canvas-transform-item onion-skin-button',
          isActive:(() => {return this.props.onionSkinEnabled}),
          tooltipHotkey: 'toggle-onion-skinning'
        })}
        {this.renderTransformButton({
          action: (() => this.props.setActiveTool('pan')),
          name: 'pan',
          tooltip: 'Pan',
          className:'canvas-transform-item',
          tooltipHotkey: 'activate-pan'
        })}
        {this.renderZoomIn()}
        {this.renderZoomTool()}
        {this.renderZoomOut()}
        {this.renderTransformButton({
          action: (this.props.recenterCanvas),
          name: 'recenter',
          tooltip: 'Recenter',
          className:'canvas-transform-item'
        })}
      </div>
    );
  }

  renderZoomTool = () => {
    return (
      <div id='zoom-tool-container'>
        {/* Zoom Tool / NumericInput*/}
        {this.renderTransformButton({
          action: (() => this.props.setActiveTool('zoom')),
          name: 'zoom',
          tooltip: 'Zoom',
          className: 'zoom-tool',
          tooltipHotkey: 'activate-zoom'
        })}
      </div>
    )
  }

  renderZoomIn = () => {
    return this.renderTransformButton({
          action: () => this.props.zoomIn(),
          name: 'zoomin',
          tooltip: 'Zoom In',
          className: 'thin-transform-button zoom-in-button'});
  }

  renderZoomOut = () => {
    return this.renderTransformButton({
        action: () => this.props.zoomOut(),
        name: 'zoomout',
        tooltip: 'Zoom Out',
        className: 'thin-transform-button zoom-out-button',
      });
  }

  render () {
    return (
      <div className="canvas-transforms-widget">
        {!this.props.previewPlaying && this.renderTransformations()}
        <div className="play-button-container">
          {/* Was a sibling <ReactTooltip id="play-button-object"> paired to the button by
              a matching id string. Radix wraps the trigger, so the pairing cannot drift. */}
          <Tooltip
            side="top"
            content={`Preview Play (${this.getHotkey('preview-play-toggle').toUpperCase()})`}>
            <PlayButton
              id="play-button-object"
              className="play-button canvas-transform-button"
              playing={this.props.previewPlaying}
              action={this.props.togglePreviewPlaying}/>
          </Tooltip>
        </div>
      </div>
    );
  }
}

export default CanvasTransforms
