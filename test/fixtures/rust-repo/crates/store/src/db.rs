use shop_core::model::Order;

/// Keeps orders in memory.
#[derive(Default)]
pub struct Db {
    pub orders: Vec<Order>,
}

impl Db {
    pub fn save(&mut self, order: Order) {
        self.orders.push(order);
    }
}
