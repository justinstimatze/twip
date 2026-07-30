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

import { Component } from 'react';
import queryString from 'query-string';
import VideoExport from './export/VideoExport';
import GIFExport from './export/GIFExport';
import GIFImport from './import/GIFImport';
import AudioExport from './export/AudioExport';

class EditorCore extends Component {

  /**
   * Returns the name of the active tool.
   * @returns {string} The string representation active tool name.
   */
  getActiveTool = () => {
    return this.project.activeTool;
  }

  /**
   * Change the active tool.
   * @param {string} newTool - The string representation of the tool to switch to.
   */
  setActiveTool = (newTool) => {
    if(newTool !== this.getActiveTool().name) {
      this.lastUsedTool = this.getActiveTool();
      this.project.activeTool = newTool;

      this._onEyedropperPickedColor = (color) => {
        this.project.toolSettings.setSetting('fillColor', new window.Wick.Color(color));
      };

      // Close the tool popups on a tool change. This started as a crash workaround —
      // reactstrap's popover looked its anchor up by id and threw when the anchor left
      // the page (reactstrap#894). Radix takes a null anchor without complaint, so the
      // crash is gone, but closing is still the right behaviour: a brush-modes popup
      // hanging over the page after you switch to the eyedropper is just stale.
      this.toggleBrushModes(false);
      this.toggleCursorTransformModes(false);
      this.toggleGradientToolModes(false);

      this.projectDidChange({ actionName: "Set Active Tool: " + newTool });
    }
  }

  /**
   * Toggles highlighted clip borders.
   */
  toggleClipBorders = () => {
    this.project.showClipBorders = !this.project.showClipBorders;
    this.projectDidChange({ actionName: "Toggle Clip Borders"});
  }

  /**
   * Activates the tool that was used before the current tool was activated.
   */
  activateLastTool = () => {
    this.project.activeTool = this.lastUsedTool;
    this.projectDidChange({ actionName: "Activate Last Tool" });
  }

  /**
   * Undo the last action that was done.
   */
  undoAction = () => {
    if(!this.project.undo()) {
      this.toast('Nothing to undo.', 'warning');
    } else {
      this.projectDidChange({ skipHistory:true, actionName: "Undo" });
    }
  }

  /**
   * Recover the state of the project from before the last action was done.
   */
  redoAction = () => {
    if(!this.project.redo()) {
      this.toast('Nothing to redo.', 'warning');
    } else {
      this.projectDidChange({skipHistory:true, actionName: "Redo" });
    }
  }

  /**
   * Recenters the canvas.
   */
  recenterCanvas = () => {
    this.project.recenter();
    this.projectDidChange( { skipHistory: true, actionName: "recenterCanvas"} );
  }

  /**
   * Zooms in the canvas.
   */
  zoomIn = () => {
    this.project.zoomIn();
    this.project.view.render();
  }

  /**
   * Zooms out the canvas.
   */
  zoomOut = () => {
    this.project.zoomOut();
    this.project.view.render();
  }

  /**
   * Returns an object containing the tool settings.
   * @returns {object} The object containing the tool settings.
   */
  getToolSetting = (name) => {
    return this.project.toolSettings.getSetting(name);
  }

  /**
   * Updates the tool settings state.
   * @param {object} newToolSettings - An object of key-value pairs where the keys represent tool settings and the values represent the values to change those settings to.
   */
  setToolSetting = (name, value) => {
    this.project.toolSettings.setSetting(name, value);
    this.projectDidChange({actionName: "Change Tool Setting " + name + ":" + value });
  }

  /**
   *
   */
  getToolSettingRestrictions = (name) => {
      return this.project.toolSettings.getSettingRestrictions(name);
  }

  /**
   * Returns all animation types available
   * @returns {Object[]} - Animation types listed as objects with label and value keys.
   */
  getClipAnimationTypes = () => {
    let outputTypes = [];
    Object.keys(window.Wick.Clip.animationTypes).forEach(key => {
      outputTypes.push({label: window.Wick.Clip.animationTypes[key], value: key});
    });
    return outputTypes;
  }

  /**
   * Shrinks the brush/eraser size by a given amount.
   */
  changeBrushSize = (amt) => {
    var tool = this.project.activeTool.name
    var option;
    if(tool === 'brush') {
        option = 'brushSize';
    } else if (tool === 'eraser') {
        option = 'eraserSize';
    } else {
        return;
    }

    let brushSize = this.getToolSetting(option);
    let newBrushSize = brushSize += amt;

    this.setToolSetting(option, newBrushSize);
  }

  /**
   * Moves the active timeline's playhead forward one frame.
   */
  movePlayheadForwards = () => {
    this.project.focus.timeline.playheadPosition++;
    this.project.guiElement.checkForPlayheadAutoscroll();
    this.project.view.render();
    this.project.guiElement.draw();
  }

  /**
   * Moves the active timeline's playhead backwards one frame.
   */
  movePlayheadBackwards = () => {
    this.project.focus.timeline.playheadPosition--;
    this.project.guiElement.checkForPlayheadAutoscroll();
    this.project.view.render();
    this.project.guiElement.draw();
  }

  /**
   * Finishes a playhead moving operation.
   */
  finishMovingPlayhead = () => {
    this.projectDidChange({ actionName: "Finish Moving Playhead" });
  }

  /**
   * Determines the type of the object/objects that are in the selection state.
   * @returns {string} The string representation of the type of object/objects selected
   */
  getSelectionType = () => {
    return this.project.selection.selectionType;
  }

  /**
   * Returns true if the selection is scriptable.
   * @return {boolean} True if the selection is scriptable.
   */
  selectionIsScriptable = () => {
    return this.project.selection.isScriptable;
  }

  /**
   * The selected scriptable object.
   * @return {Wick.Frame|Wick.Clip} object - the scriptable object that is selected
   */
  getSelectedObjectScript = () => {
    if(this.selectionIsScriptable()) {
      return this.project.selection.getSelectedObject();
    } else {
      return null;
    }
  }

  /**
   * Returns all selected objects on the timeline.
   * @returns {(<Wick.Frame>|<Wick.Tween>)[]} An array containing the selected
   * tweens and frames
   */
  getSelectedTimelineObjects = () => {
    return this.project.selection.getSelectedObjects('Timeline');
  }

  /**
   * Returns all selected frames.
   * @returns {<Wick.Frame>)[]} An array containing the selected frames.
   */
  getSelectedFrames = () => {
    return this.project.selection.getSelectedObjects('Frame');
  }

  /**
   * Returns all selected tweens.
   * @returns {<Wick.Tween>)[]} An array containing the selected tweens.
   */
  getSelectedTweens = () => {
    return this.project.selection.getSelectedObjects('Tween');
  }

  /**
   * Returns all selected objects on the timeline.
   * @returns {(<Wick.Path>|<Wick.Clip>|<Wick.Button>)[]} An array containing
   * the selected clips and paths
   */
  getSelectedCanvasObjects = () => {
    return this.project.selection.getSelectedObjects('Canvas');
  }

  /**
   * Returns all selected paths.
   * @returns {<Wick.Path>)[]} An array containing the selected paths.
   */
  getSelectedPaths = () => {
    return this.project.selection.getSelectedObjects('Path');
  }

  /**
   * Returns all selected clips.
   * @returns {<Wick.Clip>)[]} An array containing the selected clips.
   */
  getSelectedClips = () => {
    return this.project.selection.getSelectedObjects('Clip');
  }

  /**
   * Returns all selected buttons.
   * @returns {<Wick.Button>)[]} An array containing the selected buttons.
   */
  getSelectedButtons = () => {
    return this.project.selection.getSelectedObjects('Button');
  }

  /**
   * Returns all selected objects in the asset library.
   * @returns {(<Wick.ImageAsset>|<Wick.SoundAsset>)[]} An array containing the
   * selected assets
   */
  getSelectedAssetLibraryObjects = () => {
    return this.project.selection.getSelectedObjects('AssetLibrary');
  }

  /**
   * Returns all selected sound assets from the asset library.
   * @returns {(<Wick.SoundAsset>)[]} An array containing the selected sound
   * assets.
   */
  getSelectedSoundAssets = () => {
    return this.project.selection.getSelectedObjects('SoundAsset');
  }

  /**
   * Returns all selected image assets from the asset library.
   * @returns {(<Wick.ImageAsset>)[]} An array containing the selected image
   * assets.
   */
  getSelectedImageAssets = () => {
    return this.project.selection.getSelectedObjects('ImageAsset');
  }

  /**
   * Returns the selected scriptable object if selection is a single scriptable
   * object.
   * @return {object|null} selected scriptable object.
   */
  getSelectedScriptableObject = () => {
    return this.project.selection.getSelectedObject().isScriptable
        && this.project.selection.getSelectedObject();
  }

