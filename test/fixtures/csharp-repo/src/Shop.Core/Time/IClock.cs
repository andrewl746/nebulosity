using System;

namespace Shop.Core.Time;

public interface IClock
{
    DateTimeOffset Now { get; }
}
