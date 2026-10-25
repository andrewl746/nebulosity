//! Baskets of things.
use crate::a::Thing;

pub struct Basket {
    pub items: Vec<Thing>,
}

pub fn basket_total(basket: &Basket) -> u32 {
    basket.items.len() as u32 + crate::util::helper()
}
