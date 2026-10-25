import logging

from shop.audit import record


def test_record():
    logging.disable(logging.CRITICAL)
    record("checkout")
