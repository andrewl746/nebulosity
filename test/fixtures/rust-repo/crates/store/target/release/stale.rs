// Build output: left out, since target/ sits beside crates/store/Cargo.toml.
use shop_core::model::Order;

pub fn stale(order: Order) -> u32 {
    order.quantity
}
