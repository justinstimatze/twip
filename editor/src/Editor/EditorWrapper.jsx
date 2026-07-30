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

import React, { useEffect, useRef } from 'react';
import ErrorBoundary from './Util/ErrorBoundary';
import { TooltipProvider } from '@/ui/tooltip';
import { Toaster } from '@/ui/toast';
import { bindHotKeys } from './hotkeys';
import ErrorPage from './Util/ErrorPage';
import ModalHandler from './Modals/ModalHandler/ModalHandler';
import { Hook, Unhook } from 'console-feed';

/**
 * EditorWrapper
 * This component is designed to wrap the editor and provide all necessary global interactions.
 */

export default function EditorWrapper(props) {

    // Run once, connect the console to the console object.
    useEffect(() => {
        Hook(window.console, log => {props.editor.setConsoleLogs([...props.editor.state.consoleLogs, log])}, false)
        return () => Unhook(window.console)
    }, [])

    // The shortcuts are bound to the window rather than to an element, which is what makes them
    // work while a toolbar button holds focus — pick a tool with the mouse, then press Ctrl+Z.
    //
    // Rebound only when the sequences themselves change, which is on the two state changes that
    // narrow the map (preview playback, view-only) and when the user edits a custom hotkey. The
    // handlers are read through a ref at fire time instead, because getKeyHandlers() builds a
    // fresh object on every render in the view-only branch and depending on it would rebind
    // eighty-four listeners on every keystroke.
    const keyMap = props.editor.getKeyMap();
    const handlers = useRef(null);
    handlers.current = props.editor.getKeyHandlers();
    useEffect(
        () => bindHotKeys(keyMap, () => handlers.current),
        [JSON.stringify(keyMap)]
    );


    return (
        <ErrorBoundary
            fallback={ErrorPage}
            processError={(error, errorInfo) => { props.editor.autoSaveProject(() => { "Project Autosaved" }) }}
        >
          {/* Radix tooltips need a Provider ancestor; one at the root shares the open/close
              timing across the whole editor, so moving between adjacent buttons shows the
              second tooltip immediately instead of re-waiting the delay. */}
          <TooltipProvider delayDuration={200} skipDelayDuration={400}>
            <Toaster />
            <div id="editor" className="theme-default">
                <ModalHandler
                    getRenderSize={props.editor.getRenderSize}
                    activeModalName={props.editor.state.activeModalName}
                    swfPreviewUrl={props.editor.state.swfPreviewUrl}
                    openModal={props.editor.openModal}
                    closeActiveModal={props.editor.closeActiveModal}
                    queueModal={props.editor.queueModal}
                    project={props.editor.project}
                    createClipFromSelection={props.editor.createClipFromSelection}
                    createButtonFromSelection={props.editor.createButtonFromSelection}
                    exportProjectAsGif={props.editor.exportProjectAsAnimatedGIF}
                    exportProjectAsVideo={props.editor.exportProjectAsVideo}
                    exportProjectAsStandaloneZip={props.editor.exportProjectAsStandaloneZip}
                    exportProjectAsStandaloneHTML={props.editor.exportProjectAsStandaloneHTML}
                    exportProjectAsSWF={props.editor.exportProjectAsSWF}
                    exportProjectAsImageSequence={props.editor.exportProjectAsImageSequence}
                    exportProjectAsAudioTrack={props.editor.exportProjectAsAudioTrack}
                    warningModalInfo={props.editor.state.warningModalInfo}
                    loadAutosavedProject={props.editor.loadAutosavedProject}
                    clearAutoSavedProject={props.editor.clearAutoSavedProject}
                    renderProgress={props.editor.state.renderProgress}
                    renderStatusMessage={props.editor.state.renderStatusMessage}
                    renderType={props.editor.state.renderType}
                    addCustomHotKeys={props.editor.addCustomHotKeys}
                    resetCustomHotKeys={props.editor.resetCustomHotKeys}
                    customHotKeys={props.editor.state.customHotKeys}
                    keyMap={props.editor.getKeyMap(true)}
                    keyMapGroups={props.editor.hotKeyInterface.createHandlerGroups()}
                    importFileAsAsset={props.editor.importFileAsAsset}
                    colorPickerType={props.editor.state.colorPickerType}
                    changeColorPickerType={props.editor.changeColorPickerType}
                    updateLastColors={props.editor.updateLastColors}
                    lastColorsUsed={props.editor.state.lastColorsUsed}
                    editorVersion={props.editor.editorVersion}
                    toast={props.editor.toast}
                    createCombinedHotKeyMap={props.editor.createCombinedHotKeyMap}
                    getToolSetting={props.editor.getToolSetting}
                    setToolSetting={props.editor.setToolSetting}
                    getToolSettingRestrictions={props.editor.getToolSettingRestrictions}
                    exportProjectAsImageSVG={props.editor.exportProjectAsImageSVG}
                    builtinPreviews={props.editor.builtinPreviews}
                    addFileToBuiltinPreviews={props.editor.addFileToBuiltinPreviews}
                    isAssetInLibrary={props.editor.isAssetInLibrary}
                    localSavedFiles={props.editor.state.localSavedFiles}
                    loadLocalWickFile={props.editor.loadLocalWickFile}
                    deleteLocalWickFile={props.editor.deleteLocalWickFile}
                    reloadSavedWickFiles={props.editor.reloadSavedWickFiles}
                    openWarningModal={props.editor.openWarningModal}
                />
                {props.children}
            </div>
          </TooltipProvider>
        </ErrorBoundary>
    )
}
