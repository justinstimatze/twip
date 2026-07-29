// twip desktop shell.
//
// Loads the editor's Vite build from ../build and exposes the twip compiler as an
// in-process Tauri command, so the SWF button compiles .wick -> .swf without the dev
// HTTP bridge on :8752.

/// Compile serialized .wick bytes to .swf bytes via the twip compiler.
///
/// The frontend passes the .wick file as a byte array (Array.from(Uint8Array)); we
/// return the .swf as a raw byte response, which reaches JS as an ArrayBuffer.
///
/// `upsample` is optional and defaults to on, matching the library default — the desktop
/// shell should not be the one route that quietly compiles something different.
#[tauri::command]
fn compile_swf(wick: Vec<u8>, upsample: Option<bool>) -> Result<tauri::ipc::Response, String> {
    let opts = twip::Options {
        upsample: upsample.unwrap_or(true),
    };
    twip::compile_wick_with(&wick, &opts)
        .map(tauri::ipc::Response::new)
        .map_err(|e| format!("{:#}", e))
}

/// Ask for a destination, then write the bytes there.
///
/// Every export in the editor funnels through `window.saveFileFromWick`, whose browser
/// implementation is a FileSaver blob download. In this shell that download does land on
/// disk — WebKitGTK writes it to the user's Downloads directory — but only because wry
/// leaves `decide-destination` unhandled and WebKitGTK falls back to its own default. The
/// user is never asked, cannot choose, and nothing twip wrote is what decides. This makes
/// the destination twip's decision.
///
/// Returns the chosen path, or None when the dialog is dismissed.
///
/// `AsyncFileDialog` over the blocking one because GTK dialogs want the main thread and
/// Tauri commands do not run on it; with the `xdg-portal` feature rfd goes through the
/// desktop portal instead, which is callable from anywhere.
#[tauri::command]
async fn save_file(name: String, data: Vec<u8>) -> Result<Option<String>, String> {
    let Some(handle) = rfd::AsyncFileDialog::new()
        .set_file_name(&name)
        .save_file()
        .await
    else {
        return Ok(None);
    };
    let path = handle.path().to_path_buf();
    std::fs::write(&path, &data).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(Some(path.display().to_string()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![compile_swf, save_file])
        .run(tauri::generate_context!())
        .expect("error while running twip-editor");
}
