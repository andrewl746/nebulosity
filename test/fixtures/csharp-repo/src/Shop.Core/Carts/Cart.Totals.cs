using System.Linq;

namespace Shop.Core.Carts;

public partial class Cart
{
    public Money Subtotal => new(_lines.Sum(line => line.ListPrice.Amount), "EUR");
}
