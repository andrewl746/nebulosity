// Package widgets draws the shop's widgets.
package widgets

// Render draws one widget.
func Render(name string) string {
	return "[" + name + "]"
}

// Box holds one widget of any kind.
type Box[T any] struct {
	Item T
}

// Unwrap returns the widget.
func (b Box[T]) Unwrap() T {
	return b.Item
}
