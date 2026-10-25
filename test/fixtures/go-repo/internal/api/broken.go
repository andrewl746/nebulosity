package api

import "example.com/shop/internal/text"

// Shout is read before the error.
func Shout() string {
	return text.Upper("x")
}

)))

// Width is read after the error, from the package's limit.
func Width() int {
	return limit * 2
}
