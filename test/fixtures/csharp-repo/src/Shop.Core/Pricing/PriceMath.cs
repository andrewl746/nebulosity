using System;

namespace Shop.Core.Pricing;

public static class PriceMath
{
    public enum Rounding
    {
        Down,
        Up,
    }

    public const int Decimals = 2;

    public static decimal Round(decimal value, Rounding rounding)
    {
        return rounding == Rounding.Up
            ? decimal.Round(value, Decimals, MidpointRounding.AwayFromZero)
            : decimal.Round(value, Decimals, MidpointRounding.ToZero);
    }
}
