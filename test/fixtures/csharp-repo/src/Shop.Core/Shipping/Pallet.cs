using System;
using Shop.Core.Boxes;

namespace Shop.Core.Shipping;

public class Pallet
{
    public Box<string, int>? Load { get; set; }

    public Type Kind => typeof(Box<,>);

    public Pair<string, decimal> Label { get; } = new("pallet", 1m);
}
