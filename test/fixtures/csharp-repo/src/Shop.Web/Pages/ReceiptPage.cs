using Receipt = Shop.Core.Models.Order;

namespace Shop.Web.Pages;

[Core.Auditing.Audited]
public class ReceiptPage : PageBase<Receipt>
{
    public override string Title => "Receipt";

    public Rounding Mode { get; } = Rounding.Up;

    public string Describe(Receipt receipt) => receipt.Status.ToString();
}
