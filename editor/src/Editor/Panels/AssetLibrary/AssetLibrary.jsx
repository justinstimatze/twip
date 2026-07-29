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
    }
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

  makeNode = (assetObject, i) => {
    return (
      <Asset
       key={i}
       asset={assetObject}
       isSelected={this.props.isObjectSelected(assetObject)}
       onClick={() => {
         this.props.clearSelection();
         this.props.selectObjects([assetObject]);
      }}
        createAssets={this.props.createAssets}
        importProjectAsWickFile={this.props.importProjectAsWickFile}
        createImageFromAsset={this.props.createImageFromAsset}
        toast={this.props.toast}
        deleteSelectedObjects={this.props.deleteSelectedObjects}
        clearSelection={this.props.clearSelection}
        selectObjects={this.props.selectObjects}
        addSoundToActiveFrame={this.props.addSoundToActiveFrame}
      />
    )
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
              : sortedFilteredAssets.map(this.makeNode)}
          </div>
        </div>
      </div>
    )
  }
}

export default AssetLibrary
