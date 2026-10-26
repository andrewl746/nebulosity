from .. import models
from ..payments.gateway import charge


class FancyPlugin:
    def apply(self, cart):
        return charge(cart, None, 0), models.CURRENCY
