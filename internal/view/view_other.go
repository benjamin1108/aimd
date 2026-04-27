//go:build !darwin

package view

import "errors"

type Options struct {
	Input  string
	Width  int
	Height int
	Title  string
}

func Run(opt Options) error {
	return errors.New("aimd view: native window is currently macOS-only; use 'aimd preview' on this platform")
}
