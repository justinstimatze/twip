package main

import (
	"flag"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Flags have to work after the filename, because that is the order everyone writes.
// The stdlib parser stops at the first positional, and the resulting failure is the quiet kind:
// --in-place is present on the command line, is never parsed, and the edit refuses to write
// with a message telling you to pass the flag you just passed.
func TestFlagsParseOnEitherSideOfTheFilename(t *testing.T) {
	build := func() (*flag.FlagSet, *string, *bool, *int) {
		fs := flag.NewFlagSet("t", flag.ContinueOnError)
		fs.SetOutput(discard{})
		name := fs.String("name", "", "")
		inPlace := fs.Bool("in-place", false, "")
		index := fs.Int("index", -1, "")
		return fs, name, inPlace, index
	}

	for _, args := range [][]string{
		{"f.wick", "--name", "Sky", "--index", "0", "--in-place"},
		{"--name", "Sky", "--index", "0", "--in-place", "f.wick"},
		{"--name=Sky", "f.wick", "--in-place", "--index=0"},
		{"--in-place", "f.wick", "--name", "Sky", "--index", "0"},
	} {
		fs, name, inPlace, index := build()
		if err := parse(fs, args); err != nil {
			t.Fatalf("%v: %v", args, err)
		}
		if *name != "Sky" || !*inPlace || *index != 0 {
			t.Errorf("%v gave name=%q in-place=%v index=%d", args, *name, *inPlace, *index)
		}
		if fs.NArg() != 1 || fs.Arg(0) != "f.wick" {
			t.Errorf("%v gave positionals %v", args, fs.Args())
		}
	}
}

// A flag value that looks like a filename is a value, not a positional.
func TestAFlagValueIsNotMistakenForTheFilename(t *testing.T) {
	fs := flag.NewFlagSet("t", flag.ContinueOnError)
	fs.SetOutput(discard{})
	src := fs.String("src-file", "", "")
	if err := parse(fs, []string{"--src-file", "script.js", "doc.wick"}); err != nil {
		t.Fatal(err)
	}
	if *src != "script.js" {
		t.Errorf("src-file is %q", *src)
	}
	if fs.NArg() != 1 || fs.Arg(0) != "doc.wick" {
		t.Errorf("positionals are %v", fs.Args())
	}
}

// Everything after -- is a filename, even if it starts with a dash.
func TestDoubleDashEndsTheFlags(t *testing.T) {
	fs := flag.NewFlagSet("t", flag.ContinueOnError)
	fs.SetOutput(discard{})
	inPlace := fs.Bool("in-place", false, "")
	if err := parse(fs, []string{"--in-place", "--", "-weird-name.wick"}); err != nil {
		t.Fatal(err)
	}
	if !*inPlace {
		t.Error("--in-place before -- was not parsed")
	}
	if fs.NArg() != 1 || fs.Arg(0) != "-weird-name.wick" {
		t.Errorf("positionals are %v", fs.Args())
	}
}

// The compiler is identified by a literal from its own usage text, which lives in another
// language's source file and can be reworded without anything here noticing. If it is, twipdoc
// stops recognising the real compiler and starts reporting that it cannot find one — so the two
// copies of that string are checked against each other rather than trusted to stay in step.
func TestTheUsageMarkStillNamesTheCompiler(t *testing.T) {
	src, err := os.ReadFile("../../src/main.rs")
	if err != nil {
		t.Skipf("no compiler source to check against: %v", err)
	}
	if !strings.Contains(string(src), usageMark) {
		t.Errorf("src/main.rs no longer contains %q, so twipdoc cannot recognise the compiler", usageMark)
	}
}

// Identifying a candidate must not run it. The desktop app is on PATH under the same name and
// is a GUI: a probe that executes to find out opens a window every time it guesses wrong.
func TestIdentifyingABinaryDoesNotRunIt(t *testing.T) {
	dir := t.TempDir()
	marker := filepath.Join(dir, "ran")
	script := filepath.Join(dir, "twip")
	body := "#!/bin/sh\ntouch " + marker + "\n"
	if err := os.WriteFile(script, []byte(body), 0o755); err != nil {
		t.Fatal(err)
	}
	if isCompiler(script) {
		t.Error("a shell script was accepted as the compiler")
	}
	if _, err := os.Stat(marker); err == nil {
		t.Error("isCompiler executed the candidate")
	}
}

type discard struct{}

func (discard) Write(p []byte) (int, error) { return len(p), nil }
