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

class InspectorTitle extends Component {

  renderSelectionType = () => {
    return (
      <div className="ml-2 inline-flex h-[80%] items-center text-xl font-bold text-content-muted">
        {this.props.title}
      </div>
    )
  }
  render() {
    return(
      <div className="flex h-9 items-center px-panel-pad whitespace-nowrap">
        <div className="inline-block text-[22px] text-content">Inspector</div>
        {this.props.type && this.props.title && this.renderSelectionType()}
      </div>
    )
  }
}

export default InspectorTitle
