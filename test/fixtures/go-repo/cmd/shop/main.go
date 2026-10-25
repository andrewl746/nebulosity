// Command shop runs the shop.
package main

import (
	"fmt"

	"example.com/shop/internal/api"
	"example.com/shop/internal/paths"
	. "example.com/shop/internal/text"
	"example.com/shop/pkg/go-colors"
	"example.com/shop/pkg/widgets/v2"
	_ "example.com/shop/plugins"

	"github.com/other/kit/v2"
)

func main() {
	h := api.Handler{Store: api.Open()}
	n, v := h.Serve("apple")
	fmt.Println(Upper(v), n, colors.Red, paths.Join("a", "b"))
	kit.Run(widgets.Missing)
}
