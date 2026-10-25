using Shop.Web.Pages;
using Xunit;

namespace Shop.Web.IntegrationTests;

public class CheckoutScenarios
{
    [Fact]
    public void PageIsTitledForTheCart()
    {
        var page = new CheckoutPage(new Shop.Core.Time.SystemClock());
        Assert.Equal("Cart", page.Title);
    }
}
