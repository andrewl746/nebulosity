"""The shop's command line."""
import importlib
import os
from importlib import import_module

import requests

from . import VERSION
from .cart import Cart, checkout


def main():
    name = os.environ.get("SHOP_PLUGIN", "fancy")
    importlib.import_module("shop.plugins.fancy")
    import_module("shop.payments.gateway")
    __import__("toolkit.text")
    importlib.import_module(name)
    import_module(f"shop.plugins.{name}")
    return checkout(Cart(), requests.Session()), VERSION
