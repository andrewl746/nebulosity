// Package lint checks the shop's code.
package lint

// Check reports whether a name is clean.
func Check(name string) bool {
	return name != ""
}
