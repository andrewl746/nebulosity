package paths

// Join puts the system's separator between two parts.
func Join(a, b string) string {
	return a + sep() + b
}
