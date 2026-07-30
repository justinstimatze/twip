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

import { loadFontPreviews } from 'Editor/Util/fontPreview';

import InspectorTitle from './InspectorTitle/InspectorTitle';
import { PanelEmpty } from '@/ui/panel';

import InspectorNumericSlider from './InspectorRow/InspectorRowTypes/InspectorNumericSlider';
import InspectorTextInput from './InspectorRow/InspectorRowTypes/InspectorTextInput';
import InspectorNumericInput from './InspectorRow/InspectorRowTypes/InspectorNumericInput';
import InspectorDualNumericInput from './InspectorRow/InspectorRowTypes/InspectorDualNumericInput';
import InspectorSelector from './InspectorRow/InspectorRowTypes/InspectorSelector';
import InspectorColorNumericInput from './InspectorRow/InspectorRowTypes/InspectorColorNumericInput';
import InspectorActionButton from './InspectorActionButton/InspectorActionButton';
import InspectorImagePreview from './InspectorPreview/InspectorPreviewTypes/InspectorImagePreview';
import InspectorSoundPreview from './InspectorPreview/InspectorPreviewTypes/InspectorSoundPreview';
import InspectorScriptWindow from './InspectorScriptWindow/InspectorScriptWindow';
import InspectorCheckbox from './InspectorRow/InspectorRowTypes/InspectorCheckbox';
import InspectorFramePicker from './InspectorFramePicker/InspectorFramePicker';
import InspectorEasingCurve from './InspectorEasingCurve/InspectorEasingCurve';
import InspectorTabs from './InspectorTabs/InspectorTabs';
import InspectorDocument from './InspectorDocument/InspectorDocument';
import InspectorDraft from './InspectorDraft/InspectorDraft';

/*
 * One property group: a labelled block of rows with a hairline under it. Was
 * `.inspector-item` in _inspector.scss, repeated at 17 call sites; the 2px rule is
 * $editor-outline-padding * .5, which is where the odd half-splitter width comes from.
 */
const ITEM = 'flex flex-col items-center border-b-2 border-surface-sunken px-panel-pad py-[5px]';

const TABS = [
  { id: 'object', label: 'Object' },
  { id: 'frame', label: 'Frame' },
  { id: 'document', label: 'Doc' },
];

/*
 * Which tab owns each selection type. Everything the engine can report is in one list or the
 * other except 'unknown', which is what an empty selection reports — deliberately absent, so
 * that deselecting leaves you on the tab you were reading rather than throwing you back to
 * Object to look at a blank panel.
 */
const TAB_FOR_TYPE = {};
['clip', 'button', 'path', 'text', 'image', 'multipath', 'multiclip', 'multicanvas',
  'multitimeline', 'imageasset', 'soundasset', 'multiassetmixed', 'multisoundasset',
  'multiimageasset', 'gradientfill', 'gradientstroke', 'gradientstop',
].forEach(type => { TAB_FOR_TYPE[type] = 'object'; });
['frame', 'multiframe', 'tween', 'multitween', 'layer', 'multilayer',
].forEach(type => { TAB_FOR_TYPE[type] = 'frame'; });

class Inspector extends Component {
  constructor (props) {
    super(props);

    this.state = {
      tab: 'object',
      /* Both are here so getDerivedStateFromProps can tell a real change from a re-render:
       * it runs on every render, including the ones its own setState causes. */
      lastSelectionType: null,
      lastTabRequest: props.inspectorTabRequest,
    };

    /**
     * Which render function should be used for each selection type?
     */
    this.inspectorContentRenderFunctions = {
      "frame": this.renderFrame,
      "multiframe": this.renderMultiFrame,
      "tween": this.renderTween,
      "multitween": this.renderMultiTween,
      "layer": this.renderLayer,
      "multilayer": this.renderMultiLayer,
      "clip": this.renderClip,
      "button": this.renderButton,
      "path": this.renderPath,
      "text": this.renderText,
      "image": this.renderImage,
      "multipath": this.renderMultiPath,
      "multiclip": this.renderMultiClip,
      "multitimeline": this.renderMultiTimeline,
      "multicanvas": this.renderMultiCanvas,
      "imageasset": this.renderAsset,
      "soundasset": this.renderAsset,
      "multiassetmixed": this.renderAsset,
      "multisoundasset": this.renderAsset,
      "multiimageasset": this.renderAsset,
      "gradientfill": this.renderGradientTarget,
      "gradientstroke": this.renderGradientTarget,
      "gradientstop": this.renderGradientStop,
    }

    /**
     * Which actions should be shown for which selection types.
     */
    this.actionRules = {
      'breakApart': ["clip", "button",],
      'convertSelectionToButton': ["path", "text", "image", "multipath", "multiclip", "multicanvas"],
      'convertSelectionToClip': ["path", "text", "image", "multipath", "multiclip", "multicanvas"],
      'editTimeline': ["clip", "button"],
      'addAssetToCanvas': ["imageasset"],
      'convertLayersToClip': ["layer", "multilayer"],
      'distributeSelectionToLayers': ["path", "text", "image", "multipath", "multiclip", "multicanvas"],
      'reverseGradient': ["gradientfill", "gradientstroke"],
      'deleteGradientStop': ["gradientstop"]
    }

    /**
     * What titles should be displayed for each selection type?
     */
    this.inspectorTitles = {
      "frame": "Frame",
      "multiframe": "Multi-Frame",
      "tween": "Tween",
      "multitween": "Multi-Tween",
      "layer": "Layer",
      "multilayer": "Multi-Layer",
      "clip": "Clip",
      "button": "Button",
      "path": "Path",
      "text": "Text",
      "image": "Image",
      "multipath": "Multi-Path",
      "multiclip": "Multi-Clip",
      "multitimeline": "Multi-Timeline",
      "multicanvas": "Multi-Canvas",
      "imageasset": "Image Asset",
      "soundasset": "Sound Asset",
      "multiassetmixed": "Multi-Asset",
      "multisoundasset": "Multi-Asset Sound",
      "multiimageasset": "Multi-Asset Image",
      "gradientfill": "Fill",
      "gradientstroke": "Stroke",
      "gradientstop": "Gradient Stop",
      "unknown": "",
    }
  }

