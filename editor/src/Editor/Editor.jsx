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

import './_editor.scss';
// The global rules that used to ride along inside _wickbrand.scss's 40 imports.
import './_globals.scss';
import './styles/default_theme.css';
import './styles/default_styles.css';

import { HTML5Backend } from 'react-dnd-html5-backend'
import { DndProvider } from 'react-dnd'
import { PanelGroup, Panel, PanelSeparator } from '@/ui/resizable'
import { throttle } from 'underscore';
import localForage from 'localforage';
import { notify, updateNotification } from '@/ui/toast';
import ResizeSensor from './Util/ResizeSensor';

import HotKeyInterface from './hotKeyMap';
import ActionMapInterface from './actionMap';
import ScriptInfoInterface from './scriptInfo';
import FontInfoInterface from './fontInfo';
import EditorCore from './EditorCore';

import DockedPanel from './Panels/DockedPanel/DockedPanel';
import Canvas from './Panels/Canvas/Canvas';
import Inspector from './Panels/Inspector/Inspector';
import MenuBar from './Panels/MenuBar/MenuBar';
import Timeline from './Panels/Timeline/Timeline';
import CanvasTransforms from './Panels/CanvasTransforms/CanvasTransforms';
import Toolbox from './Panels/Toolbox/Toolbox';
import AssetLibrary from './Panels/AssetLibrary/AssetLibrary';
import Outliner from './Panels/Outliner/Outliner';
import OutlinerExpandButton from './Panels/OutlinerExpandButton/OutlinerExpandButton';
import WickCodeEditor from './PopOuts/WickCodeEditor/WickCodeEditor';

import ViewOnly from './Panels/ViewOnly/ViewOnly';

import EditorWrapper from './EditorWrapper';

import { version } from '../../package.json';

/*
 * Breakpoints.
 *
 * 1024 is the hard minimum authoring width: below it the layout switches rather than
 * shrinks, which is why "medium" exists at all. Below 768 the editor is a viewer — see
 * Panels/ViewOnly.
 *
 * These were 1200 and 800, chosen when a separate mobile component tree existed to catch
 * everything under 800. 768 is inclusive so an iPad in portrait (768 CSS px) still gets
 * the authoring layout; a tablet with a stylus is a better drawing surface than a laptop
 * trackpad, and sending it to the viewer would be the wrong call.
 */
const FULL_LAYOUT_WIDTH = 1024;
const MIN_AUTHORING_WIDTH = 768;

function computeRenderSize () {
  if (window.innerWidth >= FULL_LAYOUT_WIDTH) return "large";
  if (window.innerWidth >= MIN_AUTHORING_WIDTH) return "medium";
  return "small";
}

class Editor extends EditorCore {
  constructor () {
    super();
    // Set path for engine dependencies
    window.Wick.resourcepath = 'corelibs/wick-engine/';

    // "Live" editor states
    this.project = null;
    this.paper = null;
    this.editorVersion = version + '';

    // GUI state
    this.state = {
      project: null,
      previewPlaying: false,
      activeModalName: null,
      activeModalQueue: [],
      codeEditorOpen: false,
      scriptToEdit: "default",
      showCanvasActions: false,
      showCodeErrors: false,
      codeError: null,
      outlinerPoppedOut: false,
      consoleLogs: [],
      warningModalInfo: {
        description: "No Description Given",
        title: "Title",
        acceptText: "Accept",
        cancelText: "Cancel",
        acceptAction: (() => {console.warn("No Accept Action")}),
        cancelAction: (() => {console.warn("No Cancel Action")}),
      },
      renderProgress: 0,
      renderType: "default",
      renderStatusMessage: "",
      customHotKeys: {},
      colorPickerType: "swatches",
      lastColorsUsed: ["#FFFFFF", "#FFFFFF", "#FFFFFF", "#FFFFFF", "#FFFFFF", "#FFFFFF", "#FFFFFF", "#FFFFFF"],
      exporting: false,
      swfPreviewUrl: null,
      useCustomOnionSkinningColors: false,
      customOnionSkinningColors: {
        backward: "rgba(0, 255, 0, .3)",
        forward: "rgba(255, 0, 0, .3)",
      },
      onionSkinningWasOn: false,
      // Mirrors localStorage so the toolbar button re-renders when it changes; the engine
      // reads Wick.Project.autoKey, which componentDidMount syncs from the same place.
      autoKey: window.localStorage.getItem('twip:auto-key') === 'on',
      localSavedFiles: [], // Files to display in savedProjects Modal.
      // Which Inspector tab something outside the panel last asked for, and a counter so
      // asking for the tab already showing still counts as asking. See focusInspectorTab.
      inspectorTab: 'object',
      inspectorTabRequest: 0,
      // Held in state rather than read from window.innerWidth during render, so that
      // componentDidUpdate can see the transition and tell the engine about it.
      renderSize: computeRenderSize(),
    };

    // Catch all errors that happen in the editor.
    window.onerror = function(error, url, line) {

      console.error(error);
      console.log("Error Details:", {
        error,
        url,
        line
      })
      return true;
    }


    // Set up error.
    this.error = null;

    // Last Autosave
    this._lastAutosave = 0;

    // Create interfaces.
    this.fontInfoInterface = new FontInfoInterface(this);

    // Init hotkeys
    this.hotKeyInterface = new HotKeyInterface(this);

    // Init actions
    this.actionMapInterface = new ActionMapInterface(this);

    // Init Script Info
    this.scriptInfoInterface = new ScriptInfoInterface();

    // Check if we are using local saving (apps)...
    if (window.wickEditorFileSystemType === 'local') {
      window.openWickLocalFileViewer = (files) => {
        console.log("Files Received", files);
        this.setState({
          localSavedFiles: files,
          activeModalName: 'SavedProjects',
        });
      }

      /**
       * Called if a save is attempted and a file with the same name already exists.
       * @param {Object} args - Wrapper for openWarningModal 
       */
      window.warnBeforeSave = (args) => {this.openWarningModal(args)};
    }

    // Wick Project File Input
    this.openProjectFileFromClient = window.createFileInput({
      accept: '.zip, .wick',
      onChange: this.handleWickFileLoad,
    });

    // Wick file input
    this.openAssetFileFromClient = window.createFileInput({
      accept: window.Wick.FileAsset.getValidExtensions().join(', '),
      onChange: this.handleAssetFileImport,
      multiple: true,
    });

    // Set up color picker
    this.maxLastColors = 8;
    this._onEyedropperPickedColor = (color) => {};

    /*
     * Resizable panels. react-resizable-panels owns panel sizing now, so the only thing
     * left for the editor to do on a resize is tell the engine — `onResize` re-renders the
     * paper.js view and redraws the timeline canvas, neither of which reflows on its own.
     *
     * The four onStop*Resize handlers that used to live here are gone with reflex. Three of
     * them (inspector, asset library, popout outliner) wrote to state nothing ever read;
     * the fourth fed `timelineSize` straight back into the size the library had already
     * applied. The library persists layout itself, which is more than the old code did.
     */
    this.RESIZE_THROTTLE_AMOUNT_MS = 100;
    this.WINDOW_RESIZE_THROTTLE_AMOUNT_MS = 300;
    // These read `this.resizeThrottleAmount` / `this.windowResizeThrottleAmount` before,
    // neither of which is ever assigned — so both throttles have had a wait of `undefined`,
    // which underscore treats as 0. Nothing here was throttled. Now it is.
    this.onResize = throttle(this.onResize, this.RESIZE_THROTTLE_AMOUNT_MS);
    this.onWindowResize = throttle(this.onWindowResize, this.WINDOW_RESIZE_THROTTLE_AMOUNT_MS);
    window.addEventListener("resize", this.onWindowResize);

    this.canvasComponent = null;

    this.lastUsedTool = 'cursor';

    this.builtinPreviews = {};
  }

