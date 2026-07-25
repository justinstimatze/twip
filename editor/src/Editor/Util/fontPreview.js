/*
 * Loads the webfonts the font-family dropdown previews each face in.
 *
 * This used to be 157 `@import url('https://fonts.googleapis.com/...')` lines at the top of
 * _inspectorselector.scss, which vite hoists into the shipped stylesheet — so every editor
 * load made 157 blocking requests to Google before painting, 86% of the 183 requests the
 * page made at all, whether or not anyone ever opened the dropdown. Now nothing is fetched
 * until the dropdown opens.
 *
 * The faces themselves already ship: public/fonts/ holds 55MB of TTFs, which is what gets
 * imported as a project asset when you pick a font. Generating @font-face rules against
 * those instead of asking Google would drop the third party entirely and work offline —
 * measured and rejected, because Radix renders all 152 options at once and the TTFs are
 * 55MB where Google's subsetted woff2 for the same 152 faces is 2.22MB. Revisit if the
 * listbox ever virtualizes, or for the Tauri build where offline matters more.
 */

const ENDPOINT = 'https://fonts.googleapis.com/css';

/*
 * The v1 API takes families pipe-separated. All 152 in one URL is ~2.4kB, well inside what
 * browsers and Google accept, but chunking means a slow response for one batch does not
 * hold up the rest — the dropdown renders progressively instead of all at once.
 */
const FAMILIES_PER_REQUEST = 40;

let loaded = false;

/**
 * Inject the preview stylesheets. Idempotent — safe to call on every dropdown open.
 * @param {string[]} names font family names, e.g. ['Abril Fatface', 'Roboto']
 */
export function loadFontPreviews (names) {
  if (loaded || !names || names.length === 0) return;
  loaded = true;

  for (let i = 0; i < names.length; i += FAMILIES_PER_REQUEST) {
    const families = names.slice(i, i + FAMILIES_PER_REQUEST)
      .map((n) => n.trim().replace(/\s+/g, '+'))
      .join('|');
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `${ENDPOINT}?family=${families}`;
    link.dataset.fontPreview = String(i / FAMILIES_PER_REQUEST);
    document.head.appendChild(link);
  }
}
