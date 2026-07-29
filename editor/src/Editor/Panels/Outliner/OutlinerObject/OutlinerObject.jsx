import React, { useRef, useState } from 'react';

import '../_outliner.scss';

import { DragPreviewImage, useDrag, useDrop } from 'react-dnd';
import DragDropTypes from 'Editor/DragDropTypes.js';

import OutlinerDropdown from './OutlinerDropdown/OutlinerDropdown'
import OutlinerWidget from '../OutlinerWidget/OutlinerWidget'

import ToolIcon from 'Editor/Util/ToolIcon/ToolIcon';

import layerImage from 'resources/object-icons/layer.png';
import frameImage from 'resources/object-icons/frame.png';
import pathImage from 'resources/object-icons/path.png';
import buttonImage from 'resources/object-icons/button.png';
import clipImage from 'resources/object-icons/clip.png';
import textImage from 'resources/object-icons/text.png';
import imageImage from 'resources/object-icons/image.png';

// Row icons come from the shared set now; these seven names map onto it.
let icons = {layer: 'layer-object', frame: 'frame', path: 'path-object', button: 'button-object',
  clip: 'clip-object', text: 'text-object', image: 'image-object'};

/*
 * The drag previews stay raster. The HTML5 drag-and-drop API takes a real loaded <img> for
 * setDragImage and will not accept an inline SVG node, and react-dnd's fallback — a snapshot
 * of the drag source — is a blank rectangle here, because the source is the invisible
 * selector button overlaying the row. Seven PNGs whose only job is to be a bitmap.
 */
let images = {layer: layerImage, frame: frameImage, path: pathImage, button: buttonImage,
  clip: clipImage, text: textImage, image: imageImage};
