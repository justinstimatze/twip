/*
 * hotkeys.js — binds hotKeyMap.js's sequences to the keyboard, and records new ones.
 *
 * This replaces react-hotkeys, whose last release was 2020, whose peer range stops at React 17,
 * and which weighed 60kB of the bundle against tinykeys' 2.4kB. Thirteen of the fourteen cases in
 * dev/hotkeys-check.mjs were recorded against react-hotkeys before any of this was written and
 * pass unchanged after it; behaving identically is most of the result.
 *
 * The fourteenth is a fix, and it is the recorder at the bottom of this file. Assign a custom
 * shortcut in the settings modal, press Ctrl+Shift+. , and the old library handed back the key
 * first and the modifiers after, in the order it happened to notice them: the settings row read
 * `. + control + shift`, and the sequence it stored bound nothing at all, because a parser that
 * takes the last part as the key was handed `shift`. Chords could be displayed but not assigned.
 *
 * The sequences this translates are not tinykeys patterns, and the gap is not only spelling.
 *
 * `meta` never reaches here. hotKeyMap's raw sequences say `meta+z`, but getKeyMap() rewrites
 * `meta` to `ctrl` on every platform except a Mac, where it becomes `cmd`, before anything is
 * bound — so the string handed over already names the key the user presses, and `$mod` on top of
 * it would resolve the same choice twice. `meta` is still accepted below, because a custom
 * hotkey recorded by the old library and saved to localForage can contain it, and there it means
 * the Meta key literally. Translating the raw map instead of getKeyMap()'s output would move
 * every clipboard, undo and save shortcut onto Super; dev/hotkeys-check.mjs asserts it does not.
 *
 * Shift changes what a key reports. `shift+.` cannot bind against `.`, because with Shift held
 * the browser says the key is `>`; only KeyboardEvent.code stays `Period`. So a chord containing
 * Shift binds by code and everything else binds by character. Codes name physical positions, so
 * on a layout that moves the punctuation the shifted shortcuts follow the position rather than
 * the label — which is the same trade every editor that binds Ctrl+Shift+K makes, and it beats
 * the alternative of binding nothing at all.
 */
import { tinykeys } from 'tinykeys';

/* Modifier spellings, ours and the old library's, folded together. */
const MODIFIERS = {
  ctrl: 'Control', control: 'Control',
  cmd: 'Meta', command: 'Meta', meta: 'Meta', super: 'Meta',
  alt: 'Alt', option: 'Alt',
  shift: 'Shift',
};

/* Keys with no printable character. Left of the arrow is every spelling either the default map
 * or a combination recorded by react-hotkeys can produce. */
const NAMED_KEYS = {
  up: 'ArrowUp', arrowup: 'ArrowUp',
  down: 'ArrowDown', arrowdown: 'ArrowDown',
  left: 'ArrowLeft', arrowleft: 'ArrowLeft',
  right: 'ArrowRight', arrowright: 'ArrowRight',
  del: 'Delete', delete: 'Delete',
  backspace: 'Backspace',
  space: 'Space', spacebar: 'Space', ' ': 'Space',
  esc: 'Escape', escape: 'Escape',
  enter: 'Enter', return: 'Enter',
  tab: 'Tab',
  home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown',
};

/* KeyboardEvent.code for the printable keys, used only when Shift is in the chord. */
const PUNCTUATION_CODES = {
  '.': 'Period', ',': 'Comma', '[': 'BracketLeft', ']': 'BracketRight',
  '`': 'Backquote', '-': 'Minus', '=': 'Equal', ';': 'Semicolon',
  "'": 'Quote', '/': 'Slash', '\\': 'Backslash',
};

/* The same keys as they print with Shift already held. Nothing in the default map spells a
 * sequence this way and neither does the recorder below, which reads the code instead — but a
 * custom hotkey saved by react-hotkeys can, and 'shift+>' should bind the same key 'shift+.'
 * does rather than quietly bind nothing. */
