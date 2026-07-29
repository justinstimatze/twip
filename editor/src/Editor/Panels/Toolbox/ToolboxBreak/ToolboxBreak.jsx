
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

/*
 * The `vertical` and `className` props are gone with the small toolbox — the only tree
 * that passed either.
 */
class ToolboxBreak extends Component {
  render() {
    /* A hairline, not a 3px slab. At 3px against the panel it read as a gap between two
       toolbars; at 1px it reads as a rule between two groups of one. */
    return <div className="mx-2 h-4 w-px min-w-px bg-line-strong" />
  }
}

export default ToolboxBreak
