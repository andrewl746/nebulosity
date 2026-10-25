using Shop.Core.Boxes;

namespace Shop.Core.Shipping;

public class Parcel
{
    public object Wrapping { get; } = new Box();
}
