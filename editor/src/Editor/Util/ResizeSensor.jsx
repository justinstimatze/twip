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

import React, { useEffect, useRef } from 'react';

/**
 * Calls `onResize` whenever this element's box changes size.
 *
 * Replaces react-sizeme, which reached its element through ReactDOM.findDOMNode — removed
 * in React 19, so it threw on mount. ResizeObserver has been universal since 2020 and needs
 * no wrapper library; the plan lists react-sizeme, react-measure and react-resize-detector
 * as three packages for this one browser API.
 *
 * The old call site also ran `project.view.render()` from inside a render prop, so a resize
 * re-entered the engine during React's render phase. Here the engine is touched from an
 * effect, which is where imperative work belongs.
 */
export default function ResizeSensor ({ onResize, className, style, children }) {
  const ref = useRef(null);
  // Keep the latest callback without re-subscribing the observer on every render.
  const cb = useRef(onResize);
  cb.current = onResize;

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) cb.current({ width: box.width, height: box.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className={className} style={{ width: '100%', height: '100%', ...style }}>
      {children}
    </div>
  );
}
