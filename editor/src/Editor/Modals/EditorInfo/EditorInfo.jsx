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
import WickModal from 'Editor/Modals/WickModal/WickModal';
import ActionButton from 'Editor/Util/ActionButton/ActionButton';

import './_editorinfo.scss';
import ToolIcon from '../../Util/ToolIcon/ToolIcon';

class WelcomeModal extends Component {
    render () {
        return (
            <WickModal
            open={this.props.open} 
            toggle={this.props.toggle}
            className="editor-info-modal-container"
            overlayClassName="editor-info-modal-overlay">
                <div className="editor-info-modal-body">
                    <div className="editor-info-icon">
                        <ToolIcon name="mascot"/>
                    </div>
                    <div className="editor-info-name">twip</div>
                    <div className="editor-info-version">Version {this.props.editorVersion}</div>
                    {/*
                      * The credit belongs on the page, not only in the file headers every user
                      * never opens. What used to sit here were Wicklets' own terms, privacy and
                      * cookie policies plus their community forum — those govern wickeditor.com
                      * and have never governed this, so pointing a user at them told them
                      * something false about where their data goes.
                      */}
                    <div className="editor-info-credit">
                      Built on the <a
                        href="https://github.com/Wicklets/wick-editor"
                        target="_blank"
                        rel="noopener noreferrer">Wick Editor</a> by Wicklets LLC, under the GNU
                      General Public License v3.
                    </div>
                    <div className="editor-info-open-source-notices">
                        <ActionButton
                            color="gray"
                            text="Open Source Notices"
                            action={() => {this.props.openModal("OpenSourceNotices")}} />
                    </div>
                </div> 
            </WickModal>
        );
    }
}
export default WelcomeModal