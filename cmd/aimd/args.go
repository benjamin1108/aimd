package main

import (
	"flag"
	"strings"
)

// permute reorders args so all flags appear before positional arguments.
// This mirrors GNU getopt behaviour and lets users write either
// `aimd pack input.md -o out.aimd` or `aimd pack -o out.aimd input.md`.
//
// Flags whose Value implements `IsBoolFlag() bool` consume no value;
// everything else consumes the next token as the value.
func permute(fs *flag.FlagSet, args []string) []string {
	var flags, positional []string
	for i := 0; i < len(args); i++ {
		a := args[i]
		if a == "--" {
			positional = append(positional, args[i+1:]...)
			break
		}
		if !strings.HasPrefix(a, "-") || a == "-" {
			positional = append(positional, a)
			continue
		}
		flags = append(flags, a)
		// `-flag=value` already includes the value.
		if strings.Contains(a, "=") {
			continue
		}
		name := strings.TrimLeft(a, "-")
		def := fs.Lookup(name)
		if def == nil {
			// Unknown flag: leave value handling to flag.Parse so it can error.
			continue
		}
		if isBoolFlag(def) {
			continue
		}
		if i+1 < len(args) {
			i++
			flags = append(flags, args[i])
		}
	}
	return append(flags, positional...)
}

func isBoolFlag(f *flag.Flag) bool {
	type boolFlag interface{ IsBoolFlag() bool }
	if bf, ok := f.Value.(boolFlag); ok {
		return bf.IsBoolFlag()
	}
	return false
}