import classNames from 'classnames';
export const OutlinerObject = ({clearSelection, selectObjects, 
  editScript, playhead, depth, maxDepth, display, highlighted, 
  toggle, data, isActive, collapsedUUIDs, dragging, setDragging, 
  setFocusObject, setActiveLayerIndex, moveSelection}) => {

  const ref = useRef(null);

  /*
   * react-dnd 14 moved `type` out of the item and removed `begin` — the side effects that
   * used to live in `begin` go in `item` as a factory, which runs at the same moment. The
   * returned item still carries `type` because the drop handler below reads `item.type` to
   * decide whether a drop is same-kind (reorder) or cross-kind (reparent).
   */
  const dragType = DragDropTypes.GET_OUTLINER_SOURCE({data});
  const [, drag, preview] = useDrag({
    type: dragType,
    item: () => {
      setDragging(true);

      // Dragging something outside the current selection selects it first, so a drag
      // always moves what is under the pointer rather than a stale selection.
      if (!data.isSelected) {
        clearSelection();
        selectObjects([data]);
        setActiveLayerIndex(data.classname === 'Layer' ? data.index : data.parentLayer.index);
      }

      return { type: dragType, uuid: data.uuid };
    },
    end: () => {
      setDragging(false);
    },
  })

  const [focused, setFocused] = useState(false);
  const [hoverLocation, setHoverLocation] = useState(null);

  const [{ isOverCurrent }, drop] = useDrop({
    accept: DragDropTypes.GET_OUTLINER_TARGETS({data}),
    drop: (item, monitor) => {
      if (monitor.didDrop()) return;
      let type = DragDropTypes.GET_OUTLINER_SOURCE({data});
      if (item.type === type) {
        // Drop above or below
        // Determine rectangle on screen
        const hoverBoundingRect = ref.current ? ref.current.getBoundingClientRect() : null;

        // Get vertical half
        const hoverMiddle = (hoverBoundingRect.bottom - hoverBoundingRect.top - (hoverLocation ? 5 : 0)) / 2.0 ;
        // Determine mouse position
        const clientOffset = monitor.getClientOffset();
        // Get pixels to the top
        const hoverClientY = clientOffset.y - hoverBoundingRect.top;

        if (hoverClientY <= hoverMiddle ^ type === 'object') {
          //above
          moveSelection(data.parent, data.parent.getChildren().indexOf(data));
        }
        else {
          //below
          moveSelection(data.parent, data.parent.getChildren().indexOf(data) + 1);
        }
      }
      else if (type === 'layer') {
        if (item.type === 'object') {
          if (data.activeFrame) {
            moveSelection(data.activeFrame, data.activeFrame.getChildren().length);
          }
        }
      }
      else if (type === 'frame') {
        if (item.type === 'object') {
          moveSelection(data, data.getChildren().length);
        }
      }
    },
    collect: (monitor) => ({
      isOverCurrent: monitor.isOver({ shallow: true }),
    }),
    hover: (item, monitor) => {
      const types = ['object', 'frame', 'layer'];

      if (types.indexOf(item.type) === 
          types.indexOf(DragDropTypes.GET_OUTLINER_SOURCE({data}))) {
        // Drop above or below
        // Determine rectangle on screen
        if (!ref.current) return;
        const hoverBoundingRect = ref.current.getBoundingClientRect();

        // Get vertical half
        const hoverMiddle = (hoverBoundingRect.bottom - hoverBoundingRect.top - (hoverLocation ? 5 : 0)) / 2.0 ;
        // Determine mouse position
        const clientOffset = monitor.getClientOffset();
        // Get pixels to the top
        const hoverClientY = clientOffset.y - hoverBoundingRect.top;

        if (hoverClientY <= hoverMiddle) {
          //above
          setHoverLocation('hover-top');
        }
        else {
          //below
          setHoverLocation('hover-bottom');
        }
      }
      else {
        // Drop inside
        setHoverLocation('hover-middle');
      }
    },
  })

  const object_name = data.classname === "Layer" ? data.name : data.identifier;

  let empty = true;
  const children = data.getChildren();
  if (depth < maxDepth) {
    for (let i = 0; i < children.length; i++) {
      let object = children[i];

      if (isActive(object)) {
        empty = false;
          break;
      }
    }
  }

  const typeIcon = data.classname === 'Path' ? 
                    icons[data.pathType] : 
                    icons[data.classname.toLowerCase()];
  const typeDragImage = data.classname === 'Path' ? 
                    images[data.pathType] : 
                    images[data.classname.toLowerCase()];
  
  drop(ref)

  return (
  <>
  <DragPreviewImage connect={preview} src={typeDragImage}/>
  <div 
  ref={ref}
  className={classNames("outliner-object-container", 
  hoverLocation !== 'hover-middle' && isOverCurrent && hoverLocation)}> 
    <div 
    className={classNames("outliner-object", 
    {"object-selected": data.isSelected && !focused},
    {"object-dragging": dragging && (data.isSelected || data.parent.isSelected || data.parent.parent.isSelected) },
    {"highlighted": highlighted === data},
    hoverLocation === 'hover-middle' && isOverCurrent && hoverLocation)}>
    <button
    aria-label="select outliner object"
    ref={drag}
    className="outliner-object-selector"
    onClick={(e) => {
      toggle(e, [], 'select')}}
    onFocus={() => setFocused(true)}
    onBlur={() => setFocused(false)}
      
    onKeyPress={(e) => {
      if (e.which === 13 && e.ctrlKey){
        toggle(e, [], 'select');
      }
    }}  />
    <OutlinerDropdown 
    empty={empty}
    collapsed={collapsedUUIDs[data.uuid]}
    toggle={(e) => toggle(e, [], 'dropdown')}/>

    <ToolIcon className="row-icon" name={typeIcon} />

    {object_name && 
    <span className="outliner-name">
      {object_name}
    </span>}

    <span className="outliner-buttons-container">
      {data.classname === 'Layer' &&
        <OutlinerWidget onClick={(e) => {toggle(e, [], 'hidden')}} on={!data.hidden} icon="outliner-hide" tooltip="Hide Layer"/>
      }
      {data.classname === 'Layer' &&
        <OutlinerWidget onClick={(e) => {toggle(e, [], 'locked')}} on={!data.locked} icon="outliner-lock" tooltip="Lock Layer"/>
      }
      {(data.classname === 'Button' || data.classname === 'Clip') &&
        <OutlinerWidget key={Math.random()} onClick={() => {console.log("yangus"); setFocusObject(data)}} icon="edit-timeline" tooltip="Edit Timeline"/>
      }
      {data.sound &&
        <ToolIcon className="outliner-sound-icon" name="sound" />}
      {data.hasContentfulScripts &&
        <button
        type="button"
        className="outliner-script-icon"
        aria-label="edit script"
        onClick={() => {
          clearSelection();
          selectObjects([data]);
          if (data.classname === 'Layer') {
            setActiveLayerIndex(data.index);
          }
          else {
            setActiveLayerIndex(data.parentLayer.index);
          }
          editScript(data.scripts[0].name);
        }}><ToolIcon name="script" /></button>}
    </span>
    </div>
    

    {!empty && !collapsedUUIDs[data.uuid] && 
    <div className="indentation">
      {children.map((object, i) => {
        if (data.classname === 'Frame') {
          //reverse order of children of frames 
          //so items rendered on top are on top 
          //of list
          object = children[children.length - i - 1];
        }

        return (isActive(object) &&
        <OutlinerObject
          key={object.uuid}
          clearSelection={clearSelection}
          selectObjects={selectObjects}
          editScript={editScript}
          playhead={playhead}
          depth={depth + 1}
          maxDepth={maxDepth}
          display={display}
          highlighted={highlighted}
          toggle={(e, indices, property) => {
            indices.unshift(i);
            toggle(e, indices, property);
          }}
          data={object}
          isActive={isActive}
          collapsedUUIDs={collapsedUUIDs}
          dragging={dragging}
          setDragging={setDragging}
          setFocusObject={setFocusObject}
          setActiveLayerIndex={setActiveLayerIndex}
          moveSelection={moveSelection}
        />)
      })}
    </div>}
  </div>
  </>);
}
