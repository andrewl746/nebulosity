use shop_core::model::Order;

fn main() {
    let orders: Vec<Order> = (0..100).map(Order::new).collect();
    println!("{}", orders.len());
}