  /*
   * What the panel is describing right now. The gradient tool reports its own sub-selection
   * — a fill, a stroke, an individual stop — which the project's selection never holds.
   */
  static currentSelectionType (props) {
    const activeTool = props.getActiveTool();
    return activeTool.name === 'gradienttool' ? activeTool.selectionType : props.getSelectionType();
  }

  /*
   * The context half of "context-aware": selecting something moves the panel to the tab that
   * can describe it. Clicking a tab by hand sticks, because nothing here fires until the
   * selection type actually changes — so you can sit on Frame while dragging shapes around
   * and the panel stays where you put it until you select a different kind of thing.
   *
   * getDerivedStateFromProps rather than componentDidUpdate because the selection type is not
   * a prop, it is the return of a prop function, so there is no previous value to diff against
   * — the previous value has to be kept here.
   */
  static getDerivedStateFromProps (props, state) {
    if(props.inspectorTabRequest !== state.lastTabRequest) {
      return {
        lastTabRequest: props.inspectorTabRequest,
        lastSelectionType: Inspector.currentSelectionType(props),
        tab: props.inspectorTab,
      };
    }

    const type = Inspector.currentSelectionType(props);
    if(type === state.lastSelectionType) return null;

    const owner = TAB_FOR_TYPE[type];
    return { lastSelectionType: type, tab: owner || state.tab };
  }

  /**
   * Returns the value of a requested selection attribute.
   * @param {string} attribute Selection attribute to retrieve.
   * @return {string|number|undefined} Value of the selection attribute to retrieve. Returns undefined if attribute does not exist.
   */
  getSelectionAttribute = (attribute) => {
    if (attribute === 'fillColorOpacity') {
      return this.getSelectionFillColorOpacity();
    }

    return this.props.getAllSelectionAttributes()[attribute];
  }

  /**
   * Returns the selection fill color opacity.
   * @return {number} fill color opacity from 0 to 1.
   */
  getSelectionFillColorOpacity = () => {
    return this.getSelectionAttribute('fillColor').alpha;
  }

  /**
   * Returns the value of a requested gradient tool attribute.
   * @param {string} attribute Gradient tool attribute to retrieve.
   * @return {string|number|undefined} Value of the attribute to retrieve. Returns undefined if attribute does not exist or gradient tool is inactive.
   */
  getGradientToolAttribute = (attribute) => {
    var activeTool = this.props.getActiveTool();
    if (activeTool.name === 'gradienttool') {
      return activeTool[attribute];
    }
    else {
      return undefined;
    }
  }

  /**
   * Sets the value of the selection fillColor opacity.
   * @param {number} value Fill color opacity from 0 to 1.
   */
  setSelectionFillColorOpacity = (value) => {
    var color = this.getSelectionAttribute('fillColor');
    color.alpha = value;
    this.setSelectionAttribute('fillColor', color);
  }

  /**
   * Updates the value of a selection attribute for the selected item in the editor.
   * @param {string} attribute Name of the attribute to update.
   * @param {string|number} newValue New value of the attribute to update.
   */
  setSelectionAttribute = (attribute, newValue) => {
    if (attribute === 'fillColorOpacity') {
      return this.setSelectionFillColorOpacity(newValue);
    }
    this.props.setSelectionAttribute(attribute, newValue);
  }

  /**
   * Updates the value of a gradient tool attribute.
   * @param {string} attribute Name of the gradient tool attribute to update.
   * @param {string|number} newValue New value of the attribute to update.
   */
  setGradientToolAttribute = (attribute, newValue) => {
    var activeTool = this.props.getActiveTool();
    if (activeTool.name === 'gradienttool') {
      activeTool[attribute] = newValue;
    }
  }

  // Inspector Row Types

  /**
   * Renders an inspector row allowing viewing and editing of the selection stroke width.
   */
  renderSelectionStrokeWidth = () => {
    return (
      <InspectorNumericSlider
        tooltip="Stroke Width"
        val={this.getSelectionAttribute('strokeWidth')}
        onChange={(val) => this.setSelectionAttribute('strokeWidth', val)}
        divider={false}
        inputProps={this.getSelectionInputProps('strokeWidth')}
        id="inspector-selection-stroke-width"/>
    )
  }

