/*
 * The Document tab — the project's own properties, in the panel rather than in a modal.
 *
 * These were in two dialogs. SimpleProjectSettings held four of them behind the project name;
 * the Settings modal's Project tab held the same four plus the background and the resolution
 * presets, behind a menu. A modal for any of this is the first item on docs/ui-research.md's
 * "outdated tells" list, and the specific cost here is that the stage is the thing you are
 * sizing and a dialog covers it. Inline, the canvas resizes under a field you can keep typing
 * in, and picking 1080p shows you 1080p rather than showing you a dialog about 1080p.
 *
 * Name, framerate and size are held in a draft — see InspectorDraft for why the stage must
 * not resize per keystroke. Preset and Background are not: each reports once, at the end of a
 * gesture, and a colour that waited for a field to blur would be waiting on a popover.
 *
 * The presets are a select rather than the modal's row of four buttons. Four buttons need
 * about 200px and this panel can be dragged to exactly that; the modal's own mobile branch
 * had already made the same call for the same reason. "Custom" is not selectable — it is what
 * the row reads when the size matches no preset, which is most of the time.
 */
import React from 'react';

import InspectorDraft from '../InspectorDraft/InspectorDraft';
import InspectorTextInput from '../InspectorRow/InspectorRowTypes/InspectorTextInput';
import InspectorNumericInput from '../InspectorRow/InspectorRowTypes/InspectorNumericInput';
import InspectorDualNumericInput from '../InspectorRow/InspectorRowTypes/InspectorDualNumericInput';
import InspectorColorInput from '../InspectorRow/InspectorRowTypes/InspectorColorInput';
import InspectorSelector from '../InspectorRow/InspectorRowTypes/InspectorSelector';

const PRESETS = [
  { name: 'Default', width: 720, height: 480 },
  { name: 'Square', width: 600, height: 600 },
  { name: '720p', width: 1280, height: 720 },
  { name: '1080p', width: 1920, height: 1080 },
];

const CUSTOM = 'Custom';

function presetFor (width, height) {
  const match = PRESETS.find((p) => p.width === width && p.height === height);
  return match ? match.name : CUSTOM;
}

export default function InspectorDocument ({ settings, onCommit, className, colorPicker }) {
  /* Split out of the draft on purpose; see the note above. */
  const { backgroundColor, ...held } = settings;
  const preset = presetFor(settings.width, settings.height);

  /* Custom is in the list only when it is the answer, so the field can show what it is
     without offering "make this an unspecified size" as something to choose. */
  const options = PRESETS.map((p) => ({ value: p.name, label: p.name }));
  if (preset === CUSTOM) options.unshift({ value: CUSTOM, label: CUSTOM });

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
      <InspectorSelector
        tooltip="Preset"
        type="select"
        value={preset}
        options={options}
        onChange={(option) => {
          const chosen = PRESETS.find((p) => p.name === option.value);
          if (chosen) onCommit({ width: chosen.width, height: chosen.height });
        }} />
      <InspectorColorInput
        tooltip="Background"
        id="inspector-project-background"
        val={backgroundColor}
        onChange={(color) => onCommit({ backgroundColor: color })}
        {...colorPicker} />
    </div>
  );
}
