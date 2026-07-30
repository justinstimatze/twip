/*
 * The Document tab — the project's own four properties, in the panel rather than in a modal.
 *
 * These lived in SimpleProjectSettings, a dialog reached by clicking the project name. A
 * modal for four fields is the first item on docs/ui-research.md's "outdated tells" list, and
 * the specific cost here is that the stage is the thing you are sizing and the dialog covers
 * it. Inline, the canvas resizes under a field you can keep typing in.
 *
 * Held in a draft — see InspectorDraft for why the stage must not resize per keystroke.
 *
 * Background colour is deliberately absent, though the project carries one and the modal did
 * not offer it either. Nothing writes a SetBackgroundColor tag, so the colour reaches the
 * editor's canvas and not the .swf, and a control that only half works is worse than a
 * control that is not there. It belongs here the day the compiler emits the tag.
 */
import React from 'react';

import InspectorDraft from '../InspectorDraft/InspectorDraft';
import InspectorTextInput from '../InspectorRow/InspectorRowTypes/InspectorTextInput';
import InspectorNumericInput from '../InspectorRow/InspectorRowTypes/InspectorNumericInput';
import InspectorDualNumericInput from '../InspectorRow/InspectorRowTypes/InspectorDualNumericInput';

export default function InspectorDocument ({ settings, onCommit, className }) {
  return (
    <InspectorDraft values={settings} onCommit={onCommit} className={className}>
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
  );
}
