using Microsoft.Extensions.Logging;
using Shop.Core.Logging;

namespace Shop.Core.Shipping;

public class Dispatcher
{
    public Dispatcher(ILogger<Dispatcher> log) => Log = log;

    public ILogger<Dispatcher> Log { get; }
}