  UNSAFE_componentWillMount = () => {
    document.title =  `twip ${this.editorVersion}`;
    // Initialize "live" engine state
    this.project = this.newProject();
    this.attachErrorHandlers();
    this.paper = window.paper;

    // Initialize local storage
    localForage.config({
      name        : 'WickEditor',
      description : 'Live Data storage of the Wick Editor app.'
    });

    this.customHotKeysKey = "wickEditorcustomHotKeys";
    this.colorPickerTypeKey = "wickEditorColorPickerType";

    // Set up custom hotkeys if they exist.
    localForage.getItem(this.customHotKeysKey).then(
      (customHotKeys) => {
        if (!customHotKeys) customHotKeys = {}; // Ensure we never send a null hotkey setting.
        this.hotKeyInterface.setCustomHotKeys(customHotKeys);

        this.setState({
          customHotKeys: customHotKeys,
        });
      }
    );

    // Set color picker state.
    localForage.getItem(this.colorPickerTypeKey).then(
      (colorPickerType) => {
        if (!colorPickerType) colorPickerType = "swatches";
        this.setState({
          colorPickerType: colorPickerType,
        });
      }
    );



    // Setup the initial project state
    this.setState({
      ...this.state,
      project: this.project.serialize(),
      codeEditorWindowProperties: this.getDefaultCodeEditorProperties(),
    });

    /*
     * Leave-page warning. It fired on every reload, including reloads of a project nobody
     * had touched, for three reasons: `project.numUndoStates` is undefined (the counter is
     * on `project.history`), so the early return never happened; the test was inverted
     * against its own comment, bailing out when there WERE unsaved edits; and `this` inside
     * a plain function assigned to window.onbeforeunload is `window`, whose `project` the
     * script sandbox deletes (engine Tickable.js:571), so it threw as often as not.
     *
     * Armed only for a real user. The dev server and the Playwright scripts reload dozens of
     * times a run and the dialog is in the way of both.
     *
     * `localStorage['twip:leave-warning'] = 'on'` (or 'off') overrides that in either
     * direction and survives a reload, so the dialog can be exercised in dev without a
     * rebuild — and silenced in a production build if it is ever in the way there.
     */
    const forced = window.localStorage.getItem('twip:leave-warning');
    const underTest = navigator.webdriver || import.meta.env.DEV;
    const armed = forced ? forced === 'on' : !underTest;
    window.onbeforeunload = !armed ? null : (event) => {
      if (this.project.history.numUndoStates <= 1) return undefined;
      const confirmationMessage = 'Warning: All unsaved changes will be lost!';
      (event || window.event).returnValue = confirmationMessage; //Gecko + IE
      return confirmationMessage; //Gecko + Webkit, Safari, Chrome etc.
    };
  }


  componentDidMount = () => {
    console.log("Project Mounted");
    this.hidePreloader();
    // The mode outlives the session it was set in, so hand it to the engine before anything
    // can be dragged. Static on Wick.Project rather than on this project, so it also
    // survives loading a file and undoing past the point it was switched on.
    window.Wick.Project.autoKey = this.autoKeyEnabled();
    this.syncViewOnlyMode();
    this.onWindowResize();
    if(!this.tryToParseProjectURL()) {
      this.showAutosavedProjects();
    }

    this.watchForHover();
  }

