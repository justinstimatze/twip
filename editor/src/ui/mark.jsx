/*
 * The twip mark.
 *
 * A playhead: the flag and stem that rides a timeline's number line. It is the one object
 * that means "animation" without needing a caption, it is the shape the accent colour was
 * chosen for, and at 16px it is still two solid forms rather than a drawing — which the
 * mascot it replaces was not.
 *
 * The mascot was Wick's, and twip is not Wick; carrying someone else's character as this
 * program's own face was wrong on top of being off-brief. Wick's mark stays where it
 * belongs, in the credits (Modals/EditorInfo).
 *
 * Inline rather than an imported .svg because ToolIcon renders icons as <img>, which cannot
 * inherit `currentColor` — and the whole point of this mark is that it is the accent.
 */
import React from 'react';

export function TwipMark ({ className, title = 'twip' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      role="img"
      aria-label={title}
      fill="currentColor"
    >
      <path d="M4 3.5h16v6.2l-8 5.3-8-5.3z" />
      <rect x="11" y="14" width="2" height="7" rx="0.5" />
    </svg>
  );
}

/*
 * The wordmark. Lowercase, because the program is called twip and not TWIP, and tracked out
 * far enough that the four letters read as a name rather than a word in a sentence.
 */
export function TwipWordmark ({ className }) {
  return (
    <span className={className} style={{ letterSpacing: '0.14em' }}>twip</span>
  );
}