  /**
   * Returns the number of objects selected on the canvas.
   * @return {number} Number of canvas objects selected.
   */
  getNumCanvasObjectsSelected = () => {
    return this.project.selection.numObjects;
  }

  /**
   * Sets the active layer
   * @param {number} index The index to set as active
   */
  setActiveLayerIndex = (index) => {
    this.project.activeTimeline.activeLayerIndex = index;
    this.projectDidChange({ actionName: "Set Active Layer" });
  }

  /**
   * Toggles layer hidden
   * @param {object} layer The layer to toggle
   */
  toggleHidden = (layer) => {
    layer.hidden = !layer.hidden;
    this.projectDidChange({ actionName: "Toggle Layer Hidden" });
  }

  /**
   * Toggles layer locked
   * @param {object} layer The layer to toggle
   */
  toggleLocked = (layer) => {
    layer.locked = !layer.locked;
    this.projectDidChange({ actionName: "Toggle Layer Locked" });
  }

  /**
   * Moves selection into target at index
   * @param {object} target The object to insert into
   * @param {number} index The index to insert at
   */
  moveSelection = (target, index) => {
    if (this.project.moveSelection(target, index)) {
      this.projectDidChange({ actionName: "Moved Selection" });
    }
  }

  /**
   * Adds the given object to the selection.
   * @param {object} object - The object to add to the selection.
   */
  selectObject = (object) => {
    this.project.selection.select(object);
    this.projectDidChange({ actionName: "Select Object" });
  }

  /**
   * Adds the given objects to the selection. No
   * changes will be made if the selection does not change.
   * @param {object[]} objects - The objects to add to the selection.
   */
  selectObjects = (objects) => {
    this.project.selection.selectMultipleObjects(objects);
    this.projectDidChange({ actionName: "Select Multiple Objects" });
  }

  /**
   * Removes the given objects from the selection. No
   * changes will be made if the selection does not change.
   * @param {object[]} objects - The objects to remove from the selection.
   */
  deselectObjects = (objects) => {
    objects.forEach(object => {
      this.project.selection.deselect(object);
    });
    this.projectDidChange({ actionName: "Deselect Multiple Objects" });
  }

  /**
   * Clears the selection.
   */
  clearSelection = () => {
    this.project.selection.clear();
    this.projectDidChange({ actionName: "Clear Selection" });
  }

  /**
   * Selects everything on the canvas.
   */
  selectAll = () => {
    this.project.selectAll();
    this.projectDidChange({ actionName: "Select All" });
  }

  /**
   * Returns the value of a requested selection attribute.
   * @param  {string} attributeName Selection attribute to retrieve.
   * @return {string|number|undefined} Value of the selection attribute to
   * retrieve. Returns undefined is attribute does not exist.
   */
  getSelectionAttribute = (attributeName) => {
    let attribute = this.project.selection[attributeName];

    if(attribute instanceof Array) {
      if(attribute.length === 0) {
        return undefined;
      } else if (attribute.length === 1) {
        return attribute[0];
      } else {
        // TODO: Should return info about "mixed" attributes, but just
        // return the attribute of the first object for now.
        return attribute[0];
      }
    } else {
      return attribute;
    }
  }

  /**
   * Returns the names of all possible selection attribute names.
   * @return {string[]} Array of selection attribute names.
   */
  getAllSelectionAttributeNames = () => {
    return this.project.selection.allAttributeNames;
  }

  /**
   * Returns the new selection Attributes.
   * @return {object} object with new attributes.
   */
  getAllSelectionAttributes = () => {
    let newAttributes = {};

    let selectionAttributeNames = this.getAllSelectionAttributeNames();

    selectionAttributeNames.forEach(name => {
      newAttributes[name] = this.getSelectionAttribute(name);
    });

    return newAttributes;
  }

  /**
   * Updates the value of a selection attribute for the selected item in the editor.
   * @param {string} attribute Name of the attribute to update.
   * @param {string|number} newValue  New value of the attribute to update.
   */
  setSelectionAttribute = (attribute, newValue) => {
    this.project.selection[attribute] = newValue;
    this.projectDidChange({ actionName: "Set Selection Attribute: " + attribute + ":" + newValue});
  }

  /**
   * Determines if a given object is selected.
   * @param {object} object - Selection object to check if it is selected
   * @returns {boolean} - True if the object is selected, false otherwise
   */
  isObjectSelected = (object) => {
    return this.project.selection.isObjectSelected(object);
  }

  /**
   * Creates a new clip from the selected paths and clips and adds it to the project.
   * @param {string} name The name of the clip after creation.
   * @param {boolean} wrapSingularClip If the selection is just one Clip, should it be wrapped within another Clip?
   *    Default is true, to preserve existing script behavior.
   *    Calling this function with false ensures user doesn't accidentally wrap a Clip within another Clip.
   */
  createClipFromSelection = (name, wrapSingularClip = true) => {
    if (this.project.selection.numObjects === 0) {
      console.log("No selection from which to create clips.");
      return;
    } else if (!wrapSingularClip && this.project.selection.numObjects === 1
    && this.project.selection.types[0] === "Clip") {
      console.log("That's already a Clip.");
      return;
    }
    this.project.createClipFromSelection({
      identifier: name,
      type: 'Clip'
    });
    this.projectDidChange({ actionName: "Create Clip From Selection" });
  }

  /**
   * Creates a new clip from the selected layers and adds it to the top layer.
   */
  createClipFromLayers = () => {
    this.project.createClipFromLayers();
    this.projectDidChange({ actionName: "Create Clip From Layers" });
  }

  /**
   * Moves the selected paths and clips to their own layers.
   */
  distributeSelectionToLayers = () => {
    this.project.distributeSelectionToLayers();
    this.projectDidChange({ actionName: "Distribute Selection To Layers" });
  }

  /**
   * Reverses the gradient of the gradient tool target.
   */
  reverseGradient = () => {
    var activeTool = this.getActiveTool();
    if (activeTool.name === 'gradienttool') {
      activeTool.reverseGradient();
      this.projectDidChange({ actionName: "Reverse Gradient" });
    }
  }

  /**
   * Deletes the selected color stop of the gradient tool.
   */
  deleteGradientStop = () => {
    var activeTool = this.getActiveTool();
    if (activeTool.name === 'gradienttool') {
      activeTool.deleteSelectedColorStop();
      this.projectDidChange({ actionName: "Delete Gradient Color Stop" });
    }
  }

  /**
   * Creates a new button from the selected paths and clips and adds it to the project.
   * @param {string} name The name of the button after creation.
   */
  createButtonFromSelection = (name) => {
    this.project.createClipFromSelection({
      identifier: name,
      type: 'Button'
    });
    this.projectDidChange({ actionName: "Create Button From Selection" });
  }

  /**
   * Updates the focus object of the project.
   * @param {Wick.Clip} object Object to set as focus.
   */
  setFocusObject = (object) => {
    this.project.focus = object;
    this.projectDidChange({ actionName: "Set Focus Object" });
  }

  /**
   * Break apart the selected clip(s) and select the objects that were contained within those clip(s).
   */
  breakApartSelection = () => {
    //only break apart selections that have at least 1 clip or button
    //it might be better for these checks to go wherever project.breakApartSelection is defined
    var sel = this.project.selection;
    if (sel.numObjects === 0 || (!sel.types.includes("Clip") && !sel.types.includes("Button"))) {
      return;
    }
    this.project.breakApartSelection();
    this.projectDidChange({ actionName: "Break Apart Selection"});
  }

  /**
   * Deletes all selected objects.
   * @returns {object[]} The objects that were deleted.
   */
  deleteSelectedObjects = () => {
    if(this.project.selection.location === 'AssetLibrary') {
      this.openWarningModal({
        description: "Any objects in the project using this asset will also be deleted.",
        title: "Delete this asset?",
        acceptAction: (() => {
          this.project.deleteSelectedObjects();
          this.projectDidChange({ actionName: "Delete Selected Asset" });
        }),
        cancelAction: (() => {}),
        finalAction: (() => {}),
        acceptText: "Delete",
        cancelText: "Cancel",
      });
    } else {
      this.project.deleteSelectedObjects();
      this.projectDidChange({actionName: "Delete Selected Objects"});
    }
  }

  /**
   * Deletes a sub script from a script object.
   * @param {Object} scriptOwner Script owner to remove sub script from
   * @param {string} scriptName Name of the script to remove
   */
  deleteScript = (scriptOwner, scriptName) => {
    let oldEditorState = this.state.codeEditorOpen;

    // Turn off code editor if necessary, then open warning modal.
    this.toggleCodeEditor(false);

    this.openWarningModal({
      description: 'Delete Script: "' + scriptName + '" from the object?',
      title: "Delete Script",
      acceptText: "Delete",
      cancelText: "Cancel",
      acceptAction: (() => scriptOwner.removeScript(scriptName)),
      finalAction: (() => this.toggleCodeEditor(oldEditorState)), // Reopen code editor if necessary.
    });

  }

