//! A parser test input: no `mod` line reaches this file, so it belongs to no crate.
use crate::model::Order;

fn sample(order: Order) -> u32 {
    order.quantity
}