  /**
   * Renders an inspector row allowing viewing and editing of the selection fill color.
   */
  renderSelectionColor = () => {
    return (
      <div className={ITEM}>
        <InspectorColorNumericInput
          tooltip1="Fill"
          tooltip2="Opacity"
          val1={this.getSelectionAttribute('fillColor').toCSS()}
          onChange1={(col) => this.setSelectionAttribute('fillColor', col)}
          id={"inspector-selection-fill-color"}
          val2={this.getSelectionAttribute('fillColorOpacity')}
          onChange2={(val) => this.setSelectionAttribute('fillColorOpacity', val)}
          divider={false}
          colorPickerType={this.props.colorPickerType}
          changeColorPickerType={this.props.changeColorPickerType}
          updateLastColors={this.props.updateLastColors}
          lastColorsUsed={this.props.lastColorsUsed}
        />
        <InspectorColorNumericInput
          tooltip1="Stroke"
          tooltip2="Weight"

          val1={this.getSelectionAttribute('strokeColor').toCSS()}
          onChange1={(col) => this.setSelectionAttribute('strokeColor', col)}
          id={"inspector-selection-stroke-color"}
          stroke={true}

          val2={this.getSelectionAttribute('strokeWidth')}
          onChange2={(val) => this.setSelectionAttribute('strokeWidth', val)}
          divider={false}
          colorPickerType={this.props.colorPickerType}
          changeColorPickerType={this.props.changeColorPickerType}
          updateLastColors={this.props.updateLastColors}
          lastColorsUsed={this.props.lastColorsUsed}
        />
      </div>
    );
  }

  /**
   * Renders an inspector row allowing viewing and editing of the selected object's font.
   */
  renderFontFamily = () => {
    /*
     * `.font-selector-<Name>` classes carried the per-option font-family before; the Radix
     * swap moved that to an inline style (ui/select.jsx) and left 156 rules nobody read.
     * The one thing worth keeping is the tint on fonts already in the project, which that
     * swap dropped. It is a left marker now rather than a fill — a tinted row in a list of
     * 152 rows each set in its own face is one more thing competing for the eye.
     */
    let opts = this.props.fontInfoInterface.allFontNames.map(opt => ({
      value: opt,
      label: opt,
      style: { fontFamily: `'${opt}', Arial` },
      className: this.props.fontInfoInterface.isExistingFont(opt)
        ? 'border-l-2 border-l-ice-400'
        : 'border-l-2 border-l-transparent',
    }));

    return (
      <InspectorSelector
        className="font-family"
        value={this.getSelectionAttribute('fontFamily')}
        tooltip="Font Family"
        type="select"
        isSearchable={true}
        options={opts}
        // Nothing is fetched from Google until this opens. See Util/fontPreview.js.
        onOpenChange={(open) => { if (open) loadFontPreviews(this.props.fontInfoInterface.allFontNames); }}
        onChange={(val) => {
          let font = val.value;

          // Don't fetch the file if we already have it.
          if (this.props.fontInfoInterface.hasFont(val.value)) {
            this.setSelectionAttribute('fontFamily', font);
            return;
          }

          // Fetch the file if it's missing.
          this.props.fontInfoInterface.getFontFile({
            font: font,
            callback: blob => {
                var file = new File([blob], font+'.ttf', {type:'font/ttf'});
                this.props.importFileAsAsset(file, () => {
                  this.setSelectionAttribute('fontFamily', font)
                });
            },
            error: error => {
              console.error(error)
            }
          });

        }}>
        </InspectorSelector>
    )
  }

  renderFontStyle = () => {
    let options = [{value: 'normal', label: 'normal'}, {value: 'italic', label: 'italic'}]
    return (
      <InspectorSelector
        tooltip="Style"
        type="select"
        isSearchable={true}
        value={this.getSelectionAttribute('fontStyle')}
        options={options}
        onChange={(val) => {
          this.setSelectionAttribute('fontStyle', val.value);
        }} />
    )
  }

  renderFontWeight = () => {
    let fontWeights = [
      {label: 'thin', value: 100},
      {label: 'extra light', value: 200},
      {label: 'light', value: 300},
      {label: 'normal', value: 400},
      {label: 'medium', value: 500},
      {label: 'semi bold', value: 600},
      {label: 'bold', value: 700},
      {label: 'extra bold', value: 800},
      {label: 'black', value: 900},
    ];

    let weight = Math.min(Math.max(this.getSelectionAttribute('fontWeight'), 100), 900);

    return (
      <InspectorSelector
        tooltip="Weight"
        type="select"
        isSearchable={true}
        value={weight}
        options={fontWeights}
        onChange={(val) => {
          let newWeight = val.value || 400;
          this.setSelectionAttribute('fontWeight', newWeight);
        }} />
    )
  }

  /**
   * Renders an inspector row allowing viewing and editing of the selection font size.
   */
  renderFontSize = () =>  {
    return (
      <InspectorNumericInput
        tooltip="Font Size"
        val={this.getSelectionAttribute('fontSize')}
        onChange={(val) => this.setSelectionAttribute('fontSize', val)} />
    )
  }

  /**
   * Renders an inspector row allowing viewing and editing of the selection's name.
   */
  renderName = () => {
    return (
      <div className={ITEM}>
        <InspectorTextInput
          tooltip="Name"
          val={this.getSelectionAttribute('name')}
          onChange={(val) => {this.setSelectionAttribute('name', val);}}
          placeholder="no_name"
          id="inspector-name" />
      </div>
    );
  }