  componentDidUpdate = (prevProps, prevState) => {
    this.syncViewOnlyMode();

    if(this.state.previewPlaying && !prevState.previewPlaying) {
      this.project.view.canvas.focus();
      this.project.play({
        onError: (error) => {
          if (error) {
            console.error(new Error(`${error.message} on line ${error.lineNumber} in script "${error.name}".`));
            this.setState({
              codeError: error,
            });
          }

    
          this.stopPreviewPlaying(error)
        },
        onAfterTick: () => {
          //this.project.view.render();
          // The viewer does not mount the Timeline, so guiElement still holds the detached
          // container it makes in its own constructor. Drawing into it walks `offsetWidth`
          // of an unattached div, and gui/Project.js:181 turns that 0 into a canvas width
          // of -2.
          if (!this.isViewOnly()) this.project.guiElement.draw();
        },
        onBeforeTick: () => {

        },
      });
    }

    if(!this.state.previewPlaying && prevState.previewPlaying) {
      this.project.stop();
      this.projectDidChange({ skipHistory: true, actionName:"Stop Project" });
    }
  }

  // Detects if the device has hover capability. Adds "hasHover" to the body to avoid 'Sticky-hover' on touch devices.
  // https://stackoverflow.com/questions/23885255/how-to-remove-ignore-hover-css-style-on-touch-devices
  watchForHover = () => {
    // lastTouchTime is used for ignoring emulated mousemove events
    let lastTouchTime = 0
  
    function enableHover() {
      if (new Date() - lastTouchTime < 500) return
      document.body.classList.add('hasHover')
    }
  
    function disableHover() {
      document.body.classList.remove('hasHover')
    }
  
    function updateLastTouchTime() {
      lastTouchTime = new Date()
    }
  
    document.addEventListener('touchstart', updateLastTouchTime, true)
    document.addEventListener('touchstart', disableHover, true)
    document.addEventListener('mousemove', enableHover, true)
  
    enableHover()
  }
  
  

//

  hidePreloader = () => {
    let preloader = window.document.getElementById('preloader');
    setTimeout(() => {
      preloader.style.opacity = '0';
      this.recenterCanvas(); // Recenter the canvas after reload;
      setTimeout(() => {
        preloader.style.display = 'none';
        preloader.remove();
      }, 500);
      this.project.view.render()
    }, 2000); // Wait two seconds to allow editor to set up... TODO: Should connect this to load events.
  }

  showWaitOverlay = (message) => {
    window.clearTimeout(this._showWaitOverlayTimeoutID);
    this._showWaitOverlayTimeoutID = window.setTimeout(() => {
      let waitOverlay = window.document.getElementById('wait-overlay');
      waitOverlay.innerHTML = message || "Please wait...";
      waitOverlay.style.display = 'block';
    }, 250);
  }

  hideWaitOverlay = () => {
    window.clearTimeout(this._showWaitOverlayTimeoutID);
    let waitOverlay = window.document.getElementById('wait-overlay');
    waitOverlay.style.display = 'none';
  }

  /**
   * Resets the editor in preparation for a project load.
   */
  resetEditorForLoad = () => {

  }

  /**
   * Updates the color picker type within the editor state.
   * @param {String} type String representing the type of the color picker, can be swatches, spectrum, or gradient (TODO).
   */
  changeColorPickerType = (type) => {
    localForage.setItem(this.colorPickerTypeKey, type);
    this.setState({
      colorPickerType: type,
    });
  }

  onWindowResize = () => {
    // Ensure that all elements resize on window resize.
    this.onResize();

    const renderSize = computeRenderSize();

    /*
     * Keep the floating code window inside the viewport, but keep everything else the user
     * chose. This used to assign getDefaultCodeEditorProperties() wholesale, which resets
     * not just position and size but consoleHeight, consoleOpen, fontSize and theme — so
     * dragging the browser window edge silently threw away the font size and editor theme
     * picked in Settings. Only the geometry has any reason to react to a viewport change.
     */
    this.setState(({ codeEditorWindowProperties: props }) => {
      const width = Math.min(props.width, window.innerWidth);
      const height = Math.min(props.height, window.innerHeight);
      return {
        renderSize,
        codeEditorWindowProperties: {
          ...props,
          width,
          height,
          x: Math.max(0, Math.min(props.x, window.innerWidth - width)),
          y: Math.max(0, Math.min(props.y, window.innerHeight - height)),
        },
      };
    });

    // re-render project to avoid incorrect pan
    this.project.view.render();
    this.recenterCanvas();
  }

  getDefaultCodeEditorProperties = () => {
    var width = window.innerWidth / 2;
    var height = window.innerHeight / 2;
    return (
      {
        width: width,
        height: height,
        x: window.innerWidth/2 - width/2,
        y: window.innerHeight/2 - height/2,
        minWidth: 400,
        minHeight: 250,
        consoleHeight: 100,
        consoleOpen: true,
        fontSize: 16,
        theme: 'dark'
      }
    );
  }

  updateLastColors = (color) => {
    let newArray = this.state.lastColorsUsed.concat([]); // make a deep copy.

    // Remove a color from the array. If the new color is in the array, remove it.
    let index = newArray.indexOf(color);
    if (index > -1) {
      newArray.splice(index, 1);
    } else {
      newArray.pop();
    }

    // Add the new color to the front of the array.
    newArray.unshift(color);

    this.setState({
      lastColorsUsed: newArray,
    });
  }

