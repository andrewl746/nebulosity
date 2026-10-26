package store

// DefaultSize is the size New falls back to.
var DefaultSize = 16

// Empty is a store with nothing in it.
var Empty = &Store{}

// Len counts the items.
func (s *Store) Len() int {
	return len(s.items)
}
