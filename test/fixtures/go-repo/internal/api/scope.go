package api

// Scope binds names in every way Go can, so none of them is the package's own.
func Scope[Version any](limit int, items ...Version) (total int) {
	type Handler int
	var Open Handler = 1
	const Shout = 2
	for Width := range items {
		total += Width * Shout
	}
	switch Routes := any(limit).(type) {
	case int:
		total += Routes + int(Open)
	}
	_ = items
	return total
}
