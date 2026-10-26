from shop.cart import (
    Cart,
    checkout,
)


def test_checkout():
    assert checkout(Cart(), None)