  /**
   * Opens the code editor to the script name tab if that tab exists.
   * @param {string} scriptName Name of the script to open the tab of. Must be all lowercase.
   */
  editScript = (scriptName) => {
    this.setState({
      scriptToEdit: scriptName,
      codeEditorOpen: true,
    });
  }

  /**
   * Moves the selected objects on the canvas to the back.
   */
  sendSelectionToBack = () => {
    this.project.selection.sendToBack();
    this.projectDidChange({ actionName: "Send Selection to Back" });
  }

  /**
   * Moves the selected objects on the canvas to the front.
   */
  sendSelectionToFront = () => {
    this.project.selection.bringToFront();
    this.projectDidChange({ actionName: "Bring Selection to Front" });
  }

  /**
   * Moves the selected objects on the canvas backwards.
   */
  moveSelectionBackwards = () => {
    this.project.selection.moveBackwards();
    this.projectDidChange({ actionName: "Move Selection Backwards" });
  }

  /**
   * Moves the selected objects on the canvas forwards.
   */
  moveSelectionForwards = () => {
    this.project.selection.moveForwards();
    this.projectDidChange({ actionName: "Move Selection Forwards" });
  }

  /**
   * Horizontally flips the canvas selection.
   */
  flipSelectedHorizontal = () => {
    this.project.selection.flipHorizontally();
    this.projectDidChange({ actionName: "Flip Selection Horizontal" });
  }

  /**
   * Vertically flips the canvas selection.
   */
  flipSelectedVertical = () => {
    this.project.selection.flipVertically();
    this.projectDidChange({ actionName: "Flip Selection Vertical" });
  }

  nudgeSelection = (x, y) => {
    if (this.project.selection.numObjects === 0) return; // Ignore if no objects are selected.
    this.project.selection.x += x;
    this.project.selection.y += y;
    this.projectDidChange({ skipHistory: true, actionName: "Nudge Selection", skipReactRender: true});
  }

  /**
   * Moves the selected objects up 1 pixel.
   */
  nudgeSelectionUp = () => {
    this.nudgeSelection(0, -1);
  }

  /**
   * Moves the selected objects down 1 pixel.
   */
  nudgeSelectionDown = () => {
    this.nudgeSelection(0, 1);
  }

  /**
   * Moves the selected objects right 1 pixel.
   */
  nudgeSelectionRight = () => {
    this.nudgeSelection(1, 0);
  }

  /**
   * Moves the selected objects left 1 pixel.
   */
  nudgeSelectionLeft = () => {
    this.nudgeSelection(-1, 0);
  }

  /**
   * Moves the selected objects up 10 pixels.
   */
  nudgeSelectionUpMore = () => {
    this.nudgeSelection(0, -10);
  }

  /**
   * Moves the selected objects down 10 pixels.
   */
  nudgeSelectionDownMore = () => {
    this.nudgeSelection(0, 10);
  }

  /**
   * Moves the selected objects right 10 pixels.
   */
  nudgeSelectionRightMore = () => {
    this.nudgeSelection(10, 0);
  }

  /**
   * Moves the selected objects left 10 pixels.
   */
  nudgeSelectionLeftMore = () => {
    this.nudgeSelection(-10, 0);
  }

  /**
   * Finish the current nudging operation
   */
  finishNudgingObject = () => {
    this.projectDidChange({ actionName: "Nudge Elements" });
  }

  /**
   * Perform a boolean unite on the selected paths.
   */
  booleanUnite = () => {
    this.project.doBooleanOperationOnSelection('unite');
    this.projectDidChange({ actionName: "Boolean Unite" });
  }

  /**
   * Perform a boolean subtraction on the selected paths.
   */
  booleanSubtract = () => {
    this.project.doBooleanOperationOnSelection('subtract');
    this.projectDidChange({ actionName: "Boolean Subtract" });
  }

  /**
   * Perform a boolean intersection on the selected paths.
   */
  booleanIntersect = () => {
    this.project.doBooleanOperationOnSelection('intersect');
    this.projectDidChange({ actionName: "Boolean Intersect" });
  }

  /**
   * Updates the Wick Project settings with new values passed in as an object. Will make no changes if input is invalid or the same as the previous settings.
   * @param {object} newSettings an object containing all of the settings to update within the project. Accepts valid project settings such as 'name', 'width', 'height', 'framerate', and 'backgroundColor'.
   */
  updateProjectSettings = (newSettings) => {
    let validKeys = ["name", "width", "height", "backgroundColor", "framerate"];
    let updated = false;

    Object.keys(newSettings).forEach(key => {
      if (validKeys.indexOf(key) === -1) return;

      let oldVal = this.project[key];
      if (oldVal !== newSettings[key]) {
        this.project[key] = newSettings[key];
        updated = true;
      }
    });

    if (updated) {
      this.projectDidChange({ actionName: "Update Project Settings" });
    }
  }

  /**
   * Sets the project focus to the timeline of the currently selected clip.
   */
  focusTimelineOfSelectedObject = () => {
    this.project.focusTimelineOfSelectedClip();
    this.projectDidChange({ actionName: "Focus Selected Object Timeline" });
  }

  /**
   * Sets the project focus to the parent timeline of the currently selected clip.
   */
  focusTimelineOfParentClip = () => {
    this.project.focusTimelineOfParentClip();
    this.projectDidChange({ actionName: "Focus Timeline of Parent Clip" });
  }

  /**
   * Creates an image from an asset's uuid and places it on the canvas.
   * @param {string} uuid - The UUID of the desired asset.
   * @param {number} x - The x location of the image after creation in relation to the window.
   * @param {number} y - The y location of the image after creation in relation to the window.
   * @param {boolean} isCanvasSpace - If not set to true, x and y will be converted from screen space to canvas space
   */
  createImageFromAsset = (uuid, x, y, isCanvasSpace) => {
    // convert screen position to wick project position
    let paper = this.project.view.paper;
    let dropPoint = new paper.Point();
    if(isCanvasSpace) {
      dropPoint = new paper.Point(x,y);
    } else {
      let canvasPosition = paper.project.view.element.getBoundingClientRect();
      x -= canvasPosition.x;
      y -= canvasPosition.y;
      dropPoint = paper.view.viewToProject(new window.paper.Point(x,y));
    }

    let obj = window.Wick.ObjectCache.getObjectByUUID(uuid);

    if (obj instanceof window.Wick.ImageAsset) {
      this.project.createImagePathFromAsset(window.Wick.ObjectCache.getObjectByUUID(uuid), dropPoint.x, dropPoint.y, path => {
        this.projectDidChange({ actionName: "Create Image Path From Asset"});
      });
    } else if (obj instanceof window.Wick.ClipAsset) {
      this.project.createClipInstanceFromAsset(window.Wick.ObjectCache.getObjectByUUID(uuid), dropPoint.x, dropPoint.y, clip => {
        this.projectDidChange({ actionName: "Create Clip Instance From Asset"});
      });
    } else if (obj instanceof window.Wick.SVGAsset) {
      this.project.createSVGInstanceFromAsset(window.Wick.ObjectCache.getObjectByUUID(uuid), dropPoint.x, dropPoint.y, svg => {
        this.projectDidChange({ actionName: "Create SVG Instance From Asset"});
      });
    } else {
      console.error('object is not an ImageAsset or a ClipAsset')
    }
  }

 /**
  * Creates an instance of the selected asset at the center of the canvas
  */
  createInstanceOfSelectedAsset = () => {
    let uuid = this.project.selection.getSelectedObject().uuid;
    this.createImageFromAsset(uuid, this.project.width/2, this.project.height/2, true);
  }

 /**
   * Is called when a sound asset is dragged/dropped on the timeline element.
   * @param {string} uuid - The UUID of the desired asset.
   * @param {number} x - The x location of the image after creation in relation to the window.
   * @param {number} y - The y location of the image after creation in relation to the window.
   * @param {boolean} drop - If true, will drop the asset with the uuid onto the hovered frame, modifying the frame.
   */
  dragSoundOntoTimeline = (uuid, x, y, drop) => {
      this.project.guiElement.dragAssetAtPosition(uuid, x, y, drop);
  }

  addSoundToActiveFrame = (soundAsset) => {
    let frame = this.project.activeFrame;
    if (frame !== null) {
      frame.sound = soundAsset;
      this.projectDidChange({ actionName: "Add Sound to Active Frame" });
    }
    else {
      this.toast('No active frame to add sound to.', 'error');
    }
  }