const SHIFTED_CHARS = {
  '>': 'Period', '<': 'Comma', '{': 'BracketLeft', '}': 'BracketRight',
  '~': 'Backquote', '_': 'Minus', '+': 'Equal', ':': 'Semicolon',
  '"': 'Quote', '?': 'Slash', '|': 'Backslash',
  '!': 'Digit1', '@': 'Digit2', '#': 'Digit3', '$': 'Digit4', '%': 'Digit5',
  '^': 'Digit6', '&': 'Digit7', '*': 'Digit8', '(': 'Digit9', ')': 'Digit0',
};

const codeFor = (key) => {
  if (/^[a-z]$/.test(key)) return `Key${key.toUpperCase()}`;
  if (/^[0-9]$/.test(key)) return `Digit${key}`;
  return PUNCTUATION_CODES[key] ?? SHIFTED_CHARS[key] ?? null;
};

/**
 * Translates one sequence from hotKeyMap's vocabulary into a tinykeys pattern.
 * @param {string} sequence e.g. 'ctrl+shift+.', 'b', 'shift+up'
 * @returns {string|null} e.g. 'Control+Shift+Period', 'b', 'Shift+ArrowUp'
 */
export function toKeybinding(sequence) {
  if (typeof sequence !== 'string' || sequence.trim() === '') return null;

  // The separator is also a key: 'shift++' splits to ['shift', '', ''], where the two empties are
  // the separator and the key. A single trailing empty is a malformed 'a+' instead, and falls
  // through to be reported rather than quietly binding the plus key on its own.
  let parts = sequence.trim().toLowerCase().split('+');
  if (parts.length > 2 && parts[parts.length - 1] === '' && parts[parts.length - 2] === '') {
    parts = [...parts.slice(0, -2), '+'];
  } else if (sequence.trim() === '+') {
    parts = ['+'];
  }

  // The grammar is positional: everything but the last part is a modifier, the last is the key.
  const key = parts[parts.length - 1];
  const mods = [];
  for (const part of parts.slice(0, -1)) {
    const modifier = MODIFIERS[part];
    if (!modifier) return null;
    if (!mods.includes(modifier)) mods.push(modifier);
  }
  // A chord of nothing but modifiers is not a shortcut. Returning null reports it as dropped;
  // passing it through would emit a pattern tinykeys can parse and can never match.
  if (!key || MODIFIERS[key]) return null;

  const named = NAMED_KEYS[key];
  const resolved = named ?? (mods.includes('Shift') ? codeFor(key) : key);
  if (!resolved || resolved.length === 0) return null;
  // A space inside a pattern means "press these in order" to tinykeys, which no sequence here
  // ever intends — NAMED_KEYS turns the space key into 'Space' for exactly this reason.
  if (/\s/.test(resolved)) return null;

  return [...mods, resolved].join('+');
}

/* getKeyMap() hands back either a string or {sequence, action:'keyup'}. */
const readSequence = (entry) => {
  if (typeof entry === 'string') return { sequence: entry, keyup: false };
  if (entry && typeof entry === 'object') {
    return { sequence: entry.sequence, keyup: entry.action === 'keyup' };
  }
  return { sequence: null, keyup: false };
};

/**
 * Builds the two pattern-to-action tables tinykeys needs, one per event type.
 * @param {Object} keyMap getKeyMap()'s output: action name to {name, sequences}
 * @returns {{keydown: Object, keyup: Object, dropped: Array}}
 */
export function buildBindings(keyMap) {
  const keydown = {};
  const keyup = {};
  const dropped = [];

  for (const action of Object.keys(keyMap || {})) {
    for (const entry of keyMap[action].sequences || []) {
      const { sequence, keyup: onKeyUp } = readSequence(entry);
      const pattern = toKeybinding(sequence);
      if (!pattern) {
        if (sequence) dropped.push(`${action}: ${JSON.stringify(sequence)}`);
        continue;
      }
      const table = onKeyUp ? keyup : keydown;
      // First binding wins. The one duplicate in the default map is deliberate — the script
      // editor lists the backquote twice, once per browser's spelling of it — so only a
      // collision between two different actions is worth saying anything about.
      if (table[pattern] && table[pattern] !== action) {
        dropped.push(`${action}: ${pattern} already bound to ${table[pattern]}`);
        continue;
      }
      table[pattern] = action;
    }
  }

  return { keydown, keyup, dropped };
}