  toggleOutliner = () => {
    this.setState({outlinerPoppedOut: !this.state.outlinerPoppedOut});
  }

  onResize = (e) => {
    this.project.view.resize();
    this.project.guiElement.draw();
  }

  /**
   * Called when the canvas element's own box changes size, from whatever cause — a panel
   * drag, the window, a panel appearing. paper.js sizes its backing store once at mount
   * and does not reflow, so it has to be told.
   */
  onCanvasResize = () => {
    if (!this.project) return;
    this.project.view.resize();
    this.project.view.render();
  }

  /**
   * Updates the code editor properties in the state.
   * @param  {object} newProperties object with new code editor properties. Can include width, height, x, y.
   */
  updateCodeEditorWindowProperties = (newProperties) => {
    let finalProperties = this.state.codeEditorWindowProperties;
    Object.keys(newProperties).forEach(key => {
      finalProperties[key] = newProperties[key];
    });

    this.setState({
      codeEditorWindowProperties: finalProperties,
    });
  }


  /**
   * Called when any script is updated.
   */
  onScriptUpdate = () => {
    if (this.project.error) {
      this.clearCodeEditorError();
    }
  }


  /**
   * Opens the requested modal.
   * @param  {string} name name of the modal to open.
   */
  openModal = (name) => {
    this.setState({
      activeModalName: name,
    });
  }

  /**
   * Queues a modal to be opened at the next opportunity.
   * @param  {string} name [description]
   */
  queueModal = (name) => {
    if (this.state.activeModalName !== name) {
      // If there is another modal up, queue the modal.
      if (this.state.activeModalName !== null && this.state.activeModalQueue.indexOf(name) === -1) {
        this.setState(prevState => {
          return {
            activeModalQueue: [name].concat(prevState.activeModalQueue),
          }
        });
      // Otherwise, just open it.
      } else {
        this.openModal(name)
      }
    }
  }

  /**
   * Closes the active modal, if there is one. Opens the next modal in the
   * if necessary.
   */
  closeActiveModal = () => {
    let oldQueue = [].concat(this.state.activeModalQueue);
    if (oldQueue.length === 0) {
      this.openModal(null);
      return;
    }
    var newModalName = oldQueue.shift();
    this.setState({
      activeModalQueue: oldQueue,
    }, () => this.openModal(newModalName));
  }

  /**
   * Opens and closes the code editor depending on the state of the codeEditor.
   * @param {boolean} state - Optional. True will open the code editor, false will close.
   */
  toggleCodeEditor = (state) => {
    if (state === undefined || (typeof state !== "boolean")) {
      state = !this.state.codeEditorOpen;
    }

    this.setState({
      codeEditorOpen: state,
    });
  }

  /**
   * Opens and closes the canvas actions popover.
   * @param {boolean} state - Optional. True will open the canvas actions menu, false will close.
   */
  toggleCanvasActions = (state) => {
    if (state === undefined || (typeof state !== "boolean")) {
      state = !this.state.showCanvasActions;
    }

    this.setState({
      showCanvasActions: state,
    });
  }

  /**
   * Show code errors in the code editor by popping it up.
   * @param  {object[]} errors Array of error objects.
   */
  showCodeErrors = (errors) => {
    this.setState({
      codeEditorOpen: errors === undefined ? this.state.codeEditorOpen : true,
    });

    if (errors.length > 0) {
      let uuid = errors[0].uuid;
      let obj = window.Wick.ObjectCache.getObjectByUUID(uuid);
      this.setFocusObject(obj.parentClip);
      this.selectObject(obj)
      this.projectDidChange({actionName:"Show Code Errors"});
    }
  }

  /**
   * Update the onion skinning colors in the editor.
   * @param {object} colors An object with colors to be used for onion skinning. colors.backward is used for previous frames. colors.forward is used for following frames.
   */
  changeOnionSkinningColors = (colors) => {
    if (!colors) return; // ignore change if no colors are passed.

    this.setState({
      customOnionSkinningColors: {
        backward: colors.backward || this.state.customOnionSkinningColors.backward,
        forward: colors.forward || this.state.customOnionSkinningColors.forward,
      }
    });
  }

  /**
   * Signals to React that the "live" project changed, so that all components
   * displaying info about the project will render.
   * @param {boolean} skipHistory - If set to true, the current state will not be pushed to the history.
   * @param {string} actionName - Name of the action committed, to save to the history stack.
   * @param {boolean} skipReactRender - If set to true, will not force react to rerender. Use sparingly.
   */
  projectDidChange = (options) => {
    if(!options) options = {};

    if (!options.actionName) { options.name = "Unknown Action" };

    // Request an autosave, so a save will happen sometime later.
    this.requestAutosave();

    // Save state to history if needed
    if(!options.skipHistory) {
      this.project.history.pushState(window.Wick.History.StateType.ONLY_VISIBLE_OBJECTS, options.actionName);
    }

    // Render engine
    this.project.view.render();
    this.project.guiElement.draw();

    // Force react to render
    // TODO: Determine a non-hack way to do this.
    if (!options.skipReactRender) {
      this.setState({
        project: ''+Math.random(),
      });
    }
  }

  /**
   * Create a toast notification.
   * @param {string} message - the message to display inside the toast.
   * @param {string} type - "info", "success", "warning" or "error".
   * @param {object} options - `{autoClose: false}` to leave it up until updated.
   * @returns {string|number} the toast's id, which updateToast() takes.
   */
  toast = (message, type, options) => {
    if(!message) {
      console.error("toast() requires a message.");
      return;
    }

    if(type && ["info", "success", "warning", "error"].indexOf(type) === -1) {
      console.error("toast(): Invalid type: " + type);
      return;
    }

    return notify(message, type, options);
  }

