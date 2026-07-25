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

import React, { useState, useRef } from 'react';
import { PanelGroup, Panel, PanelSeparator } from '@/ui/resizable'
import WickInput from 'Editor/Util/WickInput/WickInput';
import { Rnd } from 'react-rnd';
import ActionButton from 'Editor/Util/ActionButton/ActionButton';
import AddScriptPanel from './AddScriptPanel/AddScriptPanel';
import { Console } from 'console-feed'

import { CodeEditor, CODE_THEMES, normalizeTheme } from '@/ui/code-editor';

import 'Editor/styles/PopOuts/_wickcodeeditor.css';

import capitalize from 'Editor/Util/DataFunctions/capitalize';
import ToolIcon from '../../Util/ToolIcon/ToolIcon';

const editorThemes = CODE_THEMES;
import classNames from 'classnames';
export default function WickCodeEditor(props) {

  const [addScriptTab, setAddScriptTab] = useState('Mouse');
  const [consoleType, setConsoleType] = useState('console');
  const codeEditor = useRef(null);

  /**
   * To be called when the code editor popout is repositioned.
   */
  function onDragHandler(e, d) {
    props.updateCodeEditorWindowProperties({
      x: d.x,
      y: d.y,
    });
  }

  /**
   * To be called when the code editor popout is resized.
   */
  function onResizeHandler(e, dir, ref, delta, position) {
    props.updateCodeEditorWindowProperties({
      width: ref.style.width,
      height: ref.style.height,
    });
  }

  /**
   * To run when the console is resized. Should update
   * the size of the console in the main editor.
   * @param {object} console 
   */
  function resizeConsole(panelSize) {
    props.updateCodeEditorWindowProperties({
      consoleHeight: panelSize.inPixels,
    });
  }

  /**
   * Adds a script to the currently selected object.
   */
  function addScript(scriptName) {
    if (!props.script) return;

    props.script.addScript(scriptName);
    props.editScript(scriptName);
  }

  /**
   * To run when the script changes.
   * @param {script} newScript - New script to change. 
   */
  function scriptOnChange(newScript) {
    if (props.script) {
      props.requestAutosave();
      props.script.updateScript(props.scriptToEdit, newScript);
      props.onScriptUpdate(newScript);
    }
  }


  /**
   * Clears the console in the code editor.
   */
  function clearConsole() {
    props.setConsoleLogs([]);
  }

  // Sort scripts if needed.
  props.script && props.script.scripts.sort(props.scriptInfoInterface.sortScripts);

  /**
   * Adds code to the currently accessed code tab at the current cursor position.
   * @param {string} code to add to tab.
   */
  function addCodeToTab(code) {
    if (props.script && props.scriptToEdit !== "add") {
      codeEditor.current?.insertAtCursor(code);
    }
  }

  /**
   * Sets code editor font size. 
   * @param {*} size 
   */
  function setCodeEditorFontSize(size) {
    props.updateCodeEditorWindowProperties({
      fontSize: size,
    })
  }

  /**
   * Renders all code editor options.
   */
  function renderCodeEditorOptions() {
    return <div className="we-code-options-panel">

      <table>
        <tbody>
          <tr>
            <th>Option</th>
            <th></th>
          </tr>
          <tr>
            <td>Font Size</td>
            <td> <WickInput
              className="code-editor-option-input"
              id="code-editor-font"
              type="numeric"
              value={props.codeEditorWindowProperties.fontSize}
              onChange={(val) => { setCodeEditorFontSize(val) }}
            /></td>
          </tr>
          <tr>
            <td>Editor Style</td>
            {/* Was a bare <select> with `selected=` on it, which React ignores — so the
                dropdown always read as the first theme no matter what was stored. Passing
                the value through normalizeTheme also means a project saved with one of the
                five ace theme names shows the theme it actually gets. */}
            <td> <WickInput
              className="code-editor-option-input"
              id="code-editor-theme"
              type="select"
              options={editorThemes}
              value={normalizeTheme(props.codeEditorWindowProperties.theme)}
              onChange={(option) => {
                props.updateCodeEditorWindowProperties({ theme: option.value })
              }}
            /></td>
          </tr>
        </tbody>
      </table>
    </div>
  }


  // Determine the script to display.
  let scriptToShow = 'No Scriptable Object Selected';
  if (props.script) {

    let script = props.script.scripts.find(s => s.name === props.scriptToEdit);
    if (script) {
      scriptToShow = script.src;
    } else {
      scriptToShow = "Can't Find Script...";
    }
  }

  function renderCodeTabs () {
    return (
      <div className="wick-code-editor-tabs">
            {props.script && props.script.scripts.map(script => {
              return <button
                key={"script-tab-" + script.name}
                onClick={() => {
                  props.editScript(script.name)
                  props.clearCodeEditorError();
                }}

                className={classNames("we-code-script-button",
                  "we-event",
                  props.scriptInfoInterface.getScriptType(script.name),
                  { selected: props.scriptToEdit === script.name })}
              >
                {capitalize(script.name)}
              </button>
            })}
            {props.script && <button
              onClick={() => {
                props.editScript('add')
                props.clearCodeEditorError();
              }}
              className={classNames("we-code-script-button", "we-code-add")}
            >
              +
            </button>}
          </div>
    )
  }


  function renderCodeEditor () {
    return (
      <div className={classNames("wick-code-editor-code", 'theme' + props.codeEditorWindowProperties.theme)}>
      {
        props.scriptToEdit === 'add' &&
        <AddScriptPanel
          availableScripts={props.script && props.script.getAvailableScripts()}
          scripts={props.scriptInfoInterface.scriptData.filter(script => script.type === addScriptTab)}
          changeTab={(tab) => setAddScriptTab(tab)}
          addScript={addScript}
          addScriptTab={addScriptTab}
        />
      }
      {
        props.scriptToEdit !== 'add' &&
        <CodeEditor
          ref={codeEditor}
          className="wick-code-editor-surface"
          value={scriptToShow}
          theme={props.codeEditorWindowProperties.theme}
          fontSize={props.codeEditorWindowProperties.fontSize}
          onChange={scriptOnChange}
          error={props.error}
          readOnly={!props.script}
        />
      }
    </div>
    )
  }

  return (
    <Rnd
      id="wick-code-editor-resizeable"
      bounds="window"
      dragHandleClassName="wick-code-editor-drag-handle"
      minWidth={props.codeEditorWindowProperties.minWidth}
      minHeight={props.codeEditorWindowProperties.minHeight}
      onResizeStop={onResizeHandler}
      onDragStop={onDragHandler}
      default={props.codeEditorWindowProperties}
    >

      <div className="wick-code-editor-drag-handle">
        <div className="wick-code-editor-icon">{"</>"}</div>
        <div className="we-code-editor-title">
          Code Editor | 
          { !props.error && <div className="we-code-editor-title-selected">
            {`editing ${props.selectionType}`}
            </div>
          } 
          { props.error && <div className="we-code-editor-title-error">
                {`error - line ${props.error.lineNumber}`}
              </div>
          }
        </div>
        <ActionButton
          className="we-code-close-button"
          color="tool"
          icon="cancel-white"
          action={props.toggleCodeEditor} />
      </div>

      <div className="wick-code-editor-body">
        <div className="wick-code-editor-reference">
          <CodeReference
            referenceItems={props.scriptInfoInterface.referenceItems}
            addCodeToTab={addCodeToTab} />
        </div>
        <div className="wick-code-editor-content">
          {renderCodeTabs()}
          {/* Code above, console below — a vertical separator in v4's naming. */}
          <PanelGroup orientation="vertical">
            <Panel minSize={60}>
              {renderCodeEditor()}
            </Panel>

            <PanelSeparator/>

            <Panel
              id="console"
              minSize={40}
              defaultSize={props.codeEditorWindowProperties.consoleOpen ? props.codeEditorWindowProperties.consoleHeight : 1}
              groupResizeBehavior="preserve-pixel-size"
              onResize={resizeConsole}>
              <div className="wick-code-editor-console">

                <div className="we-code-console-bar">
                  <div className="we-code-console-title">{consoleType === 'options' ? 'Text Editor Options' : 'Console'}</div>
                  <div className="we-code-console-options-container">
                    {
                      consoleType === 'options' &&
                      <ActionButton
                        className="we-code-console-option"
                        id="console-console-button"
                        icon="codeConsole"
                        action={() => { setConsoleType('console') }}
                        tooltip="Show Console"
                        tooltipPlace="left"
                        color='tool' />
                    }

                    {
                      consoleType === 'console' &&
                      <ActionButton
                        className="we-code-console-option"
                        id="console-option-button"
                        icon="gear"
                        action={() => { setConsoleType('options') }}
                        tooltip="Show Options"
                        tooltipPlace="left"
                        color='tool' />
                    }

                    {
                      consoleType === 'console' &&
                      <ActionButton
                        className="we-code-console-option we-code-clear-console"
                        id="clear-console-button"
                        icon="clear"
                        action={clearConsole}
                        tooltip="Clear Console"
                        tooltipPlace="left"
                        color='tool' />
                    }
                  </div>

                </div>

                {consoleType === 'console' && <Console logs={props.consoleLogs} variant="dark"/>}
                {consoleType === 'options' && renderCodeEditorOptions()}
              </div>
            </Panel>
          </PanelGroup>
        </div>
      </div>

    </Rnd>
  )
}