  /**
   * Renders an inspector row allowing viewing and editing of a selection's identifier
   */
  renderIdentifier = () => {
    return (
      <div className={ITEM}>
        <InspectorTextInput
          tooltip="Name"
          val={this.getSelectionAttribute('identifier')}
          onChange={(val) => {this.setSelectionAttribute('identifier', val);}}
          placeholder="no_name"
          id="inspector-name" />
      </div>
    );
  }

  /**
   * Renders an inspector row allowing viewing of the selection's file name.
   */
  renderFilename = () => {
    return (
      <div className={ITEM}>
        <InspectorTextInput
          tooltip="File"
          val={this.getSelectionAttribute('filename')}
          readOnly={true}
          id="inspector-file-name"/>
      </div>
    );
  }

  /**
   * Renders an inspector row allowing viewing of the selection's src image.
   */
  renderAssetPreview = () => {
    let selectionType = this.props.getSelectionType();
    if(selectionType === 'imageasset') {
      return (
        <InspectorImagePreview
          src={this.getSelectionAttribute('src')}
          id="inspector-image-preview" />
      );
    } else if (selectionType === 'soundasset') {
      return (
        <InspectorSoundPreview
          src={this.getSelectionAttribute('src')}
          id="inspector-sound-preview" />
      );
    }
  }

  /**
   * Renders an inspector row allowing viewing and editing of the selection's frame length.
   */
  renderFrameLength = () => {
    return (
      <div className={ITEM}>
        <InspectorNumericInput
          tooltip="Length"
          val={this.getSelectionAttribute('frameLength')}
          onChange={(val) => this.setSelectionAttribute('frameLength', val)}
          id="inspector-frame-length" />
      </div>
    )
  }

  /**
   * Renders an inspector row allowing viewing and editing of the selection's x y position.
   */
  renderPosition = () => {
    return (
      <InspectorDualNumericInput
        tooltip1="Origin X"
        tooltip2="Origin Y"
        val1={this.getSelectionAttribute('originX')}
        val2={this.getSelectionAttribute('originY')}
        onChange1={(val) => this.setSelectionAttribute('originX', val)}
        onChange2={(val) => this.setSelectionAttribute('originY', val)}
        id="inspector-origin" />
    )
  }

  /**
   * Renders an inspector row allowing viewing and editing of the selection's origin x y position.
   */
  renderOrigin = () => {
    return (
      <InspectorDualNumericInput
        tooltip1="X"
        tooltip2="Y"
        val1={this.getSelectionAttribute('x')}
        val2={this.getSelectionAttribute('y')}
        onChange1={(val) => this.setSelectionAttribute('x', val)}
        onChange2={(val) => this.setSelectionAttribute('y', val)}
        id="inspector-position" />
    )
  }

  /**
   * Renders an inspector row allowing viewing and editing of the selection's width and height.
   */
  renderSize = () => {
    return (
      <InspectorDualNumericInput
        tooltip1="Width"
        tooltip2="Height"
        val1={this.getSelectionAttribute('width')}
        val2={this.getSelectionAttribute('height')}
        onChange1={(val) => this.setSelectionAttribute('width', val)}
        onChange2={(val) => this.setSelectionAttribute('height', val)}
        id="inspector-size" />
    )
  }

  /**
   * Renders an inspector row allowing viewing and editing of the selection's scaleX and scaleY.
   */
  renderScale = () => {
    return (
      <InspectorDualNumericInput
        tooltip1="Scale W"
        tooltip2="Scale H"
        val1={this.getSelectionAttribute('scaleX')}
        val2={this.getSelectionAttribute('scaleY')}
        onChange1={(val) => this.setSelectionAttribute('scaleX', val)}
        onChange2={(val) => this.setSelectionAttribute('scaleY', val)}
        id="inspector-scale" />
    )
  }

  /**
   * Renders an inspector row allowing viewing and editing of the selection's rotation.
   */
  renderRotation = () => {
    return (
      <InspectorNumericInput
        tooltip="Rotation"
        val={this.getSelectionAttribute('rotation')}
        onChange={(val) => this.setSelectionAttribute('rotation', val)}
        id="inspector-rotation" />
    )
  }

  renderClipSkew = () => {
    return (
      <InspectorNumericInput
        tooltip="Clip Skew"
        val={this.getSelectionAttribute('skew')}
        onChange={(val) => this.setSelectionAttribute('skew', val)}
        id="inspector-clip-skew" />
    )
  }

  /**
   * Renders an inspector row allowing viewing and editing of the selection's opacity.
   */
  renderOpacity = () => {
    return (
      <InspectorNumericSlider
        tooltip="Opacity"
        val={this.getSelectionAttribute('opacity')}
        onChange={(val) => this.setSelectionAttribute('opacity', val)}
        divider={false}
        inputProps={{min: 0, max: 1, step: 0.01}}
        id="inspector-opacity"/>
    )
  }

  /**
   * Renders an inspector row allowing viewing and editing of all transformation properties
   * icluding position, scale, size, rotation and opacity.
   */
  renderSelectionTransformProperties = () => {
    return (
      <div className={ITEM}>
        {this.renderPosition()}
        {this.renderOrigin()}
        {this.renderSize()}
        {this.renderScale()}
        {this.renderRotation()}
        {this.renderOpacity()}
      </div>
    )
  }

  /**
   * Renders an inspector row for a single clip that includes its skew.
   */
  renderSingleClipTransformProperties = () => {
    return (
      <div className={ITEM}>
        {this.renderPosition()}
        {this.renderOrigin()}
        {this.renderSize()}
        {this.renderScale()}
        {this.renderRotation()}
        {this.renderClipSkew()}
        {this.renderOpacity()}
      </div>
    )
  }

