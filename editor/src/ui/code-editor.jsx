/*
 * Code editor on CodeMirror 6.
 *
 * Replaces react-ace + brace. brace is a 2016 fork of Ace that was pulled in for five
 * themes and one language mode; the five themes alone are most of a megabyte, and
 * _wickcodeeditor.css was already overriding four of monokai's colours to the editor's own
 * palette, so the themes were not really being used as shipped anyway.
 *
 * Two themes now, not five: `dark`, built from the editor's tokens so the gutter and
 * background match the chrome around it, and `light`, CodeMirror's default. Stored values
 * migrate — the three dark ace themes land on dark, the two light ones on light. Anyone
 * who wants the old five back adds them here; nothing else in the file assumes two.
 *
 * The error underline and the gutter marker used to be two separate props (`markers` and
 * `annotations`) describing the same error twice. One diagnostic does both, and hovering
 * it shows the message, which the ace version never did.
 */
import React from 'react';
import { basicSetup } from 'codemirror';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';
import { lintGutter, setDiagnostics } from '@codemirror/lint';

export const CODE_THEMES = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
];

const LEGACY_THEMES = {
  monokai: 'dark', cobalt: 'dark', dracula: 'dark',
  eclipse: 'light', github: 'light',
};

/** Accepts the five ace theme names that may still be in a saved project. */
export function normalizeTheme (name) {
  if (name === 'light' || name === 'dark') return name;
  return LEGACY_THEMES[name] ?? 'dark';
}

/*
 * The dark theme carries the four colour overrides _wickcodeeditor.css was applying to
 * ace-monokai by hand — gutter, background, numbers, comments, keywords — so the editor
 * looks as it did rather than like stock one-dark.
 */
const darkOverrides = EditorView.theme({
  '&': { backgroundColor: '#202020' },
  '.cm-gutters': { backgroundColor: '#292929', color: '#ffffff', border: 'none' },
  '.cm-content': { caretColor: '#ffffff' },
}, { dark: true });

const themeFor = (name) => (normalizeTheme(name) === 'dark' ? [oneDark, darkOverrides] : []);

export const CodeEditor = React.forwardRef(function CodeEditor (
  { value = '', onChange, readOnly = false, fontSize = 16, theme = 'dark', error, className }, ref,
) {
  const host = React.useRef(null);
  const view = React.useRef(null);
  // Held in a ref so the update listener does not have to be rebuilt when onChange
  // changes identity, which for a function component is every render.
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;

  const themeComp = React.useRef(new Compartment());
  const fontComp = React.useRef(new Compartment());
  const readOnlyComp = React.useRef(new Compartment());

  React.useImperativeHandle(ref, () => ({
    /** Replaces ace's `session.insert(getCursorPosition(), code)`. */
    insertAtCursor (text) {
      const v = view.current;
      if (!v) return;
      const { from, to } = v.state.selection.main;
      v.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } });
      v.focus();
    },
    focus () { view.current?.focus(); },
  }), []);

  React.useLayoutEffect(() => {
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          keymap.of([indentWithTab]),
          javascript(),
          lintGutter(),
          themeComp.current.of(themeFor(theme)),
          fontComp.current.of(EditorView.theme({ '&': { fontSize: `${fontSize}px` } })),
          readOnlyComp.current.of(EditorState.readOnly.of(readOnly)),
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current?.(update.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = v;
    v.focus();
    return () => { v.destroy(); view.current = null; };
    // Built once. Every prop above is reconfigured through a compartment below, because
    // rebuilding the view would throw away the cursor, the scroll position and the undo
    // history on every font-size nudge.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // An external value change means the script being edited changed under us. A change
  // typed here comes back through onChange as the same string, so this is a no-op then.
  React.useEffect(() => {
    const v = view.current;
    if (!v || value === v.state.doc.toString()) return;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  React.useEffect(() => {
    view.current?.dispatch({ effects: themeComp.current.reconfigure(themeFor(theme)) });
  }, [theme]);

  React.useEffect(() => {
    view.current?.dispatch({ effects: fontComp.current.reconfigure(
      EditorView.theme({ '&': { fontSize: `${fontSize}px` } })) });
  }, [fontSize]);

  React.useEffect(() => {
    view.current?.dispatch({ effects: readOnlyComp.current.reconfigure(
      EditorState.readOnly.of(readOnly)) });
  }, [readOnly]);

  React.useEffect(() => {
    const v = view.current;
    if (!v) return;
    v.dispatch(setDiagnostics(v.state, toDiagnostics(v.state, error)));
  }, [error]);

  return <div ref={host} className={className} />;
});

/**
 * @param error `{lineNumber, message}` from the engine, 1-indexed.
 */
function toDiagnostics (state, error) {
  if (!error || !error.lineNumber) return [];
  // An error can outlive the edit that shortened the document, so a stale line number has
  // to be clamped rather than thrown at CodeMirror, which rejects out-of-range positions.
  const lineNo = Math.max(1, Math.min(state.doc.lines, error.lineNumber));
  const line = state.doc.line(lineNo);
  return [{ from: line.from, to: line.to, severity: 'error', message: error.message ?? 'Error' }];
}
