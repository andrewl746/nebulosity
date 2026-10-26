import pytest

from shop.models import Product


@pytest.fixture
def product():
    return Product("tea", 4)
