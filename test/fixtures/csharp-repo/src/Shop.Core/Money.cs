using System;

namespace Shop.Core;

/// <summary>An amount of money in one currency.</summary>
public readonly struct Money : IEquatable<Money>
{
    public static readonly Money Zero = new(0m, "EUR");

    public Money(decimal amount, string currency)
    {
        Amount = amount;
        Currency = currency;
    }

    public decimal Amount { get; }

    public string Currency { get; }

    public bool Equals(Money other) => Amount == other.Amount && Currency == other.Currency;
}
