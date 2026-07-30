/*
 * The Document tab — the project's own four properties, in the panel rather than in a modal.
 *
 * These lived in SimpleProjectSettings, a dialog reached by clicking the project name. A
 * modal for four fields is the first item on docs/ui-research.md's "outdated tells" list, and
 * the specific cost here is that the stage is the thing you are sizing and the dialog covers
 * it. Inline, the canvas resizes under a field you can keep typing in.
 *
 * Name, framerate and size are held in a draft — see InspectorDraft for why the stage must
 * not resize per keystroke. Background is not: the picker reports on onChangeComplete, which
 * is already the "done" of a gesture, and a colour that waited for the field to blur would be
 * waiting on a popover rather than on the user.
 */
import React from 'react';

import InspectorDraft from '../InspectorDraft/InspectorDraft';
import InspectorTextInput from '../InspectorRow/InspectorRowTypes/InspectorTextInput';
import InspectorNumericInput from '../InspectorRow/InspectorRowTypes/InspectorNumericInput';
import InspectorDualNumericInput from '../InspectorRow/InspectorRowTypes/InspectorDualNumericInput';
import InspectorColorInput from '../InspectorRow/InspectorRowTypes/InspectorColorInput';

export default function InspectorDocument ({ settings, onCommit, className, colorPicker }) {
  /* Split out of the draft on purpose; see the note above. */
  const { backgroundColor, ...held } = settings;

  return (
    <div className={className}>
      <InspectorDraft values={held} onCommit={onCommit}>
        {(draft, edit) => (
          <>
            <InspectorTextInput
              tooltip="Name"
              val={draft.name}
              onChange={edit('name')}
              placeholder="My Project" />
            <InspectorNumericInput
              tooltip="Framerate"
              val={draft.framerate}
              onChange={edit('framerate')} />
            <InspectorDualNumericInput
              tooltip1="Width"
              tooltip2="Height"
              val1={draft.width}
              val2={draft.height}
              onChange1={edit('width')}
              onChange2={edit('height')} />
          </>
        )}
      </InspectorDraft>
      <InspectorColorInput
        tooltip="Background"
        id="inspector-project-background"
        val={backgroundColor}
        onChange={(color) => onCommit({ backgroundColor: color })}
        {...colorPicker} />
    </div>
  );
}
