/*
 * A group of Inspector rows whose edits are held until you leave them.
 *
 * Every other row in this panel commits per keystroke, and for most of them that is right:
 * dragging opacity through 0.3 on the way to 0.7 costs nothing, and you want to see it.
 *
 * It is wrong wherever the intermediate values are destructive, and the panel has two such
 * places. Typing 1280 into the stage width resizes the canvas at 1, then 12, then 128 — four
 * resizes and four undo states, three of them at sizes nobody asked for. And typing 30 into
 * the length of the frame under the playhead truncates it to 3 first, which pulls the frame
 * out from under the playhead and takes the row you were typing in with it.
 *
 * So: a draft, and one commit when focus leaves the group or you press Enter. React's onBlur
 * is focusout and bubbles, so one handler on the group covers every field in it, and moving
 * between two fields inside the group commits — which is correct, since the whole draft goes
 * through one setter that drops the values that did not change.
 *
 * The draft resyncs off a signature rather than off the values object, because callers build
 * that object fresh on every render and an object identity dependency would overwrite what is
 * being typed. Resyncing rather than remounting on a key, because a remount would take the
 * focus out of the field you just pressed Enter in.
 */
import React, { useEffect, useState } from 'react';

export default function InspectorDraft ({ values, onCommit, className, children }) {
  const signature = JSON.stringify(values);
  const [draft, setDraft] = useState(values);

  useEffect(() => { setDraft(JSON.parse(signature)); }, [signature]);

  const edit = (key) => (value) => setDraft((prev) => ({ ...prev, [key]: value }));
  const commit = () => onCommit(draft);

  return (
    <div
      className={className}
      onBlur={commit}
      onKeyDown={(event) => { if (event.key === 'Enter') commit(); }}
    >
      {children(draft, edit)}
    </div>
  );
}
