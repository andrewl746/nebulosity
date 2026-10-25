"""Text helpers."""
try:
    from ._speedups import fast_shout
except ImportError:
    fast_shout = None


class _Cache:
    def __init__(self):
        self.store = {}

    def get(self, key):
        return self.store.get(key)


def shout(value):
    return fast_shout(value) if fast_shout else value.upper()


def main():
    print(shout("hello"))
