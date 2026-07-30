/*
 * The Inspector's three subjects, as a tab rail.
 *
 * docs/ui-research.md lists "flat property inspector → tabbed, context-aware" among the
 * things that date the interface, and the flatness has a concrete cost: the panel can only
 * ever describe one thing, so asking how long the current frame is means deselecting the
 * shape you were working on. Object, Frame and Document are three subjects that are all
 * true at once, and the tabs are what let the panel hold all three.
 *
 * Written rather than reused: Util/TabbedInterface is uncontrolled, and this rail has to
 * follow the selection as well as the pointer.
 *
 * Roving tabindex, because a tablist is one stop on the Tab key and the arrows move within
 * it. The alternative — three tab stops — makes the keyboard user walk past every tab to
 * reach the fields, which is the pattern the roving tabindex exists to avoid.
 */
import React, { useRef } from 'react';
import { cn } from '@/lib/utils';

export default function InspectorTabs ({ tabs, active, onSelect }) {
  const buttons = useRef({});

  const go = (id) => {
    onSelect(id);
    /* Selection moves with focus here, which is correct for panels whose bodies are cheap
     * to render — the arrow key shows you the tab rather than merely aiming at it. */
    const el = buttons.current[id];
    if (el) el.focus();
  };

  const onKeyDown = (event) => {
    const i = tabs.findIndex((tab) => tab.id === active);
    const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];

    let next = null;
    if (step !== undefined) next = tabs[(i + step + tabs.length) % tabs.length];
    else if (event.key === 'Home') next = tabs[0];
    else if (event.key === 'End') next = tabs[tabs.length - 1];
    if (!next) return;

    /* Both, and for different reasons: preventDefault stops Home/End scrolling the panel,
     * stopPropagation keeps the arrows off the editor's nudge-the-selection shortcut. */
    event.preventDefault();
    event.stopPropagation();
    go(next.id);
  };

  return (
    <div
      role="tablist"
      aria-label="Inspector subject"
      className="flex h-panel-title shrink-0 border-b border-line bg-surface-sunken"
      onKeyDown={onKeyDown}
    >
      {tabs.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            ref={(el) => { buttons.current[tab.id] = el; }}
            type="button"
            role="tab"
            id={`inspector-tab-${tab.id}`}
            aria-selected={selected}
            aria-controls={`inspector-tabpanel-${tab.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(tab.id)}
            className={cn(
              /* The active marker is a rule along the bottom edge, drawn over the rail's own
                 hairline so the row keeps its height whichever tab is on. */
              'rail-label -mb-px min-w-0 flex-1 truncate border-b-2 px-1 transition-colors',
              'focus-visible:outline-2 focus-visible:outline-focus focus-visible:-outline-offset-2',
              selected
                ? 'border-accent text-content'
                : 'border-transparent hover:bg-surface-hover hover:text-content-muted',
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
