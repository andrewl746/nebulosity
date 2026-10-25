import os, sys

import cart_tests
import shop

if __name__ == '__main__':
    os.environ.setdefault("SHOP_VERSION", shop.VERSION)
    sys.exit(0 if cart_tests else 1)
