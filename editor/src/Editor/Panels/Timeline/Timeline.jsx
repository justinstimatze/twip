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

import React, { Component, useCallback } from 'react';

import { useDrop } from 'react-dnd';
import DragDropTypes from 'Editor/DragDropTypes.js';

import './_timeline.scss';

import { iconDataUri } from '@/ui/icon';
import TimelineMirror from './TimelineMirror';

/*
 * The canvas timeline's sixteen buttons. They were the last PNGs in the tree, and they were
 * PNGs because `gui/ActionButton.js` blits them with `ctx.drawImage`, which needs an <img>
 * rather than a DOM node. An SVG data URI is an <img>, so they can come from the same set as
 * everything else — and take the same colour, from the same token, instead of the one they
 * were exported with in 2019.
 *
 * `getPropertyValue` at call time rather than module scope: this runs from componentDidUpdate,
 * by which point the stylesheet has certainly landed.
 */
const TIMELINE_ICONS = {
  hide_layer: 'shown',
  show_layer: 'hidden',
  lock_layer: 'unlock',
  unlock_layer: 'lock',
  copy_frame_forward: 'copyForward',
  cut_frame: 'split',
  delete_frame: 'delete',
  add_tween: 'tween',
  small_frames: 'frames-small',
  normal_frames: 'frames-normal',
  large_frames: 'frames-large',
  frame_size_menu: 'frame-size-menu',
  gap_fill_menu_blank_frames: 'gap-fill-blank',
  gap_fill_menu_extend_frames: 'gap-fill-extend',
  gap_fill_empty_frames: 'gap-fill-blank',
  gap_fill_extend_frames: 'gap-fill-extend',
};

class Timeline extends Component {
  constructor (props) {
    super(props);

    this.canvasContainer = React.createRef();
  }

  componentDidMount () {
    let canvasContainerElem = this.canvasContainer.current;
    this.props.project.guiElement.canvasContainer = canvasContainerElem;
    this.props.project.guiElement.draw();
  }

  componentDidUpdate () {
    var project = this.props.project;

    if(project !== this.currentAttachedProject) {
      // Import icons into the timeline GUI.
      let Icons = window.Wick.GUIElement.Icons;
      const color = getComputedStyle(document.documentElement)
        .getPropertyValue('--color-content-subtle').trim() || '#9c9792';
      for (const [slot, name] of Object.entries(TIMELINE_ICONS)) {
        Icons.loadIcon(slot, iconDataUri(name, { color }));
      }

      if(this.currentAttachedProject) {
        this.currentAttachedProject.guiElement.onProjectModified = () => {};
        this.currentAttachedProject.guiElement.onProjectSoftModified = () => {};
      }

      this.currentAttachedProject = project;
      project.guiElement.onProjectModified(this.onProjectModified);
      project.guiElement.onProjectSoftModified(this.onProjectSoftModified);

      let canvasContainerElem = this.canvasContainer.current;
      this.props.project.guiElement.canvasContainer = canvasContainerElem;
      project.guiElement.draw();
    }

    project.guiElement.canvasContainer = this.canvasContainer.current;
  }

  render() {
    const { dropRef, isOver } = this.props;

    return (
      <div id="animation-timeline-container" ref={dropRef} aria-label="Timeline">
        { isOver && <div className="drag-drop-overlay" /> }
        <div id="animation-timeline" ref={this.canvasContainer} />
        {/* The canvas above has no contents an assistive technology can reach. This is the
            same model, mirrored into a focusable DOM grid. See TimelineMirror.jsx. */}
        <TimelineMirror
          project={this.props.project}
          projectData={this.props.projectData}
          projectDidChange={this.props.projectDidChange}
        />
      </div>
    )
  }

  onProjectModified = () => {
      this.props.projectDidChange({ actionName: "Timeline Action" });
  }

  onProjectSoftModified = () => {
      this.props.project.view.render();
  }
}

/*
 * react-dnd 16 removed the DropTarget() decorator in favour of hooks. Same wrapper shape as
 * Canvas.jsx: the class keeps its engine mount (guiElement.canvasContainer) and this owns
 * the hook. `hover` and `drop` call the same handler with a different `commit` flag, which
 * is how a sound preview follows the pointer and then lands.
 */
export default function TimelineDropTarget (props) {
  const { dragSoundOntoTimeline } = props;

  const place = useCallback((item, monitor, commit) => {
    const dropLocation = monitor.getClientOffset();
    if (!dropLocation) return;
    dragSoundOntoTimeline(item.uuid, dropLocation.x, dropLocation.y, commit);
  }, [dragSoundOntoTimeline]);

  const [{ isOver }, dropRef] = useDrop(() => ({
    accept: DragDropTypes.TIMELINE,
    drop: (item, monitor) => place(item, monitor, true),
    hover: (item, monitor) => place(item, monitor, false),
    collect: (monitor) => ({ isOver: monitor.isOver() }),
  }), [place]);

  return <Timeline {...props} dropRef={dropRef} isOver={isOver} />;
}
