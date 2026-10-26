// Package plugins registers the shop's plugins when it is imported.
package plugins

var registered []string

func init() {
	registered = append(registered, "base")
}
