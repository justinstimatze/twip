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

import './_tabbedinterface.scss';
import classNames from 'classnames';
class TabbedInterface extends Component {
    /**
     * @param {} props Expects several props.
     * - tabs {Object[]} Contains all tab information for the interface
     * 
     * tab {Object}
     * - name {String} String name of the tab. Will be displayed in the tab interface.
     * - body {JSX Object} Object to render
     */
    constructor (props) {
        super(props);

        this.state = {
          selectedTab: this.props.tabNames[0],
        }
    }

    componentDidUpdate (prevProps) {
        // selectedTab was set once in the constructor and never revisited, so a tab list that
        // changed under it left the selection naming a tab that no longer exists. indexOf
        // then returns -1, children[-1] is undefined, and the body renders empty.
        if (prevProps.tabNames !== this.props.tabNames
            && this.props.tabNames.indexOf(this.state.selectedTab) === -1) {
            this.selectTab(this.props.tabNames[0]);
        }
    }

    /**
     * The tab bodies, one per name, with the holes closed up.
     *
     * Callers write a body per tab and gate the optional ones inline —
     * `{allowed.indexOf('Audio') > -1 && this.renderAudioInfo()}` — which leaves `false` in
     * the children array where a tab was excluded. The names are filtered, so they arrive
     * dense; the bodies arrive sparse. Indexing one list with a position from the other then
     * lands on a `false` and the panel renders nothing, which is what a platform passing a
     * subset of `window.allowedExportTypes` saw. It looked fine at full length only because
     * both lists happen to line up when nothing is excluded.
     *
     * `React.Children.toArray` drops the booleans and nulls, so both lists are dense and
     * position means the same thing in each.
     */
    bodies = () => {
        return React.Children.toArray(this.props.children);
    }

    // Selects the tab of the given name.
    selectTab = (name) => {
        this.setState({
            selectedTab: name,
        });

        if (this.props.onTabSelect) {
            this.props.onTabSelect(name);
        }
    }

    /**
     * Renders the selectable tab bar.
     */
    renderTabs = () => {
        return (
            <div role="tablist" className="tabbed-interface-main-tab-container">
                {this.props.tabNames.map( (tab, i) => 
                    <button
                    key={`tab-${tab}-${i}`}
                    className={classNames("tabbed-interface-main-tab", this.props.tabClassName, {"selected": (this.state.selectedTab === tab)})}
                    onClick={() => {this.selectTab(tab)}}>
                        {tab}
                </button> 
                )}
            </div>
        );
    }

    render() {
        let bodies = this.bodies();
        let index = this.props.tabNames.indexOf(this.state.selectedTab);

        // A mismatch here has no visible symptom beyond an empty panel, and an empty panel
        // reads as "this tab has no options yet". Say it once, where it can be acted on.
        if (process.env.NODE_ENV !== 'production' && bodies.length !== this.props.tabNames.length) {
            console.warn(`TabbedInterface: ${this.props.tabNames.length} tabs but `
                + `${bodies.length} bodies (${this.props.tabNames.join(', ')}). `
                + `Every tab needs a body in the same order, or its panel renders empty.`);
        }

        return (
            <div className={classNames("tabbed-interface", this.props.className)}>
                {this.renderTabs()}
                <div className={classNames("tabbed-interface-body", this.props.bodyClassName)}>
                    {index === -1 ? bodies[0] : bodies[index]}
                </div>
            </div>
        );
    }
}

export default TabbedInterface