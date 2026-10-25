fn main() {
    let order = shop_core::model::Order::new(1);
    println!("{}", order.quantity);
}
