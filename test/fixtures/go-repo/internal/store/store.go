// Package store keeps the shop's items.
package store

// MaxItems caps a store; minItems is its floor.
const (
	MaxItems = 100
	minItems = 1
)

// Key names an item.
type Key = string

// Store holds items by key.
type Store struct {
	items map[Key]int
	Size  int
}

// Getter reads one item.
type Getter interface {
	Get(key Key) (int, bool)
	Len() int
}

// New makes an empty store of at least minItems.
func New(size int) *Store {
	if size < minItems {
		size = DefaultSize
	}
	return &Store{items: make(map[Key]int), Size: size}
}

// Get reads one item.
func (s *Store) Get(key Key) (int, bool) {
	v, ok := s.items[key]
	return v, ok
}
