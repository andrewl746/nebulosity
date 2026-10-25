using Shop.Core.Time;

namespace Shop.Web.Pages;

public class CartPage : PageBase<Cart>
{
    public override string Title => "Cart";

    public void Refresh(IClock clock)
    {
        var shown = clock.Now +;
    }

    public Order? Last { get; set; }
}
