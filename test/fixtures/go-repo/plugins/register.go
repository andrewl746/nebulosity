package plugins

// Register adds a plugin by name.
func Register(name string) {
	registered = append(registered, name)
}
