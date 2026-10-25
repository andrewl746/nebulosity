from .text import shout


def slugify(value):
    return shout(value).replace(" ", "-")
