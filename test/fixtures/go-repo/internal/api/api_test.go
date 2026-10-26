package api_test

import (
	"testing"

	"example.com/shop/internal/api"
)

func TestOpen(t *testing.T) {
	if api.Open() == nil {
		t.Fatal("no store")
	}
}
