using Shop.Core.Carts;
using Shop.Core.Catalog;
using Shop.Shared;
using static Shop.Core.Pricing.PriceMath;

namespace Shop.Core
{
    namespace Pricing
    {
        public class PriceCalculator
        {
            public Money Total(Cart cart, Item extra)
            {
                Guard.NotNull(cart, nameof(cart));
                var amount = Round(cart.Subtotal.Amount + extra.ListPrice.Amount, Rounding.Up);
                return new Money(amount, "EUR");
            }
        }
    }
}
