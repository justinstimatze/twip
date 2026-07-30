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
     * - tabNames {String[]} The tabs, in the order their bodies are passed as children.
     * - label {String} What this set of tabs is for. Names the tablist to a screen reader,
     *   and namespaces the ids — several of these can be in the document at once.
     * - onTabSelect {function} Optional, called with the tab name on every change.
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

    /*
     * ids for the tab/panel pair. Namespaced by `label` because the modals that use this are
     * all in one document, so a bare tab name would collide the moment two of them are open —
     * and a duplicate id makes aria-controls point at whichever one the browser found first.
     */
    slug = (text) => String(text).replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase();
    tabId = (tab) => `tabbed-${this.slug(this.props.label)}-tab-${this.slug(tab)}`;
    panelId = (tab) => `tabbed-${this.slug(this.props.label)}-panel-${this.slug(tab)}`;

    /*
     * Arrows move along the rail, Home and End jump to its ends, and selection follows focus.
     * Without this the rail is keyboard-operable only by Tab-and-Enter through every tab,
     * which is the pattern a roving tabindex exists to replace.
     */
    onKeyDown = (event) => {
        const names = this.props.tabNames;
        const i = names.indexOf(this.state.selectedTab);
        const step = {ArrowLeft: -1, ArrowRight: 1}[event.key];

        let next = null;
        if (step !== undefined) next = names[(i + step + names.length) % names.length];
        else if (event.key === 'Home') next = names[0];
        else if (event.key === 'End') next = names[names.length - 1];
        if (next === null || next === undefined) return;

        event.preventDefault();
        event.stopPropagation();
        this.selectTab(next);
        const el = document.getElementById(this.tabId(next));
        if (el) el.focus();
    }

    /**
     * Renders the selectable tab bar.
     */
    renderTabs = () => {
        return (
            /*
             * The roles are what makes this a tablist to anything but a sighted mouse user.
             * It carried role="tablist" over a row of plain buttons, which is not merely
             * incomplete — a tablist whose children are not tabs is invalid, and a screen
             * reader given that announces a group of buttons with no notion of which one is
             * current or how many there are.
             */
            <div
                role="tablist"
                aria-label={this.props.label}
                className="tabbed-interface-main-tab-container"
                onKeyDown={this.onKeyDown}>
                {this.props.tabNames.map( (tab, i) => {
                    const selected = this.state.selectedTab === tab;
                    return (
                        <button
                        key={`tab-${tab}-${i}`}
                        type="button"
                        role="tab"
                        id={this.tabId(tab)}
                        aria-selected={selected}
                        aria-controls={this.panelId(tab)}
                        tabIndex={selected ? 0 : -1}
                        className={classNames("tabbed-interface-main-tab", this.props.tabClassName, {"selected": selected})}
                        onClick={() => {this.selectTab(tab)}}>
                            {tab}
                    </button>
                    );
                })}
            </div>
        );
    }

    render() {
        let bodies = this.bodies();
        let index = this.props.tabNames.indexOf(this.state.selectedTab);
        let shown = index === -1 ? this.props.tabNames[0] : this.state.selectedTab;

        // A mismatch here has no visible symptom beyond an empty panel, and an empty panel
        // reads as "this tab has no options yet". Say it once, where it can be acted on.
        if (process.env.NODE_ENV !== 'production' && bodies.length !== this.props.tabNames.length) {
            console.warn(`TabbedInterface: ${this.props.tabNames.length} tabs but `
                + `${bodies.length} bodies (${this.props.tabNames.join(', ')}). `
                + `Every tab needs a body in the same order, or its panel renders empty.`);
        }

        // Every tab has a body, but only the selected one is in the DOM — so aria-controls on
        // the other tabs names an element that is not there. That is allowed and it is what
        // the pattern expects: the panel exists when its tab is current.
        return (
            <div className={classNames("tabbed-interface", this.props.className)}>
                {this.renderTabs()}
                <div
                    role="tabpanel"
                    id={this.panelId(shown)}
                    aria-labelledby={this.tabId(shown)}
                    className={classNames("tabbed-interface-body", this.props.bodyClassName)}>
                    {index === -1 ? bodies[0] : bodies[index]}
                </div>
            </div>
        );
    }
}

export default TabbedInterface