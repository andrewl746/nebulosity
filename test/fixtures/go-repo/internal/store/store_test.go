package store

import "testing"

func TestNew(t *testing.T) {
	s := New(0)
	if s.Size != DefaultSize || Empty.Len() != 0 {
		t.Fatalf("size %d", s.Size)
	}
}
