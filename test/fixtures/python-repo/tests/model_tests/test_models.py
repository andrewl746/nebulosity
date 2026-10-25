from cart_tests.factories import make_cart
from shop.models import Product


def test_product_label():
    product = Product("tea", 4)
    assert product.label == "tea (4 CAD)"
    assert make_cart().items == []
