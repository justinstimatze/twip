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

/**
 * SwfPreview — plays a compiled .swf (produced by the twip compiler) in an
 * embedded Ruffle player. Ruffle is loaded as a global (window.RufflePlayer)
 * from public/corelibs/ruffle/ruffle.js, the same script-tag pattern the engine
 * and gif libs use.
 */
class SwfPreview extends Component {
  container = null;
  player = null;

  loadSwf = (attempt = 0) => {
    if (!this.props.swfUrl) return;
    // react-modal mounts its portal content asynchronously, so on the first
    // componentDidUpdate the container ref can still be null. Retry on the next
    // frame until it mounts (bounded so a genuinely-missing container gives up).
    if (!this.container) {
      if (attempt < 60) window.requestAnimationFrame(() => this.loadSwf(attempt + 1));
      return;
    }
    this.teardown();

    if (!window.RufflePlayer) {
      this.container.innerHTML =
        '<div style="color:#fff;padding:24px">Ruffle failed to load ' +
        '(public/corelibs/ruffle/ruffle.js).</div>';
      return;
    }

    let ruffle = window.RufflePlayer.newest();
    let player = ruffle.createPlayer();

    let project = window.editor && window.editor.project;
    let w = (project && project.width) || 720;
    let h = (project && project.height) || 480;
    player.style.width = w + 'px';
    player.style.height = h + 'px';

    this.container.appendChild(player);
    player.load({ url: this.props.swfUrl, autoplay: 'on', unmuteOverlay: 'hidden' });
    this.player = player;
  }

  teardown = () => {
    if (this.player) {
      this.player.remove();
      this.player = null;
    }
    if (this.container) this.container.innerHTML = '';
  }

  componentDidUpdate(prevProps) {
    let opened = this.props.open && !prevProps.open;
    let urlChanged = this.props.open && prevProps.swfUrl !== this.props.swfUrl;
    if (opened || urlChanged) this.loadSwf();
    if (!this.props.open && prevProps.open) this.teardown();
  }

  componentWillUnmount() {
    this.teardown();
  }

  render() {
    return (
      <WickModal
        open={this.props.open}
        toggle={this.props.toggle}
        className="swf-preview-modal">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ color: '#fff', fontSize: 18, marginBottom: 12 }}>
            SWF Preview
          </div>
          <div
            ref={el => { this.container = el; }}
            style={{ background: '#000', lineHeight: 0 }} />
        </div>
      </WickModal>
    );
  }
}

export default SwfPreview;
