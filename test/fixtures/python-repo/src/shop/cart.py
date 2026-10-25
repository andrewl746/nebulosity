from __future__ import annotations

import shop.payments as pay
import shop.payments.gateway
from vendors import acme

from .models import Product

try:
    from .speedups import fast_total
except ImportError:
    fast_total = None


class Cart:
    def __init__(self):
        self.items: list[Product] = []


def checkout(cart, session):
    from toolkit.text import shout

    return pay.gateway.charge(cart, session, acme.TAX), shout("done")
