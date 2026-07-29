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
 * Play / stop, drawn rather than photographed.
 *
 * It was `<input type="image">` pointing at play.png and pause.png — two rasters with Wick's
 * green ring baked into the pixels, so no palette could reach them and they were soft on any
 * display denser than the one they were exported for. As a path it takes the accent from the
 * token layer like everything else, and it is sharp at any size.
 *
 * Stop rather than pause, because that is what the button does: `previewPlaying` false winds
 * the playhead back to where preview started. A pause glyph promises a resume that does not
 * exist.
 */
import React from 'react';
import { cn } from '@/lib/utils';

export default function PlayButton ({ id, className, playing, action }) {
  return (
    <button
      type="button"
      id={id}
      onClick={action}
      aria-label={playing ? 'Stop preview' : 'Play preview'}
      aria-pressed={playing}
      className={cn(
        'flex items-center justify-center rounded-full text-accent-content transition-colors duration-100',
        playing ? 'bg-content hover:bg-ash-50' : 'bg-accent hover:bg-accent-hover',
        className,
      )}
    >
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-1/2 w-1/2" aria-hidden="true">
        {playing
          ? <rect x="6" y="6" width="12" height="12" rx="1.5" />
          /* Nudged right by a hair: a triangle centred on its bounding box reads left-heavy
             inside a circle, because its mass is not where its box is. */
          : <path d="M8.5 5.4 19 12 8.5 18.6z" />}
      </svg>
    </button>
  );
}
