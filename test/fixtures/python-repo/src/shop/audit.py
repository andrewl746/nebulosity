import logging


def record(event):
    logging.getLogger("shop").info(event)
