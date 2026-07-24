#!/usr/bin/env python3
"""twip bridge — throwaway dev server for the editor's "Export to SWF" button.

The browser can't shell out, so the editor POSTs the current project's .wick bytes
here; we run the twip compiler and hand back the .swf. This exists only until the
Tauri desktop shell makes the compile an in-process Rust call — do not grow it.

    POST /compile   body = .wick bytes   -> 200 .swf bytes (application/x-shockwave-flash)
                                          -> 400 text/plain (compiler stderr) on failure
    GET  /health    -> 200 "ok"

Env:
    TWIP_BIN   path to the release twip binary (default: ../twip/target/release/twip
               relative to this repo, i.e. the sibling twip checkout)
    TWIP_PORT  listen port (default 8752)
"""
import http.server
import os
import subprocess
import sys
import tempfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_BIN = os.path.normpath(os.path.join(REPO, "..", "twip", "target", "release", "twip"))
TWIP_BIN = os.environ.get("TWIP_BIN", DEFAULT_BIN)
PORT = int(os.environ.get("TWIP_PORT", "8752"))

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}


class Handler(http.server.BaseHTTPRequestHandler):
    def _cors(self):
        for k, v in CORS.items():
            self.send_header(k, v)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path == "/health":
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"ok")
        else:
            self.send_error(404)

    def do_POST(self):
        if self.path != "/compile":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", 0))
        wick = self.rfile.read(length)
        with tempfile.TemporaryDirectory() as d:
            inp = os.path.join(d, "in.wick")
            out = os.path.join(d, "out.swf")
            with open(inp, "wb") as f:
                f.write(wick)
            proc = subprocess.run(
                [TWIP_BIN, inp, out], capture_output=True, text=True
            )
            if proc.returncode != 0 or not os.path.exists(out):
                msg = (proc.stderr or proc.stdout or "twip failed").encode()
                self.send_response(400)
                self._cors()
                self.send_header("Content-Type", "text/plain")
                self.end_headers()
                self.wfile.write(msg)
                self.log_message("compile FAILED (%d): %s", proc.returncode, proc.stderr.strip())
                return
            with open(out, "rb") as f:
                swf = f.read()
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "application/x-shockwave-flash")
        self.send_header("Content-Length", str(len(swf)))
        self.end_headers()
        self.wfile.write(swf)
        self.log_message("compiled %d wick bytes -> %d swf bytes", len(wick), len(swf))


def main():
    if not os.path.exists(TWIP_BIN):
        sys.exit(f"twip binary not found at {TWIP_BIN}; set TWIP_BIN or `cargo build --release --bin twip`")
    print(f"twip bridge on http://127.0.0.1:{PORT}  (binary: {TWIP_BIN})")
    http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
