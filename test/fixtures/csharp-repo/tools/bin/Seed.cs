using System;
using Shop.Core.Models;

namespace Shop.Tools;

internal static class Seeder
{
    private static void Main(string[] args)
    {
        var order = new Order(Guid.NewGuid(), default);
        Console.WriteLine($"Seeded {order.Id} with {args.Length} arguments");
    }
}
