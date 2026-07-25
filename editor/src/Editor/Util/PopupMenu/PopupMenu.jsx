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

import React from 'react';
import { AnchoredPopover } from '@/ui/popover';
import './_popupmenu.scss'
import classNames from 'classnames';

/**
 * The three call sites all pass `isOpen`/`toggle` from editor state, so open state stays
 * where it is and Radix is told about it rather than owning it. `onOpenChange` fires for
 * outside clicks and Escape; both should call `toggle`, and neither should call it a
 * second time on the way open.
 */
function PopupMenu (props) {
  return (
    <AnchoredPopover
      target={props.target}
      open={!!props.isOpen}
      onOpenChange={(open) => { if (!open) props.toggle(); }}
      className={classNames('popup-menu-popover', props.mobile && 'mobile', props.className)}
    >
      {props.children}
    </AnchoredPopover>
  )
}

export default PopupMenu
