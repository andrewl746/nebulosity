//! shop-core: orders, baskets and the helpers around them.
mod a;
mod b;
mod broken;
pub mod model;
mod util;

#[path = "custom.rs"]
mod renamed;

mod nested {
    mod deep;
}

mod missing;

pub use model::Order;
