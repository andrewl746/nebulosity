//! The admin tool: a `[[bin]]` target with its own path.
use store::{/* shop-cli's rename of shop-store */ Db};

fn main() {
    let db = Db::default();
    println!("{} orders", db.orders.len());
}