  /**
   * Attempts to import an arbitrary asset to the project. Displays an error or success message
   * depending on if the action was successful.
   * @param {File} file - File object to create an asset of.
   * @param {Function} callback - (optional) Callback to return asset to. If the import was unsuccessful, null is sent to the callback.
   */
  importFileAsAsset = (file, callback) => {
    this.project.importFile(file, (asset) => {
      if (callback) callback(asset);

      if(asset === null) {
        this.toast('Could not add files to project: ' + file.name, 'error');
      } else {
        this.toast(`Imported ${file.name || "project"} successfully.`);
        this.projectDidChange({ actionName: "Import File As Asset" });
      }
    });
  }

  /**
   * Adds fetched file to builtinPreviews
   * @param {string} filename - name of file
   * @param {File} file - file to add
   */
  addFileToBuiltinPreviews = (filename, file) => {
    this.builtinPreviews[filename] = {blob: file};

    let reader = new FileReader();

    reader.onload = () => {
      let dataURL = reader.result;
      this.builtinPreviews[filename].src = dataURL;

      this.projectDidChange({ skipHistory: true, actionName: "Import File To Builtin Previews"});
    }
    
    reader.readAsDataURL(file);
  }

  /**
   * Checks if an asset with filename filename exists
   * @param {string} filename - name of file
   */
  isAssetInLibrary = (filename) => {
    let assets = this.project.getAssets();
    for (let i = 0; i < assets.length; i++) {
      if (assets[i].filename === filename) {
        return true;
      }
    }
    return false;
  }

  /**
   * Creates and imports Wick Assets from the acceptedFiles list, and displays an alert message for rejected files.
   * @param {File[]} acceptedFiles - Files uploaded by user with supported MIME types to import into the project
   * @param {File[]} rejectedFiles - Files uploaded by user with unsupported MIME types.
   * @param {object} options - optional flags. Can include "create", which if true will create an instance of the object on the canvas.
   */
  createAssets = (acceptedFiles, rejectedFiles, options) => {
    if (!options) options = {};

    let toastID = this.toast('Importing files...', 'info');

    // Error message for failed uploads
    if (rejectedFiles.length > 0) {
      let fileNamesRejected = rejectedFiles.map(file => file.name).join(', ');
      this.updateToast(toastID, {
        type: 'error',
        text: 'Could not import files: ' + fileNamesRejected});
    }

    let createCallback = (asset) => {
      if (options.create) this.createImageFromAsset(asset.uuid, options.location.x || 0, options.location.y || 0);
    }

    // Add all successfully uploaded assets
    for(var i = 0; i < acceptedFiles.length; i++) {
      if(acceptedFiles[i].type === 'image/gif') {
        GIFImport.importGIFIntoProject({
            gifFile: acceptedFiles[i],
            project: this.project,
            onProgress: (percent) => {
                console.log('GIFImport onProgress: ' + percent);
            },
            onFinish: (gifAsset) => {
                this.project.addAsset(gifAsset);
                this.projectDidChange({ actionName: "Add Asset" });
                if (options.create) this.createImageFromAsset(gifAsset.uuid, options.location.x || 0, options.location.y || 0);
            }});
      } else {
        var file = acceptedFiles[i];

        this.importFileAsAsset(file, createCallback);
      }
    }
  }

  /**
   * Begin interactive object creation process.
   */
  beginMakeInteractiveProcess = () => {
    this.openModal("MakeInteractive");
  }

  /**
   * Begin animated object creation process.
   */
  beginMakeAnimatedProcess = () => {
    this.openModal("MakeAnimated");
  }

  /**
   * Export the current project to a new window.
   */
  exportProjectToNewWindow = () => {
    this.showWaitOverlay();
    window.Wick.HTMLPreview.previewProject(this.project, previewWindow => {
      this.hideWaitOverlay();
      if (previewWindow) {
        this.toast('Project preview window opened.', 'info', {autoClose: false});
      } else {
        // If pop ups are disabled, previewWindow will be null.
        this.toast('Could not open a preview window. Try disabling your popup blocker!', 'error', {autoClose: false});
      }
    });
  }

  /**
   * Export the current project as a Wick File using the save as dialog.
   */
  exportProjectAsWickFile = () => {
    this.showWaitOverlay();

    let toastID = this.toast('Exporting project as a .wick file...', 'info', {autoClose: false});
    
    window.Wick.WickFile.toWickFile(this.project, file => {
      if (file === undefined) {
        this.updateToast(toastID, {
          type: 'error',
          text: "Could not export .wick file." });
        this.hideWaitOverlay();
        return;
      }

      let success = () => {
        this.updateToast(toastID, {
          type: 'success',
          text: "Successfully saved .wick file." });
      }

      let fail = () => {
        this.updateToast(toastID, {
          type: 'error',
          text: "Error saving .wick file. Please try again." });
      }

      file = new Blob([file], {type: 'application/wick'});
      window.saveFileFromWick(file, this.project.name, '.wick', success, fail);

      this.hideWaitOverlay();
    });
  }

  /**
   * Serialize the current project to .wick bytes and compile them to a .swf Blob.
   * The one compile path both SWF entry points share: previewProjectAsSWF plays the
   * result in Ruffle, exportProjectAsSWF writes it to disk. See compileWickToSWF for
   * the Tauri-vs-bridge split.
   * @returns {Promise<Blob>} resolves to the .swf, rejects with a reportable Error.
   */
  compileProjectToSWFBlob = () => {
    return new Promise((resolve, reject) => {
      window.Wick.WickFile.toWickFile(this.project, file => {
        if (file === undefined) {
          reject(new Error("could not serialize project."));
          return;
        }
        this.wickFileToBytes(file)
          .then(wickBytes => this.compileWickToSWF(wickBytes))
          .then(resolve, reject);
      });
    });
  }

  /**
   * Compile the project to SWF and PREVIEW it in the in-app Ruffle player. Nothing
   * touches the filesystem — the .swf lives in an object URL for the SwfPreview modal.
   * To write a file instead, see exportProjectAsSWF.
   */
  previewProjectAsSWF = () => {
    this.showWaitOverlay();
    let toastID = this.toast('Compiling project to SWF...', 'info', {autoClose: false});

    this.compileProjectToSWFBlob()
      .then(swfBlob => {
        if (this.state.swfPreviewUrl) window.URL.revokeObjectURL(this.state.swfPreviewUrl);
        let swfUrl = window.URL.createObjectURL(swfBlob);
        this.updateToast(toastID, {type: 'success', text: "Compiled to SWF."});
        this.setState({swfPreviewUrl: swfUrl});
        this.openModal('SwfPreview');
        this.hideWaitOverlay();
      })
      .catch(err => {
        this.updateToast(toastID, {
          type: 'error',
          text: "SWF compile failed: " + (err && err.message ? err.message : err)});
        this.hideWaitOverlay();
      });
  }

  /**
   * Compile the project to SWF and SAVE it as a .swf file, via the same
   * window.saveFileFromWick handler every other export uses (so a platform that
   * overrides it — the Tauri shell, eventually — gets a native dialog for free).
   * To play it in-app instead, see previewProjectAsSWF.
   * @param {object} args - {name} output filename, defaults to the project name.
   */
  exportProjectAsSWF = (args) => {
    args = args || {};
    let outputName = args.name || this.project.name;
    this.showWaitOverlay();
    let toastID = this.toast('Exporting SWF...', 'info', {autoClose: false});

    this.compileProjectToSWFBlob()
      .then(swfBlob => {
        let success = () => {
          this.updateToast(toastID, {type: 'success', text: "Exported SWF."});
          this.hideWaitOverlay();
        };
        let fail = () => {
          this.updateToast(toastID, {type: 'error', text: "Could not save the SWF."});
          this.hideWaitOverlay();
        };
        window.saveFileFromWick(swfBlob, outputName, '.swf', success, fail);
      })
      .catch(err => {
        this.updateToast(toastID, {
          type: 'error',
          text: "SWF export failed: " + (err && err.message ? err.message : err)});
        this.hideWaitOverlay();
      });
  }

  /**
   * Normalize whatever WickFile.toWickFile hands back to a Uint8Array. It defaults to
   * a Blob; new Uint8Array(blob) does NOT read a Blob's bytes (yields an empty array),
   * so a Blob must go through .arrayBuffer() first.
   */
  wickFileToBytes = (file) => {
    if (file instanceof Uint8Array) return Promise.resolve(file);
    if (file instanceof ArrayBuffer) return Promise.resolve(new Uint8Array(file));
    if (file instanceof Blob) return file.arrayBuffer().then(buf => new Uint8Array(buf));
    return Promise.resolve(Uint8Array.from(file));
  }

