package widgets

import "testing"

// Missing exists only in the package's tests.
func Missing() string { return Render("?") }

func TestRender(t *testing.T) {
	if Render("a") != "[a]" || Missing() != "[?]" {
		t.Fail()
	}
}