  /**
   * Updates an existing toast to a new toast type
   * @param {string} id ID of the toast to update.
   * @param {object} options `{text, type}` — the message and the colour to switch to.
   */
  updateToast = (id, options) => {
    updateNotification(id, options);
  }


  /**
   * Opens a warning modal with a description. If the modal is accepted, the accept action is called.
   * @param {Object} args can contain description {string}, acceptAction {function}, cancelAction {function},
   * acceptText {string}, cancelText {string}, title {string}.
   */
  openWarningModal = (args) => {
    let modalInfo = {
      description: args.description || "No Description",
      title: args.title || "Title",
      acceptAction: args.acceptAction || (() => {console.warn("No accept action implemented.")}),
      cancelAction: args.cancelAction || (() => {console.warn("No cancel action implemented.")}),
      finalAction: args.finalAction || (() => {console.warn("No final action implemented.")}),
      acceptText: args.acceptText || "Accept",
      acceptIcon: args.acceptIcon,
      cancelText: args.cancelText || "Cancel",
      cancelIcon: args.cancelIcon,
    }

    this.setState({
      warningModalInfo: modalInfo,
      activeModalName: "GeneralWarning",
    });
  }

  /**
   *  Combines two custom hotkey objects into a single custom hotkey object.
   *  Any hotkeys in hotkeys2 will overwrite hotkeys1.
   * @param {Object} hotkeys1 - Custom hotkey map.
   * @param {Object} hotkeys2 - Custom hotkey map.
   * @returns {Object} - Combined custom hotkey map.
   **/


  combineHotKeys = (hotkeys1, hotkeys2) => {
    // Try to combine all keys

    let newHotKeys = {...hotkeys1, ...hotkeys2};

    let keys1 = Object.keys(hotkeys1);
    let keys2 = Object.keys(hotkeys2);

    let similarKeys = keys2.filter(key => keys1.indexOf(key) > -1);

    similarKeys.forEach(key => {
      let combinedKey = {...hotkeys1[key], ...hotkeys2[key]};
      newHotKeys[key] = combinedKey;
    });

    return newHotKeys;
  }

  /**
   * Converts an array of hotkeys to a custom hotkey object.
   */
  convertHotkeyArray = (hotkeys) => {
    let keyObj = {};
    
    hotkeys.forEach(key => {
      if (keyObj[key.actionName]) {
        keyObj[key.actionName][key.index] = key.sequence;
      } else {
        keyObj[key.actionName] = {}
        keyObj[key.actionName][key.index] = key.sequence;
      }
    });

    return keyObj;
  }

  /**
   * Creates a combined key map from a key map object and key array.
   */
  createCombinedHotKeyMap = (hotKeyMap, hotKeyArray) => {
    return this.combineHotKeys(hotKeyMap, this.convertHotkeyArray(hotKeyArray));
  }

  /**
   * Takes an array of hot key objects. Combines these with existing custom hot keys and syncs the editor
   * to these new hot keys.
   */
  addCustomHotKeys = (newHotKeys) => {
    let combined = this.createCombinedHotKeyMap(this.state.customHotKeys, newHotKeys);

    this.syncHotKeys(combined);
  }

  /**
   * Takes a hotkeys object and sets these as the custom hot keys.
   */
  syncHotKeys = (hotkeys) => {
    this.hotKeyInterface.setCustomHotKeys(hotkeys);
    localForage.setItem(this.customHotKeysKey, hotkeys);
    this.setState({
      customHotKeys: hotkeys
    });
  }

  resetCustomHotKeys = () => {
    this.syncHotKeys({});
  }

  /**
   * A flag to prevent "double state changes" where an action tries to happen while another is still processing.
   * Set this to true before doing something asynchronous that will take a long time, and set it back to false when done.
   */
  get processingAction () {
    return this._processingAction;
  }

  set processingAction (processingAction) {
    this._processingAction = processingAction;
  }

  handleAssetFileImport = (e) => {
    this.createAssets(e.target.files, []);
  }

  openProjectFileDialog = () => {
    this.openProjectFileFromClient();
  }

  openImportAssetFileDialog = () => {
    this.openAssetFileFromClient();
  }

  /**
   * Returns the appropriate keymap based on the state of the editor.
   * @param fullKeyMap {Bool} If true, returns the full keymap for the editor. Otherwise, the appropriate keymap is returned.
   * @returns {Object} Keymap listed as actionName : Object { 0 : sequence, 1 : sequence }
   */
  getKeyMap = (fullKeyMap) => {
    // The viewer binds the same one key preview playback does — play/stop. Binding the
    // rest would give a surface with no delete button a working delete shortcut.
    if ((this.state.previewPlaying || this.isViewOnly()) && !fullKeyMap) {
      return this.hotKeyInterface.getEssentialKeyMap(this.state.customHotKeys)
    } else {
      return this.hotKeyInterface.getKeyMap(this.state.customHotKeys)
    }
  }

  /**
   * Returns the appropriate key handlers based on the state of the editor.
   * @param fullKeyHandlers {Bool} If true, returns all key handlers for the editor. Otherwise, the appropriate keyhandlers returned.
   */
  getKeyHandlers = (fullKeyHandlers) => {
    if (this.isViewOnly() && !fullKeyHandlers) {
      // Same one key, but the viewer's meaning of play, so the key and the button agree.
      return {
        ...this.hotKeyInterface.getEssentialKeyHandlers(this.state.customHotKeys),
        'preview-play-toggle': this.toggleViewOnlyPlayback,
      };
    } else if (this.state.previewPlaying && !fullKeyHandlers) {
      return this.hotKeyInterface.getEssentialKeyHandlers(this.state.customHotKeys)
    } else {
      return this.hotKeyInterface.getHandlers(this.state.customHotKeys)
    }
  }

