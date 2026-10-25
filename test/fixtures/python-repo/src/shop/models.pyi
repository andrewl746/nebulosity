from typing import ClassVar

class Product:
    currency: ClassVar[str]
    name: str
    def __init__(self, name: str, price: int = ...) -> None: ...
    @property
    def label(self) -> str: ...

def register(cls: type) -> type: ...
