using System.Collections.Generic;
using Shop.Core.Catalog;

namespace Shop.Core.Carts;

public partial class Cart
{
    private readonly List<Item> _lines = new();

    public IReadOnlyList<Item> Lines => _lines;

    public void Add(Item item) => _lines.Add(item);
}