  /**
   * Returns a string representing the render size elements should use in the editor.
   * @returns {String} "large", "medium" or "small" depending on the width of the window.
   */
  getRenderSize = () => {
    return this.state.renderSize;
  }

  /**
   * True when the window is too narrow to author in and the editor is showing the viewer.
   */
  isViewOnly = () => {
    return this.state.renderSize === "small";
  }

  /**
   * Tell the engine which surface is on screen.
   *
   * The viewer takes the `none` tool, so a drag on the canvas neither draws nor selects.
   * The authoring tool goes back on the way out — by name, not by reference, because tools
   * belong to a project and the project can be swapped underneath this.
   *
   * Deliberately not routed through `lastUsedTool`: that is the activate-last-tool hotkey's
   * memory and has no business learning about window resizes.
   *
   * Re-runs when the project is replaced as well as when the breakpoint moves, since
   * opening a file builds a fresh Wick.Project holding the cursor tool.
   *
   * Zoom is left to `recenter()`, which already fits the stage to its container with 4%
   * padding and is what every load path calls. The engine also has a `fill` fitMode that
   * refits on every render, but it multiplies the model zoom by the fit zoom, so a
   * `recenter()` from anywhere — `hidePreloader`, `prepareProjectForEditor` — squares the
   * scale and the stage collapses to a quarter size.
   */
  syncViewOnlyMode = () => {
    if (!this.project) return;

    const viewOnly = this.state.renderSize === "small";
    const sameProject = this.project === this._viewModeProject;
    if (sameProject && viewOnly === this._viewModeApplied) return;

    const leavingViewOnly = sameProject && this._viewModeApplied && !viewOnly;
    this._viewModeProject = this.project;
    this._viewModeApplied = viewOnly;

    if (viewOnly) {
      if (this.project.activeTool.name !== 'none') {
        this.toolBeforeViewOnly = this.project.activeTool.name;
      }
      this.project.activeTool = 'none';
    } else if (leavingViewOnly) {
      this.project.activeTool = this.toolBeforeViewOnly || 'cursor';
    }

    this.project.view.resize();
    this.project.recenter();
    this.project.view.render();
  }

  setConsoleLogs = (logs) => {
    this.setState({
      consoleLogs: logs,
    })
  }

  /**
   * Play from the top, or stop. A viewer has no playhead to resume from, so "play" means
   * "play the thing", not "continue from wherever the last session left the playhead".
   */
  toggleViewOnlyPlayback = () => {
    if (this.state.previewPlaying) {
      this.togglePreviewPlaying();
    } else {
      this.startPreviewPlayFromBeginning();
    }
  }

  /**
   * The sub-768 surface. Still inside EditorWrapper, so modals, toasts, the error boundary
   * and the play/stop hotkey all work here — the viewer is a different tree, not a
   * different app.
   */
  renderViewOnly = () => {
    return (
      <ViewOnly
        projectName={this.project.name}
        playing={this.state.previewPlaying}
        onTogglePlay={this.toggleViewOnlyPlayback}
        minAuthoringWidth={MIN_AUTHORING_WIDTH}
      >
        <ResizeSensor onResize={this.onCanvasResize}>
          <Canvas
            editor={this}
            project={this.project}
            projectDidChange={this.projectDidChange}
            projectData={this.state.project}
            paper={this.paper}
            previewPlaying={this.state.previewPlaying}
            createImageFromAsset={this.createImageFromAsset}
            toast={this.toast}
            onEyedropperPickedColor={this.onEyedropperPickedColor}
            createAssets={this.createAssets}
            importProjectAsWickFile={this.importProjectAsWickFile}
            onRef={ref => this.canvasComponent = ref}
            canvasBGColor="var(--color-surface)"
          />
        </ResizeSensor>
      </ViewOnly>
    );
  }

