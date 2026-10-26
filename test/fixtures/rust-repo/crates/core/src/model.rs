//! Orders, and one of every kind of item.
use std::fmt;

use crate::a::{self, inner::*, Thing as Widget};
use crate::b;

/// How big an order is.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Kind {
    Small,
    Large(u32),
}

/// One order.
#[derive(Debug, Clone)]
pub struct Order {
    pub quantity: u32,
    pub kind: Kind,
    note: Option<String>,
}

impl Order {
    pub fn new(quantity: u32) -> Self {
        Order { quantity, kind: Kind::Small, note: None }
    }

    fn widget(&self) -> Widget {
        a::Thing::new(self.quantity)
    }
}

impl fmt::Display for Order {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} items", self.quantity)
    }
}

// A plain comment: only attributes and doc comments attach to an item.
pub trait Priced {
    fn price(&self) -> u32;

    fn discounted(&self) -> u32 {
        self.price() / 2
    }
}

impl<T: serde::Serialize> Priced for Vec<T> {
    fn price(&self) -> u32 {
        self.len() as u32
    }
}

pub type Basket = b::Basket;

pub const MAX_ITEMS: u32 = 64;

static GREETING: &str = "hello";

/// Builds an order.
#[macro_export]
macro_rules! order {
    ($n:expr) => {
        $crate::model::Order::new($n)
    };
}

#[repr(C)]
pub union Bits {
    pub whole: u32,
    halves: [u16; 2],
}

pub(crate) fn hidden_helper() -> u32 {
    MAX_ITEMS
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_order_is_small() {
        let order = Order::new(1);
        assert_eq!(order.quantity, 1);
    }
}