  /**
   * Renders an inspector row allowing viewing and editing of sound assets attached to the
   * current object.
   */
  renderSelectionSoundAsset = (get, set) => {
    let options = [{
      value: null,
      label: "No Sound"
    }]

    let mapAsset = asset => {
      if (!asset) {
        return {
          value: "novalue",
          label: "No Sound",
        }
      }
      return {
        value: asset,
        label: asset.name,
      }
    }

    options = options.concat(this.props.getAllSoundAssets().map(mapAsset));

    let value = get('sound');
    return (
      <InspectorSelector
        tooltip="Sound"
        type="select"
        options={options}
        value={value}
        isSearchable={true}
        onChange={(val) => {set('sound', val.value)}} />
    );
  }

  renderSelectionSoundVolume = (get, set) => {
    return (
      <InspectorNumericInput
        tooltip="Volume"
        val={get('soundVolume')}
        onChange={(val) => {set('soundVolume', val)}}
        id="inspector-sound-volume" />
    )
  }

  renderSelectionSoundStart = (get, set) => {
    return (
      <InspectorNumericInput
        tooltip="Start (ms)"
        type="numeric"
        val={get('soundStart')}
        onChange={(val) => {set('soundStart', val)}} />
    )
  }

  /*
   * The same three rows whether the frame is selected or merely under the playhead — the
   * Frame tab shows sound in both states, and a frame's sound does not become a different
   * property depending on how you reached it. Defaults to the selection, which is every
   * caller but that one.
   */
  renderSoundContent = (get = this.getSelectionAttribute, set = this.setSelectionAttribute) => {
    return (
      <div className={ITEM}>
        {this.renderSelectionSoundAsset(get, set)}
        {get('sound') && this.renderSelectionSoundVolume(get, set)}
        {get('sound') && this.renderSelectionSoundStart(get, set)}
      </div>
    )
  }

  renderAnimationType = () => {
    return (
      <div className={ITEM}>
        <InspectorSelector
          tooltip="Animation"
          type="select"
          options={this.props.getClipAnimationTypes()}
          value={this.getSelectionAttribute('animationType')}
          isSearchable={true}
          onChange={(val) => {this.setSelectionAttribute('animationType', val.value)}} />
          {
            this.getSelectionAttribute('singleFrameNumber') &&
            <InspectorNumericInput
            tooltip="Frame"
            val={this.getSelectionAttribute('singleFrameNumber')}
            onChange={(val) => this.setSelectionAttribute('singleFrameNumber', val)} />
          }
        {this.getSelectionAttribute('animationType') !== "single" &&
        <InspectorCheckbox
          tooltip="Synced" 
          checked={this.getSelectionAttribute('isSynced')}
          onChange={(val) => this.setSelectionAttribute('isSynced', !this.getSelectionAttribute('isSynced'))}/>}
      </div>
    )
  }

  renderTweenEasingType = () => {
    let options = window.Wick.Tween.VALID_EASING_TYPES;
    let optionLabels = [];
    options.forEach((option) => {
      optionLabels.push({label: option, value: option});
    })
    return (
      <div className={ITEM}>
        <InspectorSelector
          tooltip="Easing Type"
          type="select"
          options={optionLabels}
          value={this.getSelectionAttribute('easingType')}
          isSearchable={true}
          onChange={(val) => {this.setSelectionAttribute('easingType', val.value)}} />
      </div>
    );
  }

  /*
   * Sits under the dropdown rather than replacing it. The named curves are presets worth
   * keeping and they are what a .wick has always been able to say; the graph is what makes
   * them legible and what lets you draw one that is not on the list.
   */
  renderTweenCurve = () => {
    let curve = this.props.getSelectedTweenCurve();
    if(!curve) return null;
    return (
      <div className={ITEM}>
        <InspectorEasingCurve
          easingType={curve.easingType}
          bezier={curve.bezier}
          onChange={this.props.setSelectedTweenCurve}
          onEdit={() => this.setSelectionAttribute('easingType', 'custom')}
          onSmooth={this.props.autoSmoothSelectedTweens} />
      </div>
    );
  }

  renderTweenFullRotations = () => {
    return (
      <div className={ITEM}>
        <InspectorNumericInput
          tooltip="Full Rotations"
          val={this.getSelectionAttribute('fullRotations')}
          onChange={(val) => this.setSelectionAttribute('fullRotations', val)}
          id="inspector-full-rotation" />
      </div>
    );
  }
  
   renderTweenMethod = () => {
    return (
      <div className={ITEM}>
        <InspectorCheckbox
          tooltip="Skew Rotate" 
          checked={this.getSelectionAttribute('tweenMethod') === 'skew'}
          onChange={(val) => this.setSelectionAttribute(
            'tweenMethod',
            (this.getSelectionAttribute('tweenMethod') === 'skew') ? 'normal' : 'skew'
          )}/>
      </div>
    );
  }

