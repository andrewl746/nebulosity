use shop_core::{
    // the re-export at the crate root
    Order,
};
use store::Db;

pub fn run(db: &mut Db, order: Order) {
    db.save(order);
}
