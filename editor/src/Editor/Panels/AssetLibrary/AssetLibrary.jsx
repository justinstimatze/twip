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

import Asset from './Asset/Asset';
import ActionButton from 'Editor/Util/ActionButton/ActionButton';
import WickInput from 'Editor/Util/WickInput/WickInput';
import ToolIcon from 'Editor/Util/ToolIcon/ToolIcon';
import { PanelHeader, PanelEmpty } from '@/ui/panel';

import './_assetlibrary.scss';

class AssetLibrary extends Component {
  constructor(props) {
    super(props);

    this.state = {
      filterText: '',
      /*
       * Which tile the keyboard is on. Deliberately not the selection: selectObjects goes
       * through projectDidChange, which pushes an undo state, so arrowing across ten assets
       * the way a listbox normally does — selection following focus — would bury the history
       * under ten entries that changed nothing. Same rule the timeline mirror follows: moving
       * around is not editing. Enter or Space is what selects.
       */
      focusIndex: 0,
    }

    this.gridRef = React.createRef();
  }

  openFileDialog = (uuid) => {
    this.props.openImportAssetFileDialog();
  }

  openBuiltinAssetLibrary = () => {
    this.props.openModal('BuiltinLibrary');
  }

  updateFilter = (text) => {
    this.setState({
      filterText: text,
    });
  }

  filterArray = (array) => {
    let filterText = this.state.filterText.toLowerCase();
    return array.filter( item => {
        return !item.isGifImage && item.name.toLowerCase().includes(filterText);
    });
  }

  select = (assetObject) => {
    this.props.clearSelection();
    this.props.selectObjects([assetObject]);
  }

  /*
   * `focus` is passed in already clamped rather than read from state here. Filtering and
   * deleting both shorten the list under a focusIndex that outlives them, and an index past
   * the end leaves every tile at tabIndex -1 — a grid the Tab key cannot enter at all, which
   * looks like nothing being wrong.
   */
  makeNode = (focus) => (assetObject, i) => {
    return (
      <Asset
        key={assetObject.uuid}
        asset={assetObject}
        isSelected={this.props.isObjectSelected(assetObject)}
        isFocused={i === focus}
        onClick={() => {
          this.setState({ focusIndex: i });
          this.select(assetObject);
        }}
      />
    )
  }

  /*
   * Arrow keys across a grid whose column count nobody knows.
   *
   * The tiles are laid out by `auto-fill`, so how many fit is a function of the width the
   * user dragged the panel to — there is no column count in this component to do arithmetic
   * with. Reading the geometry back is both simpler and correct for any width: up and down
   * look for the nearest tile on an adjacent row, measured by how far its left edge is from
   * the current one.
   */
  moveFocus = (assets, event) => {
    const tiles = this.gridRef.current
      ? Array.from(this.gridRef.current.querySelectorAll('[role="option"]'))
      : [];
    if (!tiles.length) return;

    const from = Math.min(this.state.focusIndex, tiles.length - 1);
    const here = tiles[from].getBoundingClientRect();
    let next = null;

    if (event.key === 'ArrowLeft') next = from - 1;
    else if (event.key === 'ArrowRight') next = from + 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tiles.length - 1;
    else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      const down = event.key === 'ArrowDown';
      let best = null;
      tiles.forEach((tile, i) => {
        const box = tile.getBoundingClientRect();
        const onAnotherRow = down ? box.top > here.top + 1 : box.top < here.top - 1;
        if (!onAnotherRow) return;
        const cost = Math.abs(box.left - here.left) + Math.abs(box.top - here.top) * 100;
        if (!best || cost < best.cost) best = { i, cost };
      });
      next = best ? best.i : from;
    } else if (event.key === 'Enter' || event.key === ' ') {
      this.select(assets[from]);
      event.preventDefault();
      event.stopPropagation();
      return;
    } else {
      return;
    }

    /* Both: preventDefault stops Home/End and the arrows scrolling the panel, and
     * stopPropagation keeps them off the editor's nudge-the-selection shortcut. */
    event.preventDefault();
    event.stopPropagation();

