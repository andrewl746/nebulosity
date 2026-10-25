use super::*;

#[test]
fn new_thing_has_its_id() {
    let thing = Thing::new(7);
    assert_eq!(thing.id, 7);
}