  /**
   * The in-page compiler (wasm), instantiated once and reused.
   *
   * Lazy on purpose: it is the largest single asset the editor can load, and the great
   * majority of a session never presses export. Kept as a promise rather than the module so
   * two exports in flight at once share one instantiation. A rejection is cached too — if
   * the package is not built, that fact will not change while the page is open, and each
   * subsequent export should fall through to the bridge without re-importing to find out.
   */
  twipWasm = null;

  loadTwipWasm = () => {
    if (!this.twipWasm) {
      this.twipWasm = import('virtual:twip-wasm').then(mod => {
        if (!mod.available) throw new Error('twip wasm not built');
        return mod.init().then(() => mod.compile_wick);
      });
    }
    return this.twipWasm;
  }

  /**
   * Compile .wick bytes (Uint8Array) to a .swf Blob, by whichever of three routes exists.
   *
   * Under the Tauri desktop shell it is an in-process Rust call (the compile_swf command).
   * In a browser it is the same compiler as wasm, running in the tab. Failing that — a
   * checkout that never ran `pnpm wasm` — it POSTs to dev/twip_bridge.py on :8752.
   *
   * The fallback fires only when the wasm module could not be loaded or instantiated. A
   * compile *error* from a loaded module is the compiler's real answer about this document
   * and propagates; asking the bridge would only produce the same message a second time.
   */
  compileWickToSWF = (wickBytes) => {
    const upsample = this.swfUpsampleEnabled();

    if (window.__TAURI__ && window.__TAURI__.core) {
      return window.__TAURI__.core.invoke('compile_swf', {wick: Array.from(wickBytes), upsample})
        .then(swf => new Blob(
          [swf instanceof ArrayBuffer ? swf : new Uint8Array(swf)],
          {type: 'application/x-shockwave-flash'}));
    }

    return this.loadTwipWasm().then(
      compile => new Blob([compile(wickBytes, upsample)], {type: 'application/x-shockwave-flash'}),
      () => this.compileWickViaBridge(wickBytes, upsample));
  }

  /**
   * Whether the compiler should resample each document frame up toward 60fps on export.
   *
   * On unless told otherwise. It is what lets a project drawn at 12 play back smoothly, and
   * it is the reason to draw at 12 at all, so the default is the whole point. It is off for
   * anyone whose frame numbers have to line up with something outside twip — a golden render,
   * an external tool counting frames — or who wants the coarse look kept.
   *
   * Set `localStorage['twip:upsample'] = 'off'` (or 'on'), matching the `twip:leave-warning`
   * escape hatch in Editor.jsx. Not a project property on purpose: it decides how this
   * document is exported, not what the document is, and writing it into project.json would
   * invent a field the upstream Wick editor does not know how to read.
   */
  swfUpsampleEnabled = () => {
    return window.localStorage.getItem('twip:upsample') !== 'off';
  }

  /**
   * The pre-wasm route: hand the bytes to a local server running the twip binary.
   */
  compileWickViaBridge = (wickBytes, upsample) => {
    const url = 'http://localhost:8752/compile' + (upsample === false ? '?upsample=off' : '');
    return fetch(url, {method: 'POST', body: new Blob([wickBytes])})
      .then(res => {
        if (!res.ok) return res.text().then(t => { throw new Error(t || ('HTTP ' + res.status)); });
        return res.blob();
      })
      .catch(err => {
        if (err instanceof TypeError) {
          throw new Error("no twip compiler available — build the in-page one with `pnpm wasm`, "
            + "or start the dev bridge (dev/twip_bridge.py on :8752)");
        }
        throw err;
      });
  }

  /**
   * Export the current project as an animated GIF.
   */
  exportProjectAsAnimatedGIF = (args) => {
    // Open export media loading bar modal.
    this.openModal('ExportMedia');
    this.setState({
      renderProgress: 0,
      renderType: "gif",
      renderStatusMessage: "Creating gif.",
    });

    // this.showWaitOverlay();
    let outputName = args.name || this.project.name;
    let toastID = this.toast('Exporting animated GIF...', 'info');

    let onProgress = (message, progress) => {
      this.setState({
        renderStatusMessage: message,
        renderProgress: progress
      });
    }

    let onError = (message) => {
      console.error("Gif Render had an error with message: ", message);
    }

    let onFinish = (gifBlob) => {

      let success = () => {
        this.updateToast(toastID, {
          type: 'success',
          text: "Successfully saved .gif file." });
      }

      let fail = () => {
        this.updateToast(toastID, {
          type: 'error',
          text: "Error saving .gif file. Please try again." });
      }

      window.saveFileFromWick(gifBlob, outputName, '.gif', success, fail);

      this.setState({
        renderStatusMessage: 'Finished creating GIF.',
        renderProgress: 100
      });
    }

    GIFExport.createAnimatedGIFFromProject({
      width: args.width,
      height: args.height,
      project: this.project,
      onFinish: onFinish,
      onError: onError,
      onProgress: onProgress,
    });

  }

  /**
   * Export the current project as an image sequence
   */
  exportProjectAsImageSequence = (args) => {
    this.openModal('ExportMedia');
    this.setState({
      renderProgress: 0,
      renderType: "image sequence",
      renderStatusMessage: "Creating image sequence.",
      exporting: true,
    });

    let toastID = this.toast('Exporting image sequence...', 'info');

    let onProgress = (completed, maxFrames) => {
      let message = "Rendered " + completed + "/" + maxFrames + " frames";
      let percentage = 10 + (90 * (completed/maxFrames));
      this.setState({
        renderStatusMessage: message,
        renderProgress: percentage,
      });
    }

    let onError = (message) => {
      console.error("Image Render had an error with message: ", message);
    }

    let onFinish = (sequenceBlobZip) => {

      let success = () => {
        this.updateToast(toastID, {
          type: 'success',
          text: "Successfully saved image sequence." });
      }

      let fail = () => {
        this.updateToast(toastID, {
          type: 'error',
          text: "Error saving image sequence. Please try again." });
      }

      window.saveFileFromWick(sequenceBlobZip, this.project.name+'_imageSequence', '.zip', success, fail);

      this.setState({
        exporting: false,
      })
    }

    window.Wick.ImageSequence.toPNGSequence({
      project: this.project,
      width: args.width,
      height: args.height,
      onProgress: onProgress,
      onError: () => {
        this.hideWaitOverlay();
        onError();
      },
      onFinish: (file) => {
        this.hideWaitOverlay();
        onFinish(file);
      },
    });
  }

  /**
   * Export the current project as a video.
   */
  exportProjectAsVideo = (args) => {
    // Open export media loading bar modal.
    this.openModal('ExportMedia');
    this.setState({
      renderProgress: 10,
      renderType: "video",
      renderStatusMessage: "Creating video.",
      exporting: true,
    });

    let toastID = this.toast('Exporting video...', 'info');

    let onProgress = (message, progress) => {
      this.setState({
        renderStatusMessage: message,
        renderProgress: progress
      });
    }

    let onError = (message) => {
      console.error("Video Render had an error with message: ", message);
    }

    let onFinish = (message) => {
      this.updateToast(toastID, {
        type: 'success',
        text: "Successfully created .mp4 file." });
      console.log("Video Render Complete: ", message);

      this.setState({
        exporting: false,
      });
    }

    // this.showWaitOverlay('Rendering video...');
    VideoExport.renderVideo({
      project: this.project,
      width: args.width,
      height: args.height,
      onProgress: onProgress,
      onError: () => {
        this.hideWaitOverlay();
        onError();
      },
      onFinish: () => {
        this.hideWaitOverlay();
        onFinish();
      },
    });
  }
    /**
   * Export the current project as a video.
   */

  exportProjectAsImageSVG = () => {
    // Open export media loading bar modal.
    this.openModal('ExportMedia');
    this.setState({
      renderProgress: 0,
      renderType: "svg",
      renderStatusMessage: "Creating svg.",
    });

    let toastID = this.toast('Exporting svg...', 'info');

    let onError = (message) => {
      console.error("SVG builder had an error with message: ", message);
    }

    let onFinish = (file) => {
      

      let success = () => {
        this.updateToast(toastID, {
          type: 'success',
          text: "Successfully saved .svg file." });
      }

      let fail = () => {
        this.updateToast(toastID, {
          type: 'error',
          text: "Error saving .svg file. Please try again." });
      }

      window.saveFileFromWick(file, this.project.name, '.svg', success, fail);

      this.hideWaitOverlay();
    }

    // this.showWaitOverlay('Rendering video...');
    window.Wick.SVGFile.toSVGFile(this.project.activeTimeline,
       onError,file => {
        this.hideWaitOverlay();
        onFinish(file);
      });
  }

