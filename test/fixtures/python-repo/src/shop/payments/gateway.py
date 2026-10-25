from ..models import Product


def charge(cart, session, tax):
    total = sum(item.price for item in cart.items if isinstance(item, Product))
    return session, total + tax
