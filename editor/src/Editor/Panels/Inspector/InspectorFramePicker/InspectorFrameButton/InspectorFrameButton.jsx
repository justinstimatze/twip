/*
 * Copyright I don't know
 */

import React, { Component } from 'react';


import WickInput from 'Editor/Util/WickInput/WickInput';



/* #426180 for the active frame, which is the only place that blue appears — left as a
   literal rather than promoted to a token until the frame picker's design is settled. */
const BASE = 'flex flex-row items-center justify-start bg-transparent hover:bg-black/10';
const ACTIVE = 'bg-[#426180] hover:bg-[#426180]/80';

class InspectorFrameButton extends Component {
    render() {
        return (
            <WickInput type="button" className={this.props.isActive ? `${BASE} ${ACTIVE}` : BASE} onClick={this.props.onClick}>
                <div className="m-[3px] flex size-[60px] items-center justify-center bg-[#636363]">
                    {this.props.children}
                </div>
                <span className="m-[3px] ml-[5px]">{this.props.label}</span>
            </WickInput>
        );
    }
}

export default InspectorFrameButton