  /**
   * Export the current project as a bundled standalone ZIP that can be uploaded to itch/newgrounds/etc.
   */
  exportProjectAsStandaloneZip = (args) => {
    let toastID = this.toast('Exporting project as ZIP...', 'info');
    let outputName = args.name || this.project.name;
    window.Wick.ZIPExport.bundleProject(this.project, blob => {
      let success = () => {
        this.updateToast(toastID, {
          type: 'success',
          text: "Successfully saved .zip file." });
      }

      let fail = () => {
        this.updateToast(toastID, {
          type: 'error',
          text: "Error saving .zip file. Please try again." });
      }

      window.saveFileFromWick(blob, outputName, '.zip', success, fail);

    });
  }

  /**
   * Export the current project as a bundled standalone HTML file.
   */
  exportProjectAsStandaloneHTML = (args) => {
    let toastID = this.toast('Exporting project as HTML...', 'info');
    let outputName = args.name || this.project.name;
    window.Wick.HTMLExport.bundleProject(this.project, html => {
      let file = new Blob([html], {type: 'text/html'});

      let success = () => {
        this.updateToast(toastID, {
          type: 'success',
          text: "Successfully saved .html file." });
      }

      let fail = () => {
        this.updateToast(toastID, {
          type: 'error',
          text: "Error saving .html file. Please try again." });
      }

      window.saveFileFromWick(file, outputName, '.html', success, fail);
      
    });
  }

  /**
   * Exports the audio of a Wick project's audio as a single track in an audio file.
   */
  exportProjectAsAudioTrack = (args) => {
    AudioExport.generateAudioFile({
      project: this.project,
    }).then((result) => {
      window.saveFileFromWick(new Blob([result]), 'audiotrack', '.wav');
    });
  }

  /**
   * Imports a wick file into the editor.
   * @param {File} file Zipped wick file to import.
   */
  importProjectAsWickFile = (file) => {
    this.showWaitOverlay();
    window.Wick.WickFile.fromWickFile(file, project => {
      if(project) {
        this.setupNewProject(project);
        this.toast(`Opened ${file.name || "project"} successfully.`, 'success');
      } else {
        this.toast('Could not open project.', 'error');
        this.hideWaitOverlay();
      }
    });
  }

  /**
   * Sets up a new project in the editor. This operation will remove the
   * history, selection, and all other ability to retrieve your project.
   * @param {Wick.Project} project - the project to load.
   */
  /**
   * A blank project, at the framerate twip wants people to start from.
   *
   * Not done by changing the engine's constructor default (12, engine/src/base/Project.js:39),
   * because that value does double duty: it is also what a .wick with no framerate field falls
   * back to, so moving it would re-time documents that already exist rather than only changing
   * what new ones start at. The compiler keeps the same 12 fallback for the same reason
   * (src/wick.rs). This is the authoring default, which is a different question.
   *
   * 12 is what hand-drawn work wants: it was Flash's own default, it is a fifth of the
   * drawing, and a cel held for five refreshes is not choppy — it is the flipbook look the
   * whole thing is for. What used to make 12 a bad default was that the export played back at
   * 12 too, and this went through 24 and then 30 chasing that. The compiler upsamples now, so
   * a 12fps document exports as a 60fps movie whose every fifth frame is the one the author
   * drew, and the tweens between them are resampled rather than repeated. 12 gets the
   * flipbook and the smooth playback at once, which is why it can be the default again.
   *
   * Whole multiples only, so what a rate divides into 60 matters more than its size. 12, 15,
   * 20, 30 and 60 land on it exactly; 24 goes to 48, needs 1.2495 refreshes per frame at the
   * 59.94Hz nearly every viewer runs, and keeps the doubled edge that sent this to 30 in the
   * first place. 24 is still the rate to avoid.
   *
   * The one place this shows is the editor canvas, which ticks at the document rate and so
   * previews at 12 what exports at 60. The preview is coarser than the result, not the other
   * way round, which is the direction to be wrong in.
   */
  newProject = () => {
    let project = new window.Wick.Project();
    project.framerate = 12;
    return project;
  }

  setupNewProject = (project) => {
    /*
     * Called with nothing on purpose by "New Project", which is what the blank fallback
     * below is for. Callers that are LOADING a document must check for null themselves
     * before getting here: handing this a failed load produces an empty canvas that is
     * indistinguishable from a successful load of an empty project, which is what "I
     * clicked Load and nothing happened" turned out to be. A `if (!project) return;` here
     * sat commented out for years, which suppressed the symptom in both directions.
     */
    this.resetEditorForLoad();
    this.project = project || this.newProject();
    this.project.selection.clear();

    // Attach error handling messages
    this.attachErrorHandlers();

    this.projectDidChange({ actionName: "Setup New Project" });
    this.hideWaitOverlay();

    this.project.prepareProjectForEditor();
  }

  openNewProjectConfirmation = () => {
    this.openWarningModal({
      description: "You will lose any unsaved changes.",
      title: "Create New Project?",
      acceptAction: (() => {
        setTimeout(() => {
          this.setupNewProject();
        }, 100)
      }),
      cancelAction: (() => {}),
      finalAction: (() => {

      }),
      acceptText: "Create",
      acceptIcon: "create",
      cancelText: "Cancel",
      cancelIcon: "cancel-white"
    });
  }

  showAutosavedProjects = () => {
    this.doesAutoSavedProjectExist(exists => {
      if (exists) {
        this.queueModal('AutosaveWarning');
      }
    });
  }

/**
   * Attempts to parse a url passed to the editor.
   * 
   * if a url is passed to with the 'project' parameter, the editor will attempt to oad that project over https.
   * if a example file name is passed with the 'example' parameter, the editor will attempt to load the example locally.
   * 
   * If the projects are not served over https, or do not exist, an error will be thrown.
   * 
   * the example parameter takes precedence.
   */
  tryToParseProjectURL = () => {
    var urlParams = queryString.parse(window.location.search);

  
    let loadProjectFromURL = (url) => {
      // Download and open the wick project.
      fetch(url)
        .then(resp => resp.blob())
        .then(blob => {
          window.Wick.WickFile.fromWickFile(blob, loadedProject => {
            // fromWickFile hands back nothing for a file it cannot read, and
            // setupNewProject would turn that into a blank canvas that looks like a
            // successful load of an empty project.
            if (!loadedProject) {
              this.toast('Could not open that project — the file is not readable as a .wick.', 'error');
              return;
            }
            this.setupNewProject(loadedProject);
          }, 'blob');
        })
        .catch((e) => {
          this.toast('Could not download project from URL.','warning');
          console.error('tryToParseProjectURL: Could not download Wick project.')
          console.error(e);
        });; 
    }


    if (urlParams.example) {
      let url = window.location.origin + '/examples/' + urlParams.example;
      console.log('attempting to load project', url);
      loadProjectFromURL(url);
      return;
    }

    var projectLink = urlParams.project;

    // No URL param, skip the download
    if(!projectLink) {
      return false;
    }

    if (!projectLink.startsWith('http')) {
      projectLink='https://' + projectLink;
    }

    try {
      // Parse requested URL
      var url = new URL(projectLink);
    } catch {
      this.toast("Project URL is invalid!", 'warning');
      return false;
    }

    // Check if the provided URL is allowed in the whitelist.
    var whitelist = ['wickeditor.com', 'editor.wickeditor.com', 'test.wickeditor.com', 'aka.ms'];

    if(whitelist.indexOf(url.hostname) === -1) {
      this.toast('Could not open project from link! \n URL is not on whitelist.','warning');
      console.error('tryToParseProjectURL: URL is not in the whitelist.');
      return false;
    }

    loadProjectFromURL(url);

    return true;
  }

  /**
   * Attach toast messages to the engine error handler.
   */
  attachErrorHandlers = () => {
    // Release any messages we may have had while loading the project.
    if (this.project && this.project._internalErrorMessages) {
      let errors = this.project._internalErrorMessages.concat([]);
      for (let error of errors) {
        this.toast(error, 'error', {autoClose: false}); // Show all errors that occurred while loading the project.
      }
    }

    this.project.onError(message => {
      if(message === 'OUT_OF_BOUNDS' || message === 'LEAKY_HOLE') {
        this.toast('The shape you are trying to fill has a gap.', 'warning');
      } else if (message === 'FILL_EQUALS_HOLE') {
        this.toast("Error: Can't fill the same color.", 'warning');
      } else if (message === 'LOOPING') {
        this.toast('Fill bucket failed. Error: Looping. Try Again?', 'warning');
      } else if (message === 'NO_VALID_CROSSINGS') {
        this.toast('Fill bucket failed. Overlapping shape above?', 'warning');
      } else if (message === 'TOO_COMPLEX') {
        this.toast('Shape is too complex.', 'warning');
      } else if (message === 'NO_PATHS') {
        this.toast('There is no hole to fill.', 'warning');
      } else if (message === 'CLICK_NOT_ALLOWED_LAYER_LOCKED') {
        this.toast('The layer you are trying to draw onto is locked.', 'warning');
      } else if (message === 'CLICK_NOT_ALLOWED_LAYER_HIDDEN') {
        this.toast('The layer you are trying to draw onto is hidden.', 'warning');
      } else if (message === 'CLICK_NOT_ALLOWED_NO_FRAME') {
        this.toast('There is no frame to draw onto.', 'warning');
      } else {
        this.toast(message, 'warning');
      }
    });
  }

