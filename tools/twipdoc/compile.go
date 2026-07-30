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
	if dir, err := os.Getwd(); err == nil {
		for {
			candidates = append(candidates, filepath.Join(dir, "target", "release", "twip"))
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

// isCompiler asks a candidate to identify itself. Run with no arguments the CLI prints its
// usage and exits; the desktop app of the same name starts a window and never returns, so the
// timeout is part of the answer rather than a safety net around it.
func isCompiler(path string) bool {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, path)
	cmd.Stdin = strings.NewReader("")
	out, _ := cmd.CombinedOutput() // Usage goes out with a non-zero status; the text is the tell.
	return strings.Contains(string(out), "in.wick")
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
