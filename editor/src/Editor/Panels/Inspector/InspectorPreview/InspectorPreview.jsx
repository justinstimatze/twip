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

import AudioPlayer from 'Editor/Util/AudioPlayer/AudioPlayer';

class InspectorPreview extends Component {

  render() {
    if (this.props.info.type === "image") {
      return (
        <div className="my-panel-pad flex h-[100px] w-full items-center justify-center">
          <img alt='' className="h-[100px] w-auto" src={this.props.info.src} />
        </div>
      )
    } else if (this.props.info.type === 'sound') {
      return (
        <div className="m-[5px]">
          <AudioPlayer key={Math.random()} src={this.props.info.src}/>
        </div>
      );
    } else {
      return (
        <div />
      )
    }
  }
}

export default InspectorPreview
