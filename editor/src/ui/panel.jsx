/*
 * Panel chrome — the header rail every docked panel wears, and the empty state it shows when
 * it has nothing in it.
 *
 * Each panel used to hand-write its own title: the Inspector's was 22px white, the Asset
 * Library's was 20px white in a 200px-wide box, the Outliner's was its own again. At that
 * size a panel label competes with the panel's contents for the eye, and three of them at
 * three different sizes make the chrome read as three programs docked together.
 *
 * A label on an instrument is small, quiet, and always in the same place. So: 11px, tracked,
 * uppercase, on the sunken surface with a hairline under it, so the header reads as a rail
 * the panel hangs from rather than a heading in a document. `context` is for the part that
 * changes — the Inspector's selection type — and it is the only thing in the rail allowed to
 * carry the content colour, because it is the only thing that is content.
 */
import React from 'react';
import { cn } from '@/lib/utils';

export function PanelHeader ({ label, context, children, className }) {
  return (
    <div
      className={cn(
        'flex h-panel-title shrink-0 items-center gap-2 border-b border-line bg-surface-sunken pr-1 pl-2',
        className,
      )}
    >
      <span className="rail-label shrink-0">{label}</span>
      {context && (
        <span className="min-w-0 truncate text-[11px] text-content-muted">{context}</span>
      )}
      {children && <div className="ml-auto flex shrink-0 items-center gap-0.5">{children}</div>}
    </div>
  );
}

/*
 * What a panel says when it is empty, which for the Inspector is most of the time. The old
 * chrome said nothing at all — a 500px column of flat colour, which reads as broken rather
 * than as idle.
 */
export function PanelEmpty ({ children, className }) {
  return (
    <div
      className={cn(
        'flex h-full w-full items-center justify-center px-4 text-center text-[11px] leading-4 text-content-faint select-none',
        className,
      )}
    >
      <span className="max-w-[22ch]">{children}</span>
    </div>
  );
}
