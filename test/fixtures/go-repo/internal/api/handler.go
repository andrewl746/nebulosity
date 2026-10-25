package api

import (
	st "example.com/shop/internal/store"
)

// Handler answers one request.
type Handler struct {
	Store st.Getter
}

// Serve reads one item, tagged with the version.
func (h Handler) Serve(key string) (int, string) {
	n, _ := h.Store.Get(key)
	return n, Version + Routes()[0]
}

// label counts to its own limit, not the package's.
func label() int {
	limit := 3
	return limit * 2
}
