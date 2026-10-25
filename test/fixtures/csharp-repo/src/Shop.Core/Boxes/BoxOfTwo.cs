namespace Shop.Core.Boxes;

public class Box<TFirst, TSecond> : Box<TFirst>
{
    public TSecond? Second { get; set; }
}
