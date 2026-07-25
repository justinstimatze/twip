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

import npmNotices from './notices-npm.json';
import vendoredNotices from './notices-vendored.json';

import './_opensourcenotices.scss';
import classNames from 'classnames';

/*
 * Was 492 lines of hand-written JSX: 56 library entries with their licence texts inline,
 * each `<br />`-joined into one unreadable line. It had drifted — it still named
 * react-aria-menubutton, gone for years — and the Phase 1 swaps would have left nine more
 * entries describing libraries that are no longer installed.
 *
 * notices-npm.json is generated from the lockfile by dev/gen-notices.mjs, so it cannot
 * drift. notices-vendored.json stays by hand: the engine's libraries live under corelibs
 * rather than in node_modules, so nothing can read them off disk.
 */
function Notice ({ notice }) {
  return (
    <li className="open-source-notice">
      <h3>
        <a href={notice.homepage} target="_blank" rel="noreferrer">{notice.name}</a>
        {' — '}{notice.license}
      </h3>
      <h4>Used in: {notice.usedIn}</h4>
      <pre className="open-source-notice-license">{notice.text}</pre>
    </li>
  );
}

class OpenSourceNotices extends Component {
    render () {
        const notices = [...vendoredNotices, ...npmNotices]
          .sort((a, b) => a.name.localeCompare(b.name));

        return (
            <WickModal
            open={this.props.open}
            toggle={this.props.toggle}
            className={classNames("open-source-notices-modal-container", this.props.isMobile && "mobile")}
            overlayClassName="open-source-notices-modal-overlay">
                <div className="open-source-notices-body">
                    <h1>Open Source Notices</h1>
                    <p>
                        This editor is built on the shared work of the projects below. Each
                        entry links to the project and reproduces its licence terms.
                    </p>
                    <ul className="open-source-notice-list">
                      {notices.map((notice) => <Notice key={notice.name} notice={notice} />)}
                    </ul>
                </div>
            </WickModal>
        );
    }
}
export default OpenSourceNotices
