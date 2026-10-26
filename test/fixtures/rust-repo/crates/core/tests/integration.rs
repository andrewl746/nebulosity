use shop_core::model::{Kind, Order};

#[test]
fn orders_start_small() {
    let order = Order::new(2);
    let small = order.kind == Kind::Small;
    assert!(small);
}