  renderGradientEndpointProperties = () => {
    return (
      <div className={ITEM}>
        <InspectorSelector
          tooltip="Type"
          type="select"
          options={[{label: 'linear', value: 'linear'}, {label: 'radial', value: 'radial'}]}
          value={this.getGradientToolAttribute('gradientType')}
          isSearchable={true}
          onChange={(val) => {this.setGradientToolAttribute('gradientType', val.value)}} />
        <InspectorDualNumericInput
          tooltip1="Start X"
          tooltip2="Start Y"
          val1={this.getGradientToolAttribute('originX')}
          val2={this.getGradientToolAttribute('originY')}
          onChange1={(val) => this.setGradientToolAttribute('originX', val)}
          onChange2={(val) => this.setGradientToolAttribute('originY', val)}
          id="inspector-gradient-tool-origin" />
        <InspectorDualNumericInput
          tooltip1="End X"
          tooltip2="End Y"
          val1={this.getGradientToolAttribute('destinationX')}
          val2={this.getGradientToolAttribute('destinationY')}
          onChange1={(val) => this.setGradientToolAttribute('destinationX', val)}
          onChange2={(val) => this.setGradientToolAttribute('destinationY', val)}
          id="inspector-gradient-tool-destination" />
        <InspectorNumericInput
          tooltip="Angle"
          val={this.getGradientToolAttribute('lineAngle')}
          onChange={(val) => this.setGradientToolAttribute('lineAngle', val)}
          id="inspector-gradient-tool-line-angle" />
      </div>
    )
  }

  renderGradientStopProperties = () => {
    return (
      <div className={ITEM}>
        <InspectorColorNumericInput
          tooltip1="Color"
          tooltip2="Opacity"
          val1={this.getGradientToolAttribute('stopColor').toCSS()}
          onChange1={(col) => this.setGradientToolAttribute('stopColor', col)}
          id={"inspector-gradient-stop-color"}
          val2={this.getGradientToolAttribute('stopOpacity')}
          onChange2={(val) => this.setGradientToolAttribute('stopOpacity', val)}
          divider={false}
          colorPickerType={this.props.colorPickerType}
          changeColorPickerType={this.props.changeColorPickerType}
          updateLastColors={this.props.updateLastColors}
          lastColorsUsed={this.props.lastColorsUsed}
        />
        <InspectorNumericInput
          tooltip="Offset"
          val={this.getGradientToolAttribute('stopOffset')}
          onChange={(val) => this.setGradientToolAttribute('stopOffset', val)}
          id="inspector-gradient-tool-stop-offset" />
      </div>
    )
  }

  // Selection contents and properties

  /**
   * Renders the inspector view for all properties of a frame.
   */
  renderFrame = () => {
    return (
        <div className="inspector-content">
          {this.renderIdentifier()}
          {this.renderFrameLength()}
          {this.renderSoundContent()}
        </div>
    );
  }

  /**
   * Renders the inspector view for all properties of a layer.
   */
  renderLayer = () => {
    return  (
      <div className="inspector-content">
        {this.renderName()}
        {this.renderOpacity()}
      </div>
    )
  }

  /**
   * Renders the inspector view for all properties of a multi-frame selection.
   */
  renderMultiFrame = () => {
    return ( <div className="inspector-content" /> );
  }

  /** 
   * Renders the inspector view for all properties of a multi-layer selection.
   */
  renderMultiLayer = () => {
    return ( <div className="inspector-content" /> )
  }

  /**
   * Renders the inspector view for all properties of a multi-clip selection.
   */
  renderMultiClip = () => {
    return ( <div className="inspector-content" /> );
  }

  /**
   * Renders the inspector view for all properties of a tween selection.
   */
  renderTween = () =>  {
    return (
      <div className="inspector-content">
        {this.renderTweenEasingType()}
        {this.renderTweenCurve()}
        {this.renderTweenFullRotations()}
        {this.renderTweenMethod()}
      </div>
     );
  }

  /**
   * Renders the inspector view for all properties of a multi-tween selection.
   */
  renderMultiTween = () => {
    return ( <div className="inspector-content">
      {this.renderTweenEasingType()}
      {this.renderTweenCurve()}
      {this.renderTweenFullRotations()}
    </div> );
  }

  /**
   * Renders the inspector view for all properties of a selection with group properties.
   */
  renderGroupContent = () => {
    return (
      <div className="inspector-content">
        {this.renderIdentifier()}
        {this.renderSelectionTransformProperties()}
      </div>
    );
  }

  /**
   * Renders the inspector view for all properties of a group selection.
   */
  renderGroup = () => {
    return ( this.renderGroupContent() );
  }

  /**
   * Renders the inspector view for all properties of a multi-group selection.
   */
  renderMultiGroup = () => {
    return ( this.renderGroupContent() );
  }

  /**
   * Renders the inspector view for all properties of a clip selection.
   */
  renderClip = () => {
    return (
      <div className="inspector-content">
        <InspectorFramePicker
          project={this.props.project}
          isSingleFrame={this.getSelectionAttribute('animationType') === "single"}
          getActive={() => this.getSelectionAttribute('singleFrameNumber')}
          onChange={(val) => this.setSelectionAttribute('singleFrameNumber', val)} />
        {this.renderIdentifier()}
        {this.renderSingleClipTransformProperties()}
      </div>
    );
  }

  /**
   * Renders the inspector view for all properties of a button selection.
   */
  renderButton = () => {
    return ( this.renderGroupContent() );
  }

  renderFontContent = () => {
    return (
      <div className={ITEM}>
        {this.renderFontFamily()}
        {this.renderFontStyle()}
        {this.renderFontWeight()}
        {this.renderFontSize()}
      </div>
    )
  }

