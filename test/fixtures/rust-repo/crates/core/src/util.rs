//! Small helpers.
use std::collections::HashMap;

pub fn helper() -> u32 {
    let counts: HashMap<&str, u32> = std::collections::HashMap::new();
    counts.len() as u32
}

/// shop-core doesn't depend on shop-store, so this crate name is out of its reach: external, no edge.
pub fn unrelated() -> usize {
    shop_store::Db::default().orders.len()
}
