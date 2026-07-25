import React, { Component } from 'react';

import ActionButton from 'Editor/Util/ActionButton/ActionButton';
import ToolboxBreak from '../ToolboxBreak/ToolboxBreak';
import PopupMenu from 'Editor/Util/PopupMenu/PopupMenu';

/* Shared with the three mode widgets in ToolSettings, which lay out the same way. */
export const ACTIONS_ROW = 'flex h-full flex-row items-center';

class CanvasActions extends Component {
  renderActionButton(action) {
    return (
      /* The square is on the wrapper, not on the button: `.action-button` sets
         `width: 100%; height: 100%` from un-migrated SCSS, and unlayered rules outrank
         Tailwind utilities whatever their specificity. */
      <div className="size-[35px] p-0.5" key={action.icon}>
        <ActionButton
          color="tool"
          id={"canvas-action-button-" + action.icon}
          tooltip={action.tooltip}
          action={action.action}
          tooltipPlace={"bottom"}
          icon={action.icon} />
      </div>
      );
    }

  renderActions = () => {
    return (
      <div className={ACTIONS_ROW}>
        {this.renderActionButton(this.props.editorActions.sendToBack)}
        {this.renderActionButton(this.props.editorActions.sendBackward)}
        {this.renderActionButton(this.props.editorActions.sendForward)}
        {this.renderActionButton(this.props.editorActions.sendToFront)}
        <ToolboxBreak/>
        {this.renderActionButton(this.props.editorActions.flipHorizontal)}
        {this.renderActionButton(this.props.editorActions.flipVertical)}
        <ToolboxBreak/>
        {this.renderActionButton(this.props.editorActions.booleanUnite)}
        {this.renderActionButton(this.props.editorActions.booleanSubtract)}
        {this.renderActionButton(this.props.editorActions.booleanIntersect)}
      </div>
    );
  }

  render () {
    return (
      <PopupMenu
        isOpen={this.props.showCanvasActions}
        toggle={this.props.toggleCanvasActions}
        target="more-canvas-actions-popover-button"
      >
        {/* canvas-actions-widget carries no style; dev/interact.mjs opens and closes the
            menu by it. */}
        <div className="canvas-actions-widget m-px flex h-[35px] items-center">
          {!this.props.previewPlaying && this.renderActions()}
        </div>
      </PopupMenu>
    )
  }
}

export default CanvasActions
