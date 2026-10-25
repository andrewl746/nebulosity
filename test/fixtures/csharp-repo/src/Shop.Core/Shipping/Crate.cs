using System;
using Shop.Core.Boxes;

namespace Shop.Core.Shipping;

public class Crate
{
    private readonly Box<int> _count = new();

    public Shop.Core.Boxes.Box<string>? Spare { get; set; }

    public Type Kind => typeof(Box<>);
}
