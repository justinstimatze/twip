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
import { stageBackground } from '@/theme';

import './_canvas.scss';

class Canvas extends Component {
  constructor (props) {
    super(props);

    this.canvasContainer = React.createRef();
  }

  componentDidMount() {
    this.attachProjectToComponent(this.props.project);

    this.updateCanvas(this.props.project);

    this.props.onRef(this);
  }

  componentDidUpdate () {
    this.updateCanvas(this.props.project);
  }

  attachProjectToComponent = (project) => {
    if(this.currentAttachedProject === project) return;
    this.currentAttachedProject = project;

    // The void the stage floats in — the darkest surface in the app, so the artwork is the
    // brightest thing on screen and the eye goes there first. Read from the token layer
    // rather than inlined, so index.css stays the one place the palette lives. The viewer
    // passes the page surface instead, so the stage reads as letterboxed rather than as a
    // pasteboard with nothing pinned to it.
    project.view.canvasBGColor = this.props.canvasBGColor ?? stageBackground();
    project.view.canvasContainer = this.canvasContainer.current;
    project.view.resize();

    project.view.on('canvasModified', (e, actionName) => {
      this.props.projectDidChange({ actionName: `Canvas Modified ${actionName}` });
    });

    project.view.on('eyedropperPickedColor', (e) => {
      this.props.onEyedropperPickedColor(e);
    });

    project.view.on('canvasRequestRender', (e, actionName) => {
      this.props.projectDidChange({ actionName: `Canvas Request Render ${actionName}`, skipHistory: true });
    });
  }

  updateCanvas = (project) => {
    this.attachProjectToComponent(project);
  }

  render() {
    const { dropRef, isOver } = this.props;

    return (
      <div id="canvas-container-wrapper" ref={dropRef} style={{width:"100%", height:"100%"}} aria-label="Canvas">
        { isOver && <div className="drag-drop-overlay" /> }
        <div id="wick-canvas-container" ref={this.canvasContainer}></div>
      </div>
    )
  }
}

/*
 * react-dnd 16 removed the DropTarget()/DragSource() decorators in favour of hooks, so the
 * class keeps its imperative engine mount (attachProjectToComponent, componentDidMount) and
 * this thin function wrapper owns the hook, handing the connector down as a plain ref prop.
 * Deliberately not converting Canvas itself: it holds the paper.js view and turning it into
 * a function component is Phase 1b work, not a side effect of a dependency bump.
 */
export default function CanvasDropTarget (props) {
  const { importProjectAsWickFile, createAssets, createImageFromAsset } = props;

  const onDrop = useCallback((item, monitor) => {
    const dropLocation = monitor.getClientOffset();
    if (item.files && item.files.length > 0) {
      // Dropped a file from the native filesystem
      if (item.files[0].name.endsWith('.wick')) {
        importProjectAsWickFile(item.files[0]);
      } else {
        // Assets (images, sounds, etc)
        createAssets(item.files, [], { create: true, location: dropLocation });
      }
    } else {
      // Dropped an asset from the asset library
      createImageFromAsset(item.uuid, dropLocation.x, dropLocation.y);
    }
  }, [importProjectAsWickFile, createAssets, createImageFromAsset]);

  const [{ isOver }, dropRef] = useDrop(() => ({
    accept: DragDropTypes.CANVAS,
    drop: onDrop,
    collect: (monitor) => ({ isOver: monitor.isOver() }),
  }), [onDrop]);

  return <Canvas {...props} dropRef={dropRef} isOver={isOver} />;
}
