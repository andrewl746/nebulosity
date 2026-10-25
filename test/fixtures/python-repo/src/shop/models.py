"""Products and their prices."""
from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .cart import Cart

CURRENCY = "CAD"
DEFAULT_PRICE: int = 0
WIDTH, HEIGHT = 80, 24


def register(cls):
    """Adds a class or a function to the registry."""
    return cls


# The thing a shop sells.
@register
class Product:
    """A product."""

    currency = CURRENCY
    name: str

    def __init__(self, name: str, price: int = DEFAULT_PRICE) -> None:
        self.name = name
        self.price = price

    @property
    def label(self) -> str:
        return f"{self.name} ({self.price} {self.currency})"

    @label.setter
    def label(self, value: str) -> None:
        self.name = value

    def _cents(self) -> int:
        return self.price * 100

    def __repr__(self) -> str:
        return f"Product({self.name!r})"

    async def refresh(self) -> None:
        return None

    class Meta:
        ordering = ["name"]


@register
async def fetch_price(product: Product, cart: Cart | None = None) -> int:
    return product.price


type PriceMap = dict[str, int]
