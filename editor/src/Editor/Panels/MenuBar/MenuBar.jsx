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
 * The top rail.
 *
 * Three things changed beyond the palette, and each was doing damage:
 *
 * The project name was centred, which put the least interactive thing in the room at the
 * optical centre and left both ends looking unbalanced. It sits at the left now, next to the
 * mark, where a document's name goes.
 *
 * Every action was the same weight, in the same lowercase, at the same size — including SWF,
 * which is the reason this program exists. SWF is the one filled control on the rail now and
 * everything else is quiet text. "SWF leads" was settled during the export work; this is that
 * decision reaching the chrome.
 *
 * And the mark was Wick's mascot. See ui/mark.jsx.
 */
import React, { Component } from 'react';
import MenuBarIconButton from './MenuBarIconButton/MenuBarIconButton';
import { TwipMark, TwipWordmark } from '@/ui/mark';
import { cn } from '@/lib/utils';

/*
 * A rail action. Quiet by default: text only, no chrome until the pointer is on it, which is
 * what keeps a row of five of them from reading as a toolbar of equals. `emphasis` promotes
 * exactly one of them.
 */
function RailButton ({ text, action, emphasis, id }) {
  return (
    <button
      type="button"
      id={id}
      onClick={action}
      className={cn(
        'h-6 rounded-sm px-2.5 text-[12px] font-medium transition-colors duration-100',
        emphasis === 'primary'
          ? 'bg-accent text-accent-content hover:bg-accent-hover active:bg-accent-active'
          : emphasis === 'outline'
            ? 'border border-line-strong text-content hover:border-ash-600 hover:bg-surface-hover'
            : 'text-content-muted hover:bg-surface-hover hover:text-content',
      )}
    >
      {text}
    </button>
  );
}

class MenuBar extends Component {
  render () {
    return (
      <div
        className="flex h-full w-full items-center gap-2 border-b border-line bg-ash-950 pr-1.5 pl-2"
        aria-label="Menu Bar"
      >
        <button
          type="button"
          id="tool-information-button"
          onClick={() => this.props.openModal('EditorInfo')}
          title="About twip"
          className="flex h-7 items-center gap-1.5 rounded-sm px-1 text-accent transition-colors hover:bg-surface-hover"
        >
          <TwipMark className="h-4 w-4" />
          <TwipWordmark className="text-[13px] font-semibold text-content" />
        </button>

        <div className="h-4 w-px shrink-0 bg-line" aria-hidden="true" />

        {/* The project name is still the handle for the project's settings; the settings are
            no longer a dialog over the stage you are sizing. See InspectorDocument. */}
        {/* No aria-label: the visible text is the project name, and naming the button
            "Project settings" would replace it — WCAG's Label in Name wants the accessible
            name to contain what is written on the control. What the button DOES belongs in
            the description, which is what title already is. */}
        <button
          type="button"
          id="menu-bar-project-name"
          onClick={this.props.openProjectSettings}
          title="Project settings"
          className="min-w-0 truncate rounded-sm px-1.5 py-0.5 text-[13px] text-content-muted transition-colors hover:bg-surface-hover hover:text-content"
        >
          {this.props.projectName}
        </button>

        <div className="ml-auto flex items-center gap-0.5">
          <RailButton text="New" action={this.props.openNewProjectConfirmation} />
          <RailButton text="Open" action={this.props.openProjectFileDialog} />
          <RailButton text="Export" action={() => {
            this.props.exporting ? this.props.openExportMedia() : this.props.openExportOptions();
          }} />
          <RailButton text="Save" action={this.props.exportProjectAsWickFile} emphasis="outline" />

          <div className="mx-1.5 h-4 w-px shrink-0 bg-line" aria-hidden="true" />

          {/* Previews in Ruffle; writing a .swf to disk is under Export. */}
          <RailButton text="SWF" action={this.props.previewProjectAsSWF} emphasis="primary" />

          <MenuBarIconButton
            icon="gear"
            action={() => this.props.openModal('SettingsModal')}
            tooltip="Editor Settings"
            tooltipPlace="left"
            id="editor-settings-button"
          />
        </div>
      </div>
    );
  }
}

export default MenuBar;
