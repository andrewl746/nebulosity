//! The shop command line.
extern crate shop_core;

mod commands;

use shop_core::model::Order;
use store::Db;

fn main() {
    let mut db = Db::default();
    commands::run(&mut db, Order::new(3));
}
