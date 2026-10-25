use shop_core::Order;
use store::Db;

pub fn run(db: &mut Db, order: Order) {
    db.save(order);
}
