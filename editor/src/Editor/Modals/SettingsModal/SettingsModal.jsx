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
import WickModal from 'Editor/Modals/WickModal/WickModal';
import TabbedInterface from 'Editor/Util/TabbedInterface/TabbedInterface';
import EditorSettings from './EditorSettings/EditorSettings';
import KeyboardShortcuts from './KeyboardShortcuts/KeyboardShortcuts';

import './_settingsmodal.scss';
import classNames from 'classnames';

/*
 * Settings is about the editor now, not about the document. The Project tab that used to lead
 * it — name, framerate, size, background, resolution presets — is the Inspector's Doc tab,
 * where it can be read while the stage it describes is visible. Two places to set the stage
 * width was the whole argument for deleting SimpleProjectSettings; leaving this one standing
 * would have made that argument twice and acted on it once.
 */
class SettingsModal extends Component {
  renderDesktop = () => {
    return (
      <WickModal
      open={this.props.open} 
      toggle={this.props.toggle}
      className="settings-modal-container"
      overlayClassName="settings-modal-overlay">
        <div className="settings-modal-title">
          Settings
        </div>
        <div className="settings-modal-body">
          <TabbedInterface label="Settings" tabNames={["Shortcuts", "Editor"]} >
            <KeyboardShortcuts
              addCustomHotKeys={this.props.addCustomHotKeys}
              resetCustomHotKeys={this.props.resetCustomHotKeys}
              customHotKeys={this.props.customHotKeys}
              keyMap={this.props.keyMap}
              keyMapGroups={this.props.keyMapGroups}
              toast={this.props.toast} 
              toggle={this.props.toggle}
              createCombinedHotKeyMap={this.props.createCombinedHotKeyMap}/>
            <EditorSettings 
              colorPickerType={this.props.colorPickerType}
              changeColorPickerType={this.props.changeColorPickerType}
              updateLastColors={this.props.updateLastColors}
              lastColorsUsed={this.props.lastColorsUsed}
              getToolSetting={this.props.getToolSetting}
              setToolSetting={this.props.setToolSetting}
              toggle={this.props.toggle}
              getToolSettingRestrictions={this.props.getToolSettingRestrictions}/>
          </TabbedInterface>
        </div>
      </WickModal>
    );
  }

  renderMobile = () => {
    return (
      <WickModal
      open={this.props.open} 
      toggle={this.props.toggle}
      className={classNames("settings-modal-container", this.props.isMobile && "mobile")}
      overlayClassName="settings-modal-overlay">
        <div className="settings-modal-title">
          Settings
        </div>
        {/* No tab rail: with Project gone this is one panel, and a tablist of one is a
            heading wearing tab roles. */}
        <div className="settings-modal-body">
          <EditorSettings
            isMobile={true}
            colorPickerType={this.props.colorPickerType}
            changeColorPickerType={this.props.changeColorPickerType}
            updateLastColors={this.props.updateLastColors}
            lastColorsUsed={this.props.lastColorsUsed}
            getToolSetting={this.props.getToolSetting}
            setToolSetting={this.props.setToolSetting}
            getToolSettingRestrictions={this.props.getToolSettingRestrictions}/>
        </div>
      </WickModal>
    );
  }

  render() {
    if (this.props.isMobile) {
      return this.renderMobile();
    }
    else {
      return this.renderDesktop();
    }
  }
}

export default SettingsModal
