using System;
using System.Collections.Generic;

namespace Shop.Core.Models;

public delegate void OrderPlacedHandler(Order order);

// An order moves from Pending to Paid once, when it is placed.
public class Order
{
    private readonly List<Item> _items = new();

    public Order(Guid id, Money total)
    {
        Id = id;
        Total = total;
    }

    public event OrderPlacedHandler? Placed;

    public Guid Id { get; }

    public Money Total { get; private set; }

    public OrderStatus Status { get; private set; } = OrderStatus.Pending;

    public Item this[int index] => _items[index];

    public void Add(Item item)
    {
        _items.Add(item);
    }

    public void Place()
    {
        Status = OrderStatus.Paid;
        Placed?.Invoke(this);
    }

    public override string ToString() => $"{Id}: {Total.Amount}";
}