  /**
   * Renders the inspector view for all properties of a selection with path properties.
   */
  renderPathContent = () => {
    return(
      <div className="inspector-content">
        {this.renderSelectionTransformProperties()}
        {this.renderSelectionColor()}
      </div>
    );
  }

  /**
   * Renders the inspector view for all properties of a path selection.
   */
  renderPath = () => {
    return ( this.renderPathContent() );
  }

  /**
   * Renders the inspector view for all text properties.
   */
  renderText = () => {
    return (
      <div className="inspector-content">
        {this.renderIdentifier()}
        {this.renderSelectionTransformProperties()}
        {this.renderSelectionColor()}
        {this.renderFontContent()}
      </div>
    )
  }

  /**
   * Renders the inspector view for clip animation type.
   */
  renderAnimationSetting = () => {
    return (
      <div className="inspector-content">
        {this.renderAnimationType()}
      </div>
    );
  }

  /**
   * Renders the inspector view for all image properties.
   */
  renderImage = () => {
    return (
      <div className="inspector-content">
        {this.renderSelectionTransformProperties()}
      </div>
    )
  }

  /**
   * Renders the inspector view for all properties of a multi-path selection.
   */
  renderMultiPath = () => {
    return (
      <div className="inspector-content">
        {this.renderSelectionTransformProperties()}
        {this.renderSelectionColor()}
        {this.getSelectionAttribute('fontFamily') && this.renderFontContent()}
      </div>
    );
  }

  /**
   * Renders the inspector view for all properties of a multi-canvas selection.
   */
  renderMultiCanvas = () => {
    return ( this.renderSelectionTransformProperties() )
  }

  /**
   * Renders the inspector view for all properties of a multi-timeline selection.
   */
  renderMultiTimeline = () => {
    return (
      <div>
      </div>
    )
  }

  /**
   * Renders the inspector view for all properties of an asset selection.
   */
  renderAsset = () => {
    return (
      <div className="inspector-content">
        {this.renderName()}
        {this.renderFilename()}
        {this.renderAssetPreview()}
      </div>
    )
  }

  /**
   * Renders the inspector view for all properties of a gradient target selection.
   */
  renderGradientTarget = () => {
    return (
      <div className="inspector-content">
        {this.renderGradientEndpointProperties()}
      </div>
    )
  }

  /**
   * Renders the inspector view for all properties of a gradient stop selection.
   */
  renderGradientStop = () => {
    return (
      <div className="inspector-content">
        {this.renderGradientStopProperties()}
      </div>
    )
  }

  /**
   * The frame under the playhead, when nothing in the timeline is selected.
   *
   * This is what the Frame tab is for. Every other view in this panel describes the
   * selection, and the selection holds one thing — so before the tabs, a clip on the canvas
   * and the frame it sits in were mutually exclusive questions. There is always a frame under
   * the playhead, so this tab is answerable at any moment, and it stays answerable while you
   * work on the canvas.
   *
   * No script row, unlike the selected-frame view. Scripts come through
   * getSelectedObjectScript, which reads the selection — the one thing this view is defined
   * by not having. Clicking the frame in the timeline is how you get to its code, and that
   * also switches this tab to the selection-driven rows.
   */
  renderPlayheadFrame = () => {
    const context = this.props.getFrameContext();
    if(!context || !context.frame) {
      return (
        <PanelEmpty>
          No frame on this layer at the playhead. Add one in the timeline.
        </PanelEmpty>
      );
    }

    const {frame, layer} = context;
    const get = (attribute) => frame[attribute];
    const set = (attribute, value) => this.props.setActiveFrameAttribute(attribute, value);

    return (
      <div className="inspector-content">
        {/* Length is held rather than applied per keystroke, and this row is the sharpest
            case for it: typing 30 passes through 3, a 3-frame frame does not reach a playhead
            at 4, and the row deletes its own subject mid-word. See InspectorDraft. */}
        <InspectorDraft
          className={ITEM}
          values={{ identifier: frame.identifier, length: frame.length }}
          onCommit={(draft) => this.props.setActiveFrameProperties(draft)}>
          {(draft, edit) => (
            <>
              <InspectorTextInput
                tooltip="Name"
                val={draft.identifier}
                onChange={edit('identifier')}
                placeholder="no_name" />
              <InspectorNumericInput
                tooltip="Length"
                val={draft.length}
                onChange={edit('length')} />
            </>
          )}
        </InspectorDraft>
        {this.renderSoundContent(get, set)}
        {layer &&
          <div className={ITEM}>
            <InspectorTextInput
              tooltip="Layer"
              val={layer.name}
              onChange={(val) => this.props.setActiveLayerAttribute('name', val)}
              id="inspector-active-layer-name" />
            <InspectorNumericSlider
              tooltip="Opacity"
              val={layer.opacity}
              onChange={(val) => this.props.setActiveLayerAttribute('opacity', val)}
              divider={false}
              inputProps={{min: 0, max: 1, step: 0.01}}
              id="inspector-active-layer-opacity" />
          </div>}
      </div>
    );
  }

  /**
   * Renders a default selection view with no properties.
   */
  renderUnknown = () => {
    return (
      <div>
        <div className="inspector-content">
        </div>
      </div>
    )
  }