    const clamped = Math.max(0, Math.min(tiles.length - 1, next));
    this.setState({ focusIndex: clamped });
    tiles[clamped].focus();
  }

  /*
   * What you can do with the asset you picked. These were inside the row before, which a tile
   * has no room for and a role="option" may not contain. Only while something is selected, so
   * the grid keeps the height the rest of the time.
   */
  renderActions = (assets) => {
    const selected = assets.filter(this.props.isObjectSelected);
    if (selected.length !== 1) return null;
    const asset = selected[0];
    const sound = asset.classname === 'SoundAsset';

    return (
      <div className="flex h-8 shrink-0 items-center gap-1 border-t border-line bg-surface-sunken px-1.5">
        <div className="min-w-0 flex-1">
          <ActionButton
            color="green"
            id="asset-action-add"
            text={sound ? 'Add to Frame' : 'Add to Canvas'}
            action={() => {
              if (sound) this.props.addSoundToActiveFrame(asset);
              else this.props.createImageFromAsset(asset.uuid, 0, 0, true);
            }} />
        </div>
        <div className="h-5 w-5">
          <ActionButton
            color="red"
            id="asset-action-delete"
            icon="delete-black"
            tooltip={`Delete ${asset.name}`}
            action={() => {
              this.props.clearSelection();
              this.props.selectObjects([asset]);
              this.props.deleteSelectedObjects();
            }} />
        </div>
      </div>
    );
  }

  /**
   * Sorts an array of assets by their names.
   * @param  {Wick.Asset[]} assets An array of Wick.Asset objects.
   * @return {Wick.Asset[]}        Returns a sorted array of Wick.Assets.
   */
  sortAssets = (assets) => {
    let copiedAssets = [].concat(assets);

    // Perform alphabetic sort.
    copiedAssets.sort( (a,b) => a.name.localeCompare(b.name) );
    return copiedAssets;
  }

  renderTitle = () => {
    return (
      <PanelHeader
        label="Assets"
        context={this.props.assets.length ? String(this.props.assets.length) : null}
      >
        <div className="h-5 w-5">
          <ActionButton
            color="upload"
            action={this.openBuiltinAssetLibrary}
            id="button-asset-builtin"
            icon="add"
            tooltip="Add Builtin Asset" />
        </div>
        <div className="h-5 w-5">
          <ActionButton
            color="upload"
            action={this.openFileDialog}
            id="button-asset-upload"
            icon="upload"
            tooltip="Upload Assets" />
        </div>
      </PanelHeader>
    )
  }

  render() {
    let filteredAssets = this.filterArray(this.props.assets);
    let sortedFilteredAssets = this.sortAssets(filteredAssets);
    let filtering = this.state.filterText.length > 0;
    let focus = Math.max(0, Math.min(this.state.focusIndex, sortedFilteredAssets.length - 1));
    return(
      <div className="asset-library docked-pane flex h-full w-full flex-col overflow-hidden border-r border-b border-line bg-surface" aria-label="Asset Library">
        {this.renderTitle()}
        <div className="asset-library-body flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="asset-library-filter flex h-7 shrink-0 items-center border-b border-line bg-surface-sunken">
            <div className="asset-library-filter-icon ml-1.5 h-3.5 w-3.5 shrink-0 opacity-60">
              <ToolIcon name="search" />
            </div>
            <WickInput
              id="asset-library-filter-input"
              aria-label="filter"
              placeholder="filter..."
              type="text"
              onChange={this.updateFilter}
              value={this.state.filterText}/>
          </div>
          <div className="asset-library-asset-container min-h-0 flex-1 overflow-hidden hover:overflow-y-auto">
            {sortedFilteredAssets.length === 0
              ? (
                <PanelEmpty>
                  {filtering
                    ? `No asset matches "${this.state.filterText}".`
                    : 'Drop images or sounds here, or use + to add one.'}
                </PanelEmpty>
              )
              : (
                /* auto-fill at a 64px floor: two columns at the sidebar's 200px minimum,
                   three or four once it is dragged wider, and no breakpoint to maintain. */
                <div
                  ref={this.gridRef}
                  role="listbox"
                  aria-label="Assets"
                  className="grid grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-1.5 p-1.5"
                  onKeyDown={(e) => this.moveFocus(sortedFilteredAssets, e)}
                >
                  {sortedFilteredAssets.map(this.makeNode(focus))}
                </div>
              )}
          </div>
          {this.renderActions(sortedFilteredAssets)}
        </div>
      </div>
    )
  }
}

export default AssetLibrary