/**
 * Interactive code reference
 */
function CodeReference(props) {
  const [selected, setSelected] = useState('');

  let referenceKeys = Object.keys(props.referenceItems);

  let codeOptions = props.referenceItems[selected];

  function renderChoices() {
    return (
      referenceKeys.map(refKey => {
        return <button
          key={"code-reference-button-" + refKey}
          className={classNames("reference-button", "we-code", refKey)}
          onClick={() => setSelected(refKey)}
        >
          <ToolIcon name={'code' + refKey} className="reference-icon" />
          <div className="reference-button-title">{refKey}</div>
        </button>
      })
    )
  }

  function renderCodeOptions(referenceKey) {
    return (
      <div
        className="we-code-options"
      >
        <div className="we-code-options-body">
          {/* Interactive Reference Buttons */}
          {codeOptions.map(option =>
            <div
              key={"code-option-button-" + option.name}
              className="code-option-button">
              <ActionButton
                id={"code-reference-button-" + option.name}
                action={() => { props.addCodeToTab(option.snippet) }}
                tooltip={option.description}
                tooltipPlace="right"
                color='reference'
                text={option.name} />
            </div>
          )}
        </div>

      </div>
    )
  }

  return (
    <div className="we-code-reference">
      <div className="we-code-reference-title">
        <div className="we-code-reference-title-text">Reference</div>

        {
          selected !== '' &&
          <div className="we-code-options-selected">
            <button
              className="we-code-options-back"
              onClick={() => setSelected('')}><ToolIcon name="codeBack" /></button>
            <button
              key={"code-reference-button-" + selected}
              className={classNames("reference-button", "we-code", selected)}
            >
              <ToolIcon name={'code' + selected} className="reference-icon" />
              <div className="reference-button-title">{selected}</div>
            </button>
          </div>
        }
      </div>

      <div className="we-code-reference-body">
        {
          selected === '' && renderChoices()
        }

        {
          selected !== '' && renderCodeOptions(selected)
        }
      </div>

    </div>
  )
}
