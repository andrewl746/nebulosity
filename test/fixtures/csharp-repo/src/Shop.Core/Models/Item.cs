namespace Shop.Core.Models;

/// <summary>A line of an order: what was bought, at what price.</summary>
public sealed record Item(string Sku, Money Price)
{
    public bool IsFree => Price.Amount == 0m;
}
