//! The fixture's broken file: a statement in `double` has no right-hand side.
use crate::model::Order;

pub fn double(order: &Order) -> u32 {
    let twice = order.quantity * ;
    twice
}

pub fn after() -> u32 {
    crate::util::helper()
}