  /**
   * Renders the proper view for the given selection type.
   * @param   {string} selectionType A string representation of the selection to display.
   * @returns {Component} JSX component to render.
   */
  renderDisplay = (selectionType) => {
    let renderFunction = null;

    if (selectionType in this.inspectorContentRenderFunctions) {
      renderFunction = this.inspectorContentRenderFunctions[selectionType];
    } else {
      renderFunction = this.renderUnknown;
    }

    return (
      renderFunction()
    );
  }

  /**
   * Renders a single action button for a given editor action.
   * @param {object} btn editor action with action, icon, color, and tooltip text properties.
   * @param {number} i unique key to be applied to returned object.
   * @returns {Component} JSX component to render.
   */
  renderActionButton = (action, i) => {
    return (
      <div key={i} className={ITEM}>
        <InspectorActionButton
          action={action} />
      </div>
    );
  }

  /**
   * Renders all actions for the current selection.
   * @param {string} selectionType The selection type to show actions.
   * @returns {Component} JSX component containing all the actions for the current selection.
   */
  renderActions = (selectionType) => {
    let actions = [];

    Object.keys(this.actionRules).forEach(action => {
        let actionList = this.actionRules[action];
        if (actionList.indexOf(selectionType) > -1) actions.push(action);
    });

    return(
      <div className="inspector-content">
        {actions.map((action, i) => {
            return this.renderActionButton(this.props.editorActions[action], i);
          })}
      </div>
    )
  }

  /**
   * Renders an edit script window if a script exists for the selected object.
   * @returns {Component} JSX component containing script window.
   */
  renderScripts = () => {
    return (
      <div className={ITEM}>
        <InspectorScriptWindow
          script={this.props.script}
          deleteScript={this.props.deleteScript}
          editScript={this.props.editScript}
          scriptInfoInterface={this.props.scriptInfoInterface}
        />
      </div>
    );
  }

  /**
   * Renders the inspector title for the current selection.
   * @param {string} context what the active tab is describing, shown beside the panel label.
   */
  renderTitle = (context) => {
    return <InspectorTitle context={context} />;
  }

  /*
   * The Object tab: the selection, when the selection is something on the stage or in the
   * library. Everything here was the whole panel before the tabs.
   *
   * A column of flat colour is what it showed whenever nothing was selected, which on a
   * fresh project is the state you first meet it in. It reads as broken. Saying what it is
   * waiting for costs one line and makes the panel legible while idle.
   */
  renderObjectTab = (selectionType, gradient) => {
    if (TAB_FOR_TYPE[selectionType] !== 'object') {
      return <PanelEmpty>Select something on the stage to see its properties here.</PanelEmpty>;
    }

    return (
      <>
        {this.renderDisplay(selectionType)}
        {this.renderActions(selectionType)}
        {!gradient && this.props.selectionIsScriptable() && this.renderScripts()}
        {!gradient && selectionType === 'clip' && this.renderAnimationSetting()}
      </>
    );
  }

  /*
   * The Frame tab: a selected frame, tween or layer if there is one, and otherwise the frame
   * under the playhead. Both halves are the timeline's properties; which one you get depends
   * only on whether you clicked in the timeline, and the fallback is what makes the tab worth
   * having — see renderPlayheadFrame.
   */
  renderFrameTab = (selectionType) => {
    if (TAB_FOR_TYPE[selectionType] !== 'frame') return this.renderPlayheadFrame();

    return (
      <>
        {this.renderDisplay(selectionType)}
        {this.renderActions(selectionType)}
        {this.props.selectionIsScriptable() && this.renderScripts()}
      </>
    );
  }

  render () {
    const activeTool = this.props.getActiveTool();
    const gradient = activeTool.name === 'gradienttool';
    const selectionType = Inspector.currentSelectionType(this.props);
    const tab = this.state.tab;
    const frameContext = this.props.getFrameContext();

    /*
     * The rail's second line names what THIS TAB is showing, not what is selected — on the
     * Document tab a selected path is not what the panel is describing, and saying "Path"
     * there would be a caption for the wrong picture.
     *
     * 'unknown' is what the engine reports for an empty selection, and it is a key in
     * inspectorTitles mapped to the empty string, so a membership test alone reads it as a
     * real type.
     */
    const context = {
      object: this.inspectorTitles[selectionType] || null,
      frame: TAB_FOR_TYPE[selectionType] === 'frame'
        ? this.inspectorTitles[selectionType]
        : (frameContext ? `Frame ${frameContext.playheadPosition}` : null),
      document: this.props.getProjectSettings().name,
    }[tab];

    return (
      <div
        className="flex h-full w-full flex-col overflow-hidden border-r border-line bg-surface font-ui"
        aria-label="Inspector Panel"
      >
        {this.renderTitle(context)}
        <InspectorTabs
          tabs={TABS}
          active={tab}
          onSelect={(id) => this.setState({ tab: id })} />
        <div
          role="tabpanel"
          id={`inspector-tabpanel-${tab}`}
          aria-labelledby={`inspector-tab-${tab}`}
          className="min-h-0 w-full flex-1 overflow-hidden hover:overflow-y-auto"
        >
          {tab === 'object' && this.renderObjectTab(selectionType, gradient)}
          {tab === 'frame' && this.renderFrameTab(selectionType)}
          {tab === 'document' &&
            <InspectorDocument
              className={ITEM}
              settings={this.props.getProjectSettings()}
              onCommit={this.props.updateProjectSettings} />}
        </div>
      </div>
    );
  }
}

export default Inspector
