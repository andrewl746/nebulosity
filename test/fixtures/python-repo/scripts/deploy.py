"""Deploys the shop: run as `python scripts/deploy.py`."""
import sys
from email.utils import formatdate

import helpers
from app import config


def import_module(name):
    """A local helper that shares importlib's name: its calls aren't imports."""
    return sys.modules.get(name)


def main():
    print(helpers.banner(formatdate()), config)
    import_module("toolkit.text")


if '__main__' == __name__:
    main()
