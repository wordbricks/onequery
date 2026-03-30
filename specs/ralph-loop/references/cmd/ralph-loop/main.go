package main

import (
	"os"

	"github.com/dev/ralph-loop.spec/internal/ralphloop"
)

func main() {
	cwd, err := os.Getwd()
	if err != nil {
		_, _ = os.Stderr.WriteString(err.Error() + "\n")
		os.Exit(1)
	}
	os.Exit(ralphloop.Run(os.Args[1:], cwd, os.Stdin, os.Stdout, os.Stderr))
}
