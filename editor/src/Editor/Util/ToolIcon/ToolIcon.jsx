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

/*
 * Name in, icon out — the same API the hundred-odd call sites already use. What changed is
 * what comes out: an inline <svg> in `currentColor` from ui/icon.jsx, instead of an <img>
 * pointing at one of 236 files whose colour was fixed when it was drawn. This file was 187
 * lines of import statements above a 149-entry lookup table; the table is the icon set now.
 *
 * One exception stays on the old path, and it is the one that should. `mascot` is *Wick's*
 * mascot and the only place it appears is the credits modal. Redrawing someone else's
 * character in twip's line weight would be a strange thing to do to an attribution.
 */
import React, { Component } from 'react';
import classNames from 'classnames';
import { Icon, resolveIcon } from '@/ui/icon';
import './_toolbutton.scss';

import mascot from 'resources/logo-icons/mascot.svg';
import mascotMark from 'resources/logo-icons/mascot-mark.svg';

const CREDITED = {
  mascot,
  mascotmark: mascotMark,
  // The dark and white variants of the mark were the <img> workaround for two backgrounds and
  // nothing renders them. One mark is enough for a credits panel.
};

class ToolIcon extends Component {
  render () {
    const { name, className, default: fallback } = this.props;

    if (resolveIcon(name)) {
      return <Icon name={name} className={classNames('img-tool-icon', className)} />;
    }

    if (name in CREDITED) {
      return (
        <img
          className={classNames('img-tool-icon', className)}
          alt={`${name} icon`}
          src={CREDITED[name]}
        />
      );
    }

    /*
     * ToolSettings passes short words — "None", "Merge", "Skew", "Pixel" — as `default`, for
     * settings that never had a drawing. Previously an unrecognised name rendered a question
     * mark whether or not a default was given; now it renders nothing, which is quieter on
     * screen and louder in dev, below.
     */
    if (fallback !== undefined) {
      return <div className="img-tool-icon">{fallback}</div>;
    }

    if (import.meta.env && import.meta.env.DEV) {
      console.warn(`[twip] no icon named "${name}" — see src/ui/icon.jsx`);
    }
    return null;
  }
}

export default ToolIcon;
