using Shop.Core.Carts;
using Shop.Core.Pricing;
using Shop.Core.Tests.Fakes;
using Xunit;

namespace Shop.Core.Tests;

public class PriceCalculatorTests
{
    [Fact]
    public void AFreeExtraItemCostsNothing()
    {
        var services = new FakeServices().AddShop();
        var total = new PriceCalculator().Total(new Cart(), new Catalog.Item(new ProductCode("A-1"), Money.Zero));
        Assert.Equal(0m, total.Amount);
        Assert.Equal(1, services.Registrations);
    }
}
