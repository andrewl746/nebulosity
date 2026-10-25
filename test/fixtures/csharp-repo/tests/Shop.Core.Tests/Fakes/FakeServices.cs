namespace Shop.Core.Tests.Fakes;

/// <summary>Counts registrations; its AddShop is an ordinary method, not the extension.</summary>
public sealed class FakeServices
{
    public int Registrations { get; private set; }

    public FakeServices AddShop()
    {
        Registrations++;
        return this;
    }
}
