// Compiling, by shelling out to twip rather than reimplementing it.
//
// The compiler is a large Rust program and there will only ever be one of it. What matters here
// is that the report comes back with the bytes: `twip` writes what it could not carry to
// stderr, and an agent that gets only an exit code learns that the compile succeeded without
// learning that the title card is missing from the movie.

package main

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// CompileResult is what an agent needs to know about a compile: where the movie went, how big
// it is, and — the part an exit code cannot say — what the document had that the movie does not.
type CompileResult struct {
	Input   string `json:"input"`
	Output  string `json:"output"`
	Bytes   int64  `json:"bytes"`
	Skipped string `json:"skipped,omitempty"`
	Binary  string `json:"binary"`
}

// twipBinary finds the compiler: TWIP_BIN if set, else the release build in the surrounding
// checkout, else PATH.
//
// The checkout beats PATH, and that order is not arbitrary. This box has a /usr/bin/twip that
// is the desktop app — same name, 61MB of Tauri, and it does not exit when run headless, so
// LookPath finding it first turned the test suite into a process that never came back. A build
// tool in a checkout should mean the thing that was just built.
//
// Whatever is chosen is checked for being the CLI before it is trusted, because the failure
// this guards against is not "missing" — it is "present, wrong, and named the same".
func twipBinary() (string, error) {
	if p := os.Getenv("TWIP_BIN"); p != "" {
		if _, err := os.Stat(p); err != nil {
			return "", fmt.Errorf("TWIP_BIN=%s: %w", p, err)
		}
		return p, nil // Explicit wins; if the caller named it, the caller meant it.
	}

	var candidates []string
	// Walk up looking for a cargo target dir, so this works from anywhere inside the checkout.
	// Debug counts as well as release: `cargo build` leaves one there and it compiles the same
	// movie, only slower. Taking release only meant CI — which builds debug — found no compiler
	// at all and skipped the tests that need one, quietly and in green.
	if dir, err := os.Getwd(); err == nil {
		for {
			for _, profile := range []string{"release", "debug"} {
				candidates = append(candidates, filepath.Join(dir, "target", profile, "twip"))
			}
			parent := filepath.Dir(dir)
			if parent == dir {
				break
			}
			dir = parent
		}
	}
	if p, err := exec.LookPath("twip"); err == nil {
		candidates = append(candidates, p)
	}

	var rejected []string
	for _, c := range candidates {
		if _, err := os.Stat(c); err != nil {
			continue
		}
		if isCompiler(c) {
			return c, nil
		}
		rejected = append(rejected, c)
	}
	if len(rejected) > 0 {
		return "", fmt.Errorf("found %v, but none of them is the twip compiler (the desktop app "+
			"shares the name) — point TWIP_BIN at the CLI", rejected)
	}
	return "", fmt.Errorf("no twip binary: set TWIP_BIN, or `cargo build --release`")
}

// usageMark is a literal from the compiler CLI's own usage text (`src/main.rs`). The desktop
// app links the twip *library*, not that binary's `main`, so the string is in one and not the
// other. TestTheUsageMarkStillNamesTheCompiler fails if the two ever drift apart.
const usageMark = "twip [--no-upsample] <in.wick>"

// isCompiler identifies a candidate by reading it, never by running it.
//
// The first version asked each candidate to print its usage. That works, and it also opens a
// window every time it meets the desktop app — which is on PATH, is named twip, and is a GUI.
// Running an unknown binary to find out what it is has the order backwards: by the time it
// answers, it has already done whatever it does.
func isCompiler(path string) bool {
	f, err := os.Open(path)
	if err != nil {
		return false
	}
	defer f.Close()

	needle := []byte(usageMark)
	buf := make([]byte, 1<<20)
	// Carry the tail of each chunk into the next, so a match lying across a chunk boundary is
	// still found rather than missed once every megabyte.
	keep := len(needle) - 1
	var carry []byte
	for {
		n, err := f.Read(buf)
		if n > 0 {
			window := append(carry, buf[:n]...)
			if bytes.Contains(window, needle) {
				return true
			}
			if len(window) > keep {
				carry = append([]byte(nil), window[len(window)-keep:]...)
			} else {
				carry = window
			}
		}
		if err != nil {
			return false
		}
	}
}

// Compile runs the compiler and returns its report.
func Compile(in, out string) (*CompileResult, error) {
	bin, err := twipBinary()
	if err != nil {
		return nil, err
	}
	// Bounded, because a compile that never returns is the one failure a caller cannot report:
	// an agent waiting on this has no way to distinguish it from a slow document.
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	var stdout, stderr bytes.Buffer
	cmd := exec.CommandContext(ctx, bin, in, out)
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return nil, fmt.Errorf("%s did not finish in 2 minutes — is it the compiler?", bin)
		}
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		return nil, fmt.Errorf("twip refused it: %s", msg)
	}

	res := &CompileResult{Input: in, Output: out, Binary: bin}
	if st, err := os.Stat(out); err == nil {
		res.Bytes = st.Size()
	}
	// The warning line reads "warning: <what> not in the movie — …"; the part worth returning
	// is what, not the sentence around it.
	for _, line := range strings.Split(stderr.String(), "\n") {
		line = strings.TrimSpace(line)
		rest, found := strings.CutPrefix(line, "warning:")
		if !found {
			continue
		}
		if what, _, ok := strings.Cut(strings.TrimSpace(rest), " not in the movie"); ok {
			res.Skipped = what
		} else {
			res.Skipped = strings.TrimSpace(rest)
		}
	}
	return res, nil
}
