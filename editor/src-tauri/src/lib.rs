// twip desktop shell.
//
// Loads the editor's Vite build from ../build and exposes the twip compiler as an
// in-process Tauri command, so the SWF button compiles .wick -> .swf without the dev
// HTTP bridge on :8752.

/// Compile serialized .wick bytes to .swf bytes via the twip compiler.
///
/// The frontend passes the .wick file as a byte array (Array.from(Uint8Array)); we
/// return the .swf as a raw byte response, which reaches JS as an ArrayBuffer.
#[tauri::command]
fn compile_swf(wick: Vec<u8>) -> Result<tauri::ipc::Response, String> {
    twip::compile_wick(&wick)
        .map(tauri::ipc::Response::new)
        .map_err(|e| format!("{:#}", e))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![compile_swf])
        .run(tauri::generate_context!())
        .expect("error while running twip-editor");
}