  /**
   * Attempts to autosave if enough time has passed since the last autosave.
   */
  requestAutosave = () => {
    let now = Date.now();
    let last = this._lastAutosave;
    let timeSince = now - last;

    // Only autosave every 15 seconds.
    if (timeSince > 15000) {
      this.autoSaveProject(() => {
        this._lastAutosave = Date.now();
      });
    }
  }

  /**
   * Save the current project in localstorage
   */
  autoSaveProject = (callback) => {
    if (!this.project) return;
    if (this.state.previewPlaying) return;
    if (this.state.activeModalName !== null) return;
    /*
     * An empty project is not worth a slot. Startup calls projectDidChange for the blank
     * canvas it hands you, `_lastAutosave` begins at 0 so the very first request writes
     * immediately, and the result is one blank autosave per launch, each newer than the
     * work it buries. This is the half of the restore bug that produces the junk; pinning
     * the offered uuid below is the half that stops the junk being loaded.
     */
    if (!this.projectHasContent(this.project)) return;

    window.Wick.AutoSave.save(this.project, () => {
      callback();
    });
  }

  /**
   * Attempts to automatically load an autosaved project if it exists.
   * Does nothing if not autosaved project is stored.
   */
  loadAutosavedProject = (callback) => {
    this.resolveOfferedAutosave(uuid => {
      if(!uuid) {
        callback();
      } else {
        this.showWaitOverlay();
        window.Wick.AutoSave.load(uuid, project => {
          // setupNewProject falls back to `new Wick.Project()` when handed nothing, so a
          // failed load is otherwise indistinguishable from a blank canvas — say so
          // rather than let it look like the click did nothing.
          if (!project) {
            this.hideWaitOverlay();
            this.toast('Could not restore the autosave — its data is missing or unreadable.', 'error');
            callback();
            return;
          }
          this.setupNewProject(project);
          this.hideWaitOverlay();
          this._offeredAutosaveUUID = null;
          callback();
        });
      }
    });
  }

  /**
   * The autosave the prompt on screen is about.
   *
   * Not `autosaveList[0]` read a second time, which is what this used to be and is where
   * the restore bug lived. The prompt and the click are seconds apart, and the list is
   * mutable in between: startup autosaves the blank canvas it hands you, that write lands
   * with a newer `lastModified` than the work being offered, and the click then restores
   * the blank one. The load succeeds, the project is real, the canvas is empty, and
   * nothing anywhere reports a failure — which is exactly how it looked.
   *
   * `doesAutoSavedProjectExist` pins the uuid it validated. The list read here is only for
   * a caller that reached this without a prompt.
   */
  resolveOfferedAutosave = (callback) => {
    if (this._offeredAutosaveUUID) {
      callback(this._offeredAutosaveUUID);
      return;
    }
    window.Wick.AutoSave.getAutosavesList(autosaveList => {
      callback(autosaveList[0] && autosaveList[0].uuid);
    });
  }

  /**
   * The uuid `doesAutoSavedProjectExist` last found worth offering, or null.
   */
  _offeredAutosaveUUID = null;

  /**
   * Does this autosave hold anything worth offering to restore?
   *
   * An untouched project still serializes to a skeleton — Selection, the root Clip, and
   * that clip's Timeline/Layer/Frame (five objects; `Project` is listed below too, since
   * `ObjectCache.getActiveObjects` excludes it today but guarding costs nothing) — so a
   * non-empty `objectsData` proves nothing on its own. What
   * separates work from a blank canvas is the presence of objects that only exist once
   * someone has drawn, imported, or tweened. Deliberately strict: anything unrecognized
   * counts as content, because wrongly suppressing the prompt loses someone's work while
   * wrongly showing it costs one click.
   * @param {Object} autosaveData
   * @returns {boolean}
   */
  autosaveHasContent = (autosaveData) => {
    if (!autosaveData || !autosaveData.objectsData) return false;
    return this.classnamesHaveContent(autosaveData.objectsData.map(object => object.classname));
  }

  /**
   * The same question asked of a live project, so nothing writes a blank autosave in the
   * first place. `getChildrenRecursive` is what `ObjectCache.getActiveObjects` walks, so
   * this sees the object list the autosave would have serialized.
   * @param {Wick.Project} project
   * @returns {boolean}
   */
  projectHasContent = (project) => {
    if (!project) return false;
    return this.classnamesHaveContent(project.getChildrenRecursive().map(o => o.classname));
  }

  /**
   * Whether a list of serialized classnames is more than an untouched project's skeleton.
   */
  classnamesHaveContent = (classnames) => {
    let skeleton = ['Project', 'Selection', 'Clip', 'Timeline', 'Layer', 'Frame'];
    // Anything not part of the empty-project skeleton is the user's.
    if (classnames.some(name => skeleton.indexOf(name) === -1)) return true;
    // More than one of any skeleton part means a second layer, frame, or nested clip.
    return skeleton.some(part => classnames.filter(name => name === part).length > 1);
  }

  /**
   * Check whether there is an autosave worth restoring.
   *
   * Was `autosaveList.length > 0`, which prompted on every launch: the editor autosaves
   * the blank project it hands you at startup, so an untouched session writes an empty
   * autosave that the next launch then offers to restore. Answering the prompt appeared
   * to do nothing because there was genuinely nothing in it.
   *
   * Then it checked only `autosaveList[0]`, which is the same assumption from the other
   * side: a blank sitting at the head of the list hid every piece of real work under it,
   * and one blank per launch is exactly what the old `autoSaveProject` wrote. Nothing
   * autosaves a blank now, but the lists that already collected them still exist, so this
   * walks down until it finds work rather than judging the newest entry alone.
   *
   * Sorted newest-first, deduplicated because the engine appends a fresh list entry on
   * every save of the same project.
   * @param  {Function} callback a callback which receives a boolean.
   */
  doesAutoSavedProjectExist = (callback) => {
    window.Wick.AutoSave.getAutosavesList(autosaveList => {
      let seen = new Set();
      let queue = autosaveList.map(item => item.uuid).filter(uuid => {
        if (!uuid || seen.has(uuid)) return false;
        seen.add(uuid);
        return true;
      });

      let step = () => {
        let uuid = queue.shift();
        if (!uuid) {
          this._offeredAutosaveUUID = null;
          callback(false);
          return;
        }
        window.Wick.AutoSave.readAutosaveData(uuid, autosaveData => {
          if (!this.autosaveHasContent(autosaveData)) {
            step();
            return;
          }
          // Pin what the prompt is about. Load and Delete act on this uuid rather than on
          // whatever heads the list by the time they run.
          this._offeredAutosaveUUID = uuid;
          callback(true);
        });
      };
      step();
    });
  }

  /**
   * Clears the autosaved project that the prompt is offering.
   *
   * Was `AutoSave.delete(this.project.uuid)` — the uuid of the project currently OPEN,
   * never the autosaved one, so Delete removed nothing and the prompt returned forever.
   * Deletes the offered autosave only, not the whole list: the others are someone's work
   * too, even though only the newest is ever reachable. `removeAutosaveFromList` filters
   * by uuid, so this also clears the duplicate list entries the engine appends on every
   * save of the same project.
   */
  clearAutoSavedProject = (callback) => {
    this.resolveOfferedAutosave(uuid => {
      if (!uuid) {
        callback();
        return;
      }
      window.Wick.AutoSave.delete(uuid, () => {
        this._offeredAutosaveUUID = null;
        callback();
      });
    });
  }

  /**
   * Toggle onion skinning on/off.
   */
  toggleOnionSkin = () => {
    this.project.onionSkinEnabled = !this.project.onionSkinEnabled;
    this.projectDidChange({ actionName: "Toggle Onion Skinning" });
  }

