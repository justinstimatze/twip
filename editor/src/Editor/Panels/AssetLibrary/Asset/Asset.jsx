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
 * One asset, as a tile.
 *
 * docs/ui-research.md lists "library-as-list → thumbnail grid with search" among the things
 * that date the interface. The search half was already here; this is the other half, and the
 * case it exists for is narrow and real: images imported from a camera or a sprite sheet are
 * named DSC_0413 and frame_07, so a list of names is a list of things you cannot tell apart.
 *
 * Two of the five kinds get a real picture, and they are exactly those two. An ImageAsset and
 * an SVGAsset each hold a data URI an <img> can read, so the tile shows the asset itself. A
 * FontAsset shows its own letterforms, which is the only preview a typeface has. Sounds and
 * clips get their icon, because the alternatives are not worth what they cost — a waveform is
 * a decode per tile, and a clip preview is a full project render (Project.generateImageSequence
 * mutates the project and appends to the document to do it). An icon on those is not a
 * placeholder for something better; it is what the tile has to say.
 *
 * No buttons in here. The tile is a role="option" and an option with controls inside it is a
 * malformed listbox — Add and Delete live in the panel's footer, where they also have room
 * for a word rather than a glyph.
 */
import React from 'react';
import { useDrag } from 'react-dnd';
import DragDropTypes from 'Editor/DragDropTypes.js';
import ToolIcon from 'Editor/Util/ToolIcon/ToolIcon';
import { cn } from '@/lib/utils';

const ICONS = {
  ImageAsset: 'image',
  SoundAsset: 'sound',
  ClipAsset: 'clip',
  ButtonAsset: 'button',
  FontAsset: 'font',
  SVGAsset: 'svg',
};

/* What the tile calls this thing out loud, since "asset" is not a kind of anything. */
const KINDS = {
  ImageAsset: 'image',
  SoundAsset: 'sound',
  ClipAsset: 'clip',
  ButtonAsset: 'button',
  FontAsset: 'font',
  SVGAsset: 'vector',
};

/* The kinds whose `src` is something a browser will draw. A SoundAsset has a src too, and it
 * is audio — asking an <img> for it produces a broken-image glyph, not a fallback. */
const DRAWABLE = ['ImageAsset', 'SVGAsset'];

export function thumbnailSrc (asset) {
  return DRAWABLE.indexOf(asset.classname) === -1 ? null : asset.src;
}

function Preview ({ asset }) {
  const src = thumbnailSrc(asset);
  if (src) {
    return (
      <img
        src={src}
        alt=""
        /* contain rather than cover, because the tile is square and assets are not: a
           letterboxed sprite is legible and a cropped one is a different picture. Full width
           and height rather than max-, so small assets scale UP to fill the tile — a 32px
           sprite left at its natural size reads as a dot floating in a box, and identifying
           it at a glance is the only thing this picture is for. */
        className="h-full w-full object-contain"
        draggable={false} />
    );
  }

  if (asset.classname === 'FontAsset' && asset.fontFamily) {
    return (
      <span
        className="text-[20px] leading-none text-content"
        style={{ fontFamily: `'${asset.fontFamily}', sans-serif` }}
        aria-hidden="true">
        Ag
      </span>
    );
  }

  return <ToolIcon name={ICONS[asset.classname] || 'asset'} className="h-6 w-6" />;
}

function Asset ({ asset, isSelected, isFocused, onClick, dragRef }) {
  const kind = KINDS[asset.classname] || 'asset';

  return (
    <div
      ref={dragRef}
      role="option"
      aria-selected={isSelected}
      /* The name is truncated on screen and the kind is a picture, so both go in the label —
         this is the only place a screen reader is told either. */
      aria-label={`${asset.name}, ${kind}`}
      title={asset.name}
      tabIndex={isFocused ? 0 : -1}
      onClick={onClick}
      className={cn(
        'flex cursor-grab flex-col items-center gap-1 rounded-sm border p-1 transition-colors',
        'focus-visible:outline-2 focus-visible:outline-focus focus-visible:-outline-offset-2',
        isSelected
          ? 'border-selected bg-surface-hover'
          : 'border-transparent hover:border-line-strong hover:bg-surface-hover',
      )}
    >
      {/* A checked bed rather than a flat one, so a transparent PNG reads as transparent
          instead of as whatever colour the panel happens to be. Two adjacent surface tones
          rather than surface against line: the check has to be readable when you look for it
          and invisible when you are looking at the picture on top of it, and at this size a
          hairline-contrast check competes with the thumbnail for the eye. */}
      <div
        className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-xs bg-surface-sunken"
        style={{
          backgroundImage:
            'linear-gradient(45deg, var(--color-surface) 25%, transparent 25%, transparent 75%, var(--color-surface) 75%),'
            + 'linear-gradient(45deg, var(--color-surface) 25%, transparent 25%, transparent 75%, var(--color-surface) 75%)',
          backgroundSize: '10px 10px',
          backgroundPosition: '0 0, 5px 5px',
        }}
      >
        <Preview asset={asset} />
      </div>
      <span className="w-full truncate text-center text-[10px] leading-3 text-content-muted">
        {asset.name}
      </span>
    </div>
  );
}

/*
 * react-dnd 16 removed the DragSource() decorator in favour of hooks. GET_ASSET_TYPE is a
 * function of props (it returns the asset's classname, so a SoundAsset only drops on the
 * timeline and an ImageAsset only on the canvas), which the decorator resolved for us —
 * the hook needs it called explicitly.
 */
export default function AssetDragSource (props) {
  const [, dragRef] = useDrag(() => ({
    type: DragDropTypes.GET_ASSET_TYPE(props),
    item: { uuid: props.asset.uuid },
  }), [props.asset]);

  return <Asset {...props} dragRef={dragRef} />;
}
