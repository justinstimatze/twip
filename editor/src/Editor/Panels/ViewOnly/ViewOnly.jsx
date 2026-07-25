/*
 * The editor below 768px: a player, not a cramped authoring surface.
 *
 * Stage, timeline, inspector, outliner, library and toolbox cannot all be on screen at
 * once on a phone, and the fork's answer — a second component tree with its own Inspector,
 * 2,538 lines of it — was deleted in Phase 0. This is the replacement, and it is smaller
 * than the problem sounds: twip projects are played by the same engine that authors them,
 * so a viewer is the canvas plus a play control.
 *
 * What reaches this component is deliberately thin. Everything that could modify the
 * project is simply not rendered, and Editor.jsx additionally switches the engine to the
 * `none` tool so a stray drag on the canvas cannot select or move anything.
 */
import React from 'react';
import ToolIcon from 'Editor/Util/ToolIcon/ToolIcon';

export default function ViewOnly ({ projectName, playing, onTogglePlay, minAuthoringWidth, children }) {
  return (
    <div className="flex h-full w-full flex-col bg-surface">
      <header className="flex h-11 shrink-0 items-center border-b border-surface-sunken px-4">
        <h1 className="truncate text-sm font-medium text-content">{projectName}</h1>
      </header>

      {/* The canvas fills whatever is left. `min-h-0` is load-bearing: without it a flex
          item refuses to shrink below its content and the stage pushes the footer off. */}
      <div className="min-h-0 flex-1">{children}</div>

      <footer className="flex shrink-0 flex-col items-center gap-2 border-t border-surface-sunken px-4 py-3">
        <button
          type="button"
          id="view-only-play"
          onClick={onTogglePlay}
          aria-label={playing ? 'Stop' : 'Play'}
          className="flex size-14 items-center justify-center rounded-full bg-accent text-accent-content transition-colors hover:bg-accent-hover active:bg-accent-active focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <ToolIcon className="size-7" name={playing ? 'pause' : 'play'} />
        </button>
        <p className="text-center text-xs text-content-muted">
          Viewing only. Editing needs a window at least {minAuthoringWidth}px wide.
        </p>
      </footer>
    </div>
  );
}
