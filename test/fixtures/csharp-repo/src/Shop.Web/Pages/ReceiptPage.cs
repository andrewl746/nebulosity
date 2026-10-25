using Receipt = Shop.Core.Models.Order;

namespace Shop.Web.Pages;

public class ReceiptPage : PageBase<Receipt>
{
    public override string Title => "Receipt";

    public Rounding Mode { get; } = Rounding.Up;

    public string Describe(Receipt receipt) => receipt.Status.ToString();
}
