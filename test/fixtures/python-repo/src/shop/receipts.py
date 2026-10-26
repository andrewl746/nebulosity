from logging import getLogger


def emit(total):
    getLogger("shop.receipts").info(total)
