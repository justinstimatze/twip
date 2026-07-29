import React, { Component } from 'react';

import './_outlinerdropdown.scss';

import { Icon } from '@/ui/icon';

class OutlinerDropdown extends Component {
  render() {
    let collapsed = this.props.collapsed ? "collapsed" : "expanded";

    /*
     * `empty_dropdown.svg` was a blank file holding the row's indent. A div does that without
     * a network request, and the arrow is a real <button> now rather than an <input
     * type="image"> — which was announcing itself to a screen reader as an image submit
     * control with the alt text "dropdown-icon".
     */
    if (this.props.empty) {
      return <div className="outliner-dropdown-icon empty" aria-hidden="true" />;
    }

    return (
      <button
        type="button"
        className={"outliner-dropdown-icon " + collapsed}
        aria-label={this.props.collapsed ? 'expand' : 'collapse'}
        aria-expanded={!this.props.collapsed}
        onClick={(e) => {
          e.stopPropagation();
          this.props.toggle();
        }}
      >
        <Icon name="dropdown" />
      </button>
    );
  }
}

export default OutlinerDropdown;

/*  <button
        className="outliner-dropdown"
        onClick={(e) => {
          e.stopPropagation();
          this.props.toggle();
        }}
        >
          <img
          className={"outliner-dropdown-icon" + collapsed}
          src={dropdownIcon}
          alt="dropdown"
          />
        </button>*/