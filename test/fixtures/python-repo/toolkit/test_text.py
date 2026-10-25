from toolkit import slugify, text


def test_slugify():
    assert slugify("a b") == "A-B"
    assert text.shout("a") == "A"
