using System.Collections.Generic;
using System.Linq;

namespace Shop.Web.Extensions;

public static class CollectionExtensions
{
    public static bool IsNullOrEmpty<T>(this IEnumerable<T>? items) => items is null || !items.Any();
}