/**
 * Binds a keymap to the window until the returned function is called.
 * @param {Object} keyMap getKeyMap()'s output.
 * @param {Function} getHandlers called at fire time, so a rebind is not needed when a handler
 *                               identity changes — only when the sequences do.
 * @returns {Function} unbind
 */
export function bindHotKeys(keyMap, getHandlers) {
  const { keydown, keyup, dropped } = buildBindings(keyMap);
  if (dropped.length && import.meta.env?.DEV) {
    console.warn(`hotkeys: ${dropped.length} sequence(s) not bound —`, dropped);
  }

  const fire = (table) => {
    const bindings = {};
    for (const [pattern, action] of Object.entries(table)) {
      bindings[pattern] = (event) => {
        const handler = getHandlers()[action];
        if (handler) handler(event);
      };
    }
    return bindings;
  };

  // tinykeys skips input, select, textarea and anything contenteditable on its own, which is the
  // only reason typing a script does not pick up the brush — CodeMirror's surface is a
  // contenteditable div, so the tag list every keyboard library ships would miss it. It also
  // skips auto-repeat, leaving the repeat in hotKeyMap's own timers where the keyup that clears
  // them can be trusted to be the last one.
  const stopKeyDown = tinykeys(window, fire(keydown), { event: 'keydown' });
  const stopKeyUp = tinykeys(window, fire(keyup), { event: 'keyup' });

  return () => { stopKeyDown(); stopKeyUp(); };
}

const RECORD_MODIFIERS = { Control: 'ctrl', Meta: 'cmd', Alt: 'alt', Shift: 'shift' };
/* KeyboardEvent.code back to the character it prints unshifted, so a recorded Shift+8 is stored
 * as 'shift+8' the way the default map spells it rather than as 'shift+*'. */
const CODE_TO_KEY = Object.fromEntries([
  ...Object.entries(PUNCTUATION_CODES).map(([key, code]) => [code, key]),
  ...'abcdefghijklmnopqrstuvwxyz'.split('').map((c) => [`Key${c.toUpperCase()}`, c]),
  ...'0123456789'.split('').map((d) => [`Digit${d}`, d]),
]);
const KEY_TO_NAME = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  Delete: 'del', Backspace: 'backspace', ' ': 'space', Escape: 'esc', Enter: 'enter', Tab: 'tab',
};

/**
 * Captures the next key combination the user presses and hands it back in hotKeyMap's own
 * spelling, because the settings table renders these strings as the shortcut's label.
 *
 * @param {Function} callback receives {id, keys} — id like 'ctrl+shift+.', keys a set-shaped
 *                            object of its parts, which is the shape the settings modal reads.
 * @returns {Function} cancel, safe to call more than once
 */
export function recordKeyCombination(callback) {
  const onKeyDown = (event) => {
    if (!event.key) return;
    // Wait for something to modify: a chord is not finished while only Shift is down.
    if (RECORD_MODIFIERS[event.key]) return;

    const parts = [];
    for (const [modifier, name] of Object.entries(RECORD_MODIFIERS)) {
      if (event.getModifierState && event.getModifierState(modifier)) parts.push(name);
    }
    const base = KEY_TO_NAME[event.key]
      ?? CODE_TO_KEY[event.code]
      ?? event.key.toLowerCase();
    parts.push(base);

    // Ctrl+S while recording should not open the browser's save dialog.
    event.preventDefault();
    cancel();
    callback({
      id: parts.join('+'),
      keys: Object.fromEntries(parts.map((part) => [part, true])),
    });
  };

  // Capture, so a field or the script editor cannot eat the combination being recorded.
  const cancel = () => window.removeEventListener('keydown', onKeyDown, true);
  window.addEventListener('keydown', onKeyDown, true);
  return cancel;
}
