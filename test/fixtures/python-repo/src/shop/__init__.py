"""The shop package."""
from .models import Product

__all__ = ["Product", "VERSION"]

# Bumped by the release script.
VERSION = "1.0"
_registry = {}


def configure():
    return _registry
