/*
 * Desktop file handlers.
 *
 * filehandler.js says platforms should supply their own save implementations, and defines
 * browser defaults otherwise. Under the Tauri shell the browser default does reach disk —
 * WebKitGTK writes an unhandled download to ~/Downloads — but the user is never asked where,
 * and that destination comes from a library default rather than from anything twip chose.
 * This replaces it with a real save dialog.
 *
 * Installed AFTER initializeDefaultFileHandlers rather than before it, which is the opposite
 * of what filehandler.js suggests. Installing first lands in its `else` branch, which wraps
 * the handler in an "Overwrite Save?" prompt driven by getSavedWickFiles — a list of
 * localStorage projects, not files on disk. A native dialog already asks about overwriting
 * the real file, so that wrapper would ask a second time about something else.
 */

/**
 * Point the editor's save path at a native dialog. No-op outside the desktop shell.
 * @returns {boolean} true if the desktop handlers were installed.
 */
export default function installTauriFileHandlers() {
  const tauri = window.__TAURI__;
  if (!tauri || !tauri.core) return false;

  window.saveFileFromWick = (file, name, extension, successCallback, failureCallback) => {
    const filename = name + extension;
    file
      .arrayBuffer()
      .then((buf) =>
        // Array.from because that is how compile_swf already passes bytes across. Fine for a
        // .wick; a large GIF or video export would be worth moving to a raw request body.
        tauri.core.invoke('save_file', {
          name: filename,
          data: Array.from(new Uint8Array(buf)),
        }))
      .then((path) => {
        if (path === null) {
          // Dismissed. Nothing was written, so this is not success — but the callers'
          // failure copy reads "Error saving...", which overstates a deliberate cancel.
          // Worth a third outcome in the handler signature eventually.
          failureCallback && failureCallback();
          return;
        }
        successCallback && successCallback();
      })
      .catch((err) => {
        console.error('save_file failed:', err);
        failureCallback && failureCallback();
      });
  };

  return true;
}