  /**
   * Whether moving something writes a keyframe at the playhead.
   *
   * Off until asked for, which is the one place this departs from docs/ui-research.md's
   * "auto-key by default". At frame 1 of an empty document every drag is composition, not
   * animation, and auto-key's first key is also what wraps loose paths into a clip — so
   * on-by-default means the first time anyone nudges a shape they have silently made a
   * symbol and started an animation they did not ask for. The research is right that the
   * *gesture* should be dragging rather than F6; a mode is what makes dragging safe to
   * overload. Turning it on is one click and it stays on across sessions.
   *
   * Held in localStorage rather than in the project for the reason the engine's static
   * accessor gives: it describes how you are working, not what you drew.
   */
  autoKeyEnabled = () => {
    return window.localStorage.getItem('twip:auto-key') === 'on';
  }

  toggleAutoKey = () => {
    const on = !this.autoKeyEnabled();
    window.localStorage.setItem('twip:auto-key', on ? 'on' : 'off');
    window.Wick.Project.autoKey = on;
    this.setState({ autoKey: on });
    this.toast(on
      ? 'Auto-key on — moving something sets a keyframe at the playhead'
      : 'Auto-key off', 'info');
  }

  /**
   * Return all possible sound assets.
   */
  getAllSoundAssets = () => {
    return this.project.getAssets('Sound');
  }

  /**
   * Toggles the preview play between on and off states.
   */
  togglePreviewPlaying = () => {
    if(this.processingAction) return;

    let onionSkinningWasOn = false;
    if (!this.state.previewPlaying && this.project.onionSkinEnabled) {
      this.toggleOnionSkin();
      onionSkinningWasOn = true;
    }

    this.showWaitOverlay();
    this.processingAction = true;

    // Apply the change of the current selection before clearing it.
    if(this.project.selection.numObjects > 0) {
      this.project.view.applyChanges();
      this.project.selection.clear();
    }

    // Turn onion skinning back on if it was turned off.
    if (this.state.previewPlaying && this.state.onionSkinningWasOn && !this.project.onionSkinEnabled) {
      this.toggleOnionSkin();
    }

    this.setState({
      previewPlaying: !this.state.previewPlaying,
      showCodeErrors: false,
      onionSkinningWasOn: onionSkinningWasOn,
    });

    this.hideWaitOverlay();
    this.processingAction = false;
  }

  /**
   * Start playing the project from the beginning of the timeline.
   */
  startPreviewPlayFromBeginning = () => {
      if(this.state.previewPlaying) return;

      this.project.focus.timeline.playheadPosition = 1;
      this.togglePreviewPlaying();
  }

  /**
   * Stops the project if it is currently preview playing and displays any errors in the code window.
   * @param {object} error - any errors called while playing
   */
  stopPreviewPlaying = (error) => {

    this.setState({
      previewPlaying: false,
      codeEditorOpen: this.project.error === undefined ? this.state.codeEditorOpen : true,
      showCodeErrors: this.project.error === undefined ? false : true,
    });

    if(error) {
      let obj = window.Wick.ObjectCache.getObjectByUUID(error.uuid);

      if (obj) {
        this.selectObject(obj)
      }

      this.editScript(error.name);
    }

    this.projectDidChange({ actionName: "Stop Preview Playing" });
  }

  /**
   * Clears the current error message in the project.
   */
  clearCodeEditorError = () => {
      this.project.error = null;
      this.setState({
        codeError: null,
      })
      this.projectDidChange({ actionName: "Clear Code Editor Error" });
  }

  /**
   * Copies the selection state and selected objects to the clipboard.
   */
  copySelectionToClipboard = () => {
    if(this.project.copySelectionToClipboard()) {
      this.projectDidChange({ actionName: "Copy Selection" });
    } else {
      this.toast('There is nothing to copy.', 'warning');
    }
  }

  /**
   * Duplicates the current objects in the selection.
   */
  duplicateSelection = () => {
    if(this.project.duplicateSelection()) {
      this.projectDidChange({actionName: "Duplicate Selection" });
    } else {
      this.toast('There is nothing to duplicate.', 'warning');
    }
  }

  /**
   * Copies the selected objects to the clipboard and then deletes them from the project.
   */
  cutSelectionToClipboard = () => {
    if(this.project.cutSelectionToClipboard()) {
      this.projectDidChange({ actionName: "Cut Selection"});
    } else {
      this.toast('There is nothing to duplicate.', 'warning');
    }
  }

  /**
   * Attempts to paste in objects on the clipboard if they are available.
   * @return {[type]} [description]
   */
  pasteFromClipboard = () => {
    if(this.project.pasteClipboardContents()) {
      this.projectDidChange({ actionName: "Paste from Clipboard" });
    } else {
      this.toast('There is nothing in the clipboard to paste.', 'warning');
    }
  }

  /**
   * Creates a new keyframe at the current playhead position.
   */
  addTweenKeyframe = () => {
    if(!this.project.activeFrame) return;
    this.project.activeFrame.createTween();
    this.projectDidChange({ actionName: "Add Tween Keyframe" });
  }

  /**
   * Returns all existing fonts in the project.
   */
  getExistingFonts = () => {
    return this.project.getFonts();
  }

  /**
   * returns true if the project has the passed in font.
   * @param {string} font Font to check
   * @return {boolean} true if the project has this font.
   */
  hasFont = (font) => {
    return this.project.hasFont(font);
  }

  extendFrame = () => {
      var frames = this.project.selection.getSelectedObjects('Frame');
      this.project.extendFrames(frames);
      this.project.guiElement.draw();
  }

  shrinkFrame = () => {
      var frames = this.project.selection.getSelectedObjects('Frame');
      this.project.shrinkFrames(frames);
      this.project.guiElement.draw();
  }

  moveFrameRight = () => {
      this.project.moveSelectedFramesRight();
      this.project.guiElement.draw();
  }

  moveFrameLeft = () => {
      this.project.moveSelectedFramesLeft();
      this.project.guiElement.draw();
  }

  createTween = () => {
      this.project.createTween();
      this.projectDidChange({ actionName: "Create Tween" });
  }

  cutFrame = () => {
      this.project.cutSelectedFrames();
      this.projectDidChange({ actionName: "Cut Frame" });
  }

  insertBlankFrame = () => {
      this.project.insertBlankFrame();
      this.projectDidChange({ actionName: "Insert Blank Frame" });
  }

  extendSelectedFramesAndPushOtherFrames = () => {
      var frames = this.project.selection.getSelectedObjects('Frame');
      this.project.extendFramesAndPushOtherFrames(frames);
      this.project.guiElement.draw();
  }

  shrinkSelectedFramesAndPullOtherFrames = () => {
      var frames = this.project.selection.getSelectedObjects('Frame');
      this.project.shrinkFramesAndPullOtherFrames(frames);
      this.project.guiElement.draw();
  }

  extendActiveFramesAndPushOtherFrames = () => {
      var frames = this.project.activeTimeline.activeFrames;
      this.project.extendFramesAndPushOtherFrames(frames);
      this.project.guiElement.draw();
  }

  shrinkActiveFramesAndPullOtherFrames = () => {
      var frames = this.project.activeTimeline.activeFrames;
      this.project.shrinkFramesAndPullOtherFrames(frames);
      this.project.guiElement.draw();
  }

  exportSelectedClip = () => {
      var clip = this.project.selection.getSelectedObject();
      if(!clip) return;
      if(!(clip instanceof window.Wick.Clip)) return;

      window.Wick.WickObjectFile.toWickObjectFile(clip, 'blob', file => {
          window.saveFileFromWick(file, (clip.identifier || 'object'), '.wickobj');
      });
  }

  onEyedropperPickedColor = (e) => {
      this._onEyedropperPickedColor(e.color);
      this.activateLastTool();
  }

  handleWickFileLoad = (e) => {
    var file = e.target.files[0];
    if (!file) {
      console.warn('handleWickFileLoad: no files recieved');
      return;
    }

    this.importProjectAsWickFile(file);
  }

  /**
   * Loads Local Wick File from
   * @param {*} fileEntry 
   */
  loadLocalWickFile = (fileEntry) => {
    if (window.loadWickFileEntry) {
      window.loadWickFileEntry(fileEntry, (blob) => {
        // Wraps the file in a fake event. TODO: Simplify this.
        this.handleWickFileLoad({
          target: {
            files: [blob]
          }
        }); 
      });
    } else {
      console.error("No File Entry Opener Provided");
    }
  }

  /**
   * Deletes local Wick File From Storage.
   * @param {FileEntry} fileEntry 
   */
  deleteLocalWickFile = (fileEntry) => {
    window.deleteLocalWickFile(fileEntry);
  }

  /**
   * Reloads any saved files currently on disk.
   */
  reloadSavedWickFiles = () => {
    if (window.getSavedWickFiles) {
       window.getSavedWickFiles(files => {
        this.setState({
          localSavedFiles: files,
        });
      });
    }
  }

}

export default EditorCore;
