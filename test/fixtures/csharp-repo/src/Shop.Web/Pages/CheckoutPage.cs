using System;
using Shop.Core.Auditing;
using Shop.Shared;

namespace Shop.Web.Pages;

/// <summary>The checkout page: it places the order for a cart.</summary>
[Audited]
public class CheckoutPage : PageBase<Order>
{
    public CheckoutPage(Clock clock)
    {
        StartedAt = clock.Now;
    }

    public DateTimeOffset StartedAt { get; }

    public override string Title => nameof(Cart);

    public Type ModelType => typeof(Item);

    public PriceCalculator Calculator { get; } = new();

    public Order Place(Cart cart, string customer)
    {
        Guard.NotBlank(customer);
        return new Shop.Core.Models.Order(Guid.NewGuid(), cart.Subtotal);
    }
}
