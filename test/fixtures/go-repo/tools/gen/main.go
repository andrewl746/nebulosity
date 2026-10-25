package main

import (
	"os"

	"example.com/shop/tools/lint"
)

func main() {
	if !lint.Check(os.Args[0]) {
		os.Exit(1)
	}
}
