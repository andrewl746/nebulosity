// Package api serves the shop.
package api

import (
	"fmt"

	"example.com/shop/internal/store"
	"github.com/other/lib"
)

// Version is the API's version.
const Version = "v1"

var limit = 10

// Open makes the API's store, logging its default size.
func Open() *store.Store {
	lib.Log(fmt.Sprintf("open %d", store.DefaultSize))
	return store.New(limit)
}