  render = () => {
    // Create some references to the project and editor to make debugging in the console easier:
    window.project = this.project;
    window.editor = this;

    let renderSize = this.getRenderSize();

    if (renderSize === "small") {
      return (
        <DndProvider backend={HTML5Backend}>
          <EditorWrapper editor={this}>
            {this.renderViewOnly()}
          </EditorWrapper>
        </DndProvider>
      );
    }

    return (
      <DndProvider backend={HTML5Backend}>
      <EditorWrapper editor={this}>
        {/* Menu Bar */}

        <div id="menu-bar-container">
          {/* Header */}
          <DockedPanel showOverlay={this.state.previewPlaying}>
            <MenuBar
              openModal={this.openModal}
              projectName={this.project.name}
              openProjectSettings={() => this.focusInspectorTab('document')}
              openProjectFileDialog={this.openProjectFileDialog}
              openNewProjectConfirmation={this.openNewProjectConfirmation}
              exportProjectAsWickFile={this.exportProjectAsWickFile}
              previewProjectAsSWF={this.previewProjectAsSWF}
              importProjectAsWickFile={this.importProjectAsWickFile}
              exporting={this.state.exporting}
              toast={this.toast} 
              openExportMedia={() => {this.openModal('ExportMedia')}}
              openExportOptions={() => {this.openModal('ExportOptions')}}
            />
          </DockedPanel>
        </div>

        {/* Main Editor Panel */}

        <div id="editor-body">
          <div id="flexible-container">
            {/*App*/}
            {/*
              * react-resizable-panels calls the axis by the SEPARATOR's orientation, where
              * react-reflex called it by the split direction — so reflex's
              * orientation="vertical" (a left/right split) is orientation="horizontal" here.
              * Every group below is flipped relative to the code it replaces; that is not a
              * transcription error.
              */}
            <PanelGroup orientation="horizontal" onLayoutChanged={this.onResize}>
              {/* Middle Panel */}
              <Panel minSize="40%">
                {/*
                  * The toolbox took its height from a class and the canvas took the rest by
                  * `calc(100% - 40px)`, in two variants each, which is why a toolbar that
                  * needed a second row could only get one by hiding what did not fit. Column
                  * flex instead: the toolbar is as tall as its contents and the canvas is
                  * whatever is left, with no number written down anywhere.
                  */}
                <div className="flex h-full min-h-0 flex-col">
                {/*Toolbox*/}
                <div className="shrink-0">
                  <DockedPanel showOverlay={this.state.previewPlaying}>
                    <Toolbox
                      project={this.state.project}
                      getActiveToolName={() => this.getActiveTool().name}
                      activeToolName={this.getActiveTool().name}
                      setActiveTool={this.setActiveTool}
                      getToolSetting={this.getToolSetting}
                      setToolSetting={this.setToolSetting}
                      previewPlaying={this.state.previewPlaying}
                      editorActions={this.actionMapInterface.editorActions}
                      getToolSettingRestrictions={this.getToolSettingRestrictions}
                      showCanvasActions={this.state.showCanvasActions}
                      toggleCanvasActions={this.toggleCanvasActions}
                      colorPickerType={this.state.colorPickerType}
                      changeColorPickerType={this.changeColorPickerType}
                      updateLastColors={this.updateLastColors}
                      lastColorsUsed={this.state.lastColorsUsed}
                      keyMap={this.getKeyMap()}
                    />
                  </DockedPanel>
                </div>
                <div className="min-h-0 flex-1">
                  <PanelGroup orientation="vertical" onLayoutChanged={this.onResize}>
                    {/* Canvas and Popout Outliner */}
                    <Panel minSize={120}>
                      <PanelGroup orientation="horizontal" onLayoutChanged={this.onResize}>
                        {/*Canvas*/}
                        <Panel minSize="40%">
                          <DockedPanel>
                            <ResizeSensor onResize={this.onCanvasResize}>
                              <Canvas
                                editor={this}
                                project={this.project}
                                projectDidChange={this.projectDidChange}
                                projectData={this.state.project}
                                paper={this.paper}
                                previewPlaying={this.state.previewPlaying}
                                createImageFromAsset={this.createImageFromAsset}
                                toast={this.toast}
                                onEyedropperPickedColor={this.onEyedropperPickedColor}
                                createAssets={this.createAssets}
                                importProjectAsWickFile={this.importProjectAsWickFile}
                                onRef={ref => this.canvasComponent = ref}
                              />
                            </ResizeSensor>
                            
                            <CanvasTransforms
                              onionSkinEnabled={this.project.onionSkinEnabled}
                              toggleOnionSkin={this.toggleOnionSkin}
                              autoKeyEnabled={this.state.autoKey}
                              toggleAutoKey={this.toggleAutoKey}
                              zoomIn={this.zoomIn}
                              zoomOut={this.zoomOut}
                              recenterCanvas={this.recenterCanvas}
                              activeToolName={this.getActiveTool().name}
                              setActiveTool={this.setActiveTool}
                              previewPlaying={this.state.previewPlaying}
                              togglePreviewPlaying={this.togglePreviewPlaying}
                              keyMap={this.getKeyMap()}
                            />
                            {renderSize === "large" && 
                            <OutlinerExpandButton
                              expanded={this.state.outlinerPoppedOut}
                              toggleOutliner={this.toggleOutliner}
                            />}
                          </DockedPanel>
                        </Panel>

                        {/* Popout Outliner */}
                        {renderSize === "large" && this.state.outlinerPoppedOut && <PanelSeparator/>}
                        {renderSize === "large" && this.state.outlinerPoppedOut &&
                        <Panel
                          id="popout-outliner"
                          defaultSize={250}
                          maxSize={300} minSize={200}
                          groupResizeBehavior="preserve-pixel-size">
                          <Outliner 
                            className="popout-outliner"
                            project={this.project}
                            selectObjects={this.selectObjects}
                            deselectObjects={this.deselectObjects}
                            clearSelection={this.clearSelection}
                            editScript={this.editScript}
                            setFocusObject={this.setFocusObject}
                            setActiveLayerIndex={this.setActiveLayerIndex}
                            moveSelection={this.moveSelection}
                            toggleHidden={this.toggleHidden}
                            toggleLocked={this.toggleLocked}
                          />
                        </Panel>}
                      </PanelGroup>
                    </Panel>

                    <PanelSeparator/>

                    {/*Timeline*/}
                    <Panel
                      id="timeline"
                      minSize={100}
                      defaultSize={175}
                      groupResizeBehavior="preserve-pixel-size">
                      <DockedPanel  showOverlay={this.state.previewPlaying}>
                        <Timeline
                          project={this.project}
                          projectDidChange={this.projectDidChange}
                          projectData={this.state.project}
                          getSelectedTimelineObjects={this.getSelectedTimelineObjects}
                          setOnionSkinOptions={this.setOnionSkinOptions}
                          getOnionSkinOptions={this.getOnionSkinOptions}
                          setFocusObject={this.setFocusObject}
                          addTweenKeyframe={this.addTweenKeyframe}
                          dragSoundOntoTimeline={this.dragSoundOntoTimeline}
                        />
                      </DockedPanel>
                    </Panel>
                  </PanelGroup>
                </div>
                </div>
              </Panel>

              {/* Right Sidebar */}
              <PanelSeparator/>

                <Panel
                id="sidebar"
                defaultSize={250}
                maxSize={300} minSize={200}
                groupResizeBehavior="preserve-pixel-size">
                <PanelGroup orientation="vertical" onLayoutChanged={this.onResize}>
                  {/* Inspector */}
                  <Panel minSize={120}>
                    <DockedPanel showOverlay={this.state.previewPlaying}>
                      <Inspector
                        getToolSetting={this.getToolSetting}
                        setToolSetting={this.setToolSetting}
                        getActiveTool={this.getActiveTool}
                        getSelectionType={this.getSelectionType}
                        getAllSoundAssets={this.getAllSoundAssets}
                        getAllSelectionAttributes={this.getAllSelectionAttributes}
                        setSelectionAttribute={this.setSelectionAttribute}
                        getSelectedTweenCurve={this.getSelectedTweenCurve}
                        setSelectedTweenCurve={this.setSelectedTweenCurve}
                        autoSmoothSelectedTweens={this.autoSmoothSelectedTweens}
                        getFrameContext={this.getFrameContext}
                        setActiveFrameAttribute={this.setActiveFrameAttribute}
                        setActiveFrameProperties={this.setActiveFrameProperties}
                        setActiveLayerAttribute={this.setActiveLayerAttribute}
                        getProjectSettings={this.getProjectSettings}
                        updateProjectSettings={this.updateProjectSettings}
                        inspectorTab={this.state.inspectorTab}
                        inspectorTabRequest={this.state.inspectorTabRequest}
                        editorActions={this.actionMapInterface.editorActions}
                        selectionIsScriptable={this.selectionIsScriptable}
                        script={this.getSelectedObjectScript()}
                        scriptInfoInterface={this.scriptInfoInterface}
                        deleteScript={this.deleteScript}
                        editScript={this.editScript}
                        fontInfoInterface={this.fontInfoInterface}
                        project={this.project}
                        importFileAsAsset={this.importFileAsAsset}
                        colorPickerType={this.state.colorPickerType}
                        changeColorPickerType={this.changeColorPickerType}
                        updateLastColors={this.updateLastColors}
                        lastColorsUsed={this.state.lastColorsUsed}
                        getClipAnimationTypes={this.getClipAnimationTypes}
                      />
                    </DockedPanel>
                  </Panel>


                  {/* Outliner */}
                  {renderSize === 'medium' && <PanelSeparator/>}
                  {renderSize === 'medium' && <Panel
                    id="outliner"
                    minSize={100}>
                    <DockedPanel showOverlay={this.state.previewPlaying}>
                      <Outliner 
                        project={this.project}
                        selectObjects={this.selectObjects}
                        deselectObjects={this.deselectObjects}
                        clearSelection={this.clearSelection}
                        editScript={this.editScript}
                        setFocusObject={this.setFocusObject}
                        setActiveLayerIndex={this.setActiveLayerIndex}
                        moveSelection={this.moveSelection}
                        toggleHidden={this.toggleHidden}
                        toggleLocked={this.toggleLocked}
                      />
                    </DockedPanel>
                  </Panel>}



                  {window.enableAssetLibrary &&  <PanelSeparator/>}
                  {/* Asset Library */}
                  {window.enableAssetLibrary &&
                  <Panel
                    id="asset-library"
                    minSize={100}
                    defaultSize={300}
                    groupResizeBehavior="preserve-pixel-size">
                    <DockedPanel showOverlay={this.state.previewPlaying}>
                      <AssetLibrary
                        projectData={this.state.project}
                        assets={this.project.getAssets()}
                        openModal={this.openModal}
                        openImportAssetFileDialog={this.openImportAssetFileDialog}
                        selectObjects={this.selectObjects}
                        clearSelection={this.clearSelection}
                        isObjectSelected={this.isObjectSelected}
                        createImageFromAsset={this.createImageFromAsset}
                        deleteSelectedObjects={this.deleteSelectedObjects}
                        addSoundToActiveFrame={this.addSoundToActiveFrame}
                      />
                    </DockedPanel>
                  </Panel> }
                </PanelGroup>
              </Panel>
            </PanelGroup>
          </div>
          {this.state.codeEditorOpen &&
            <WickCodeEditor
              selectionType={this.getSelectionType()}
              codeEditorWindowProperties={this.state.codeEditorWindowProperties}
              updateCodeEditorWindowProperties={this.updateCodeEditorWindowProperties}
              scriptInfoInterface={this.scriptInfoInterface}
              selectionIsScriptable={this.selectionIsScriptable}
              script={this.getSelectedObjectScript()}
              scriptToEdit={this.state.scriptToEdit}
              error={this.state.codeError}
              onScriptUpdate={this.onScriptUpdate}
              editScript={this.editScript}
              toggleCodeEditor={this.toggleCodeEditor}
              requestAutosave={this.requestAutosave}
              clearCodeEditorError={this.clearCodeEditorError}
              consoleLogs={this.state.consoleLogs}
              setConsoleLogs={this.setConsoleLogs}
            />}
        </div>
      </EditorWrapper>
      </DndProvider>
      )
    }
  }

export default Editor