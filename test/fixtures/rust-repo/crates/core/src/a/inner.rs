use super::Thing;

/// What a thing is marked with.
pub struct Y;

pub fn label_of(thing: &Thing) -> String {
    format!("thing {}", thing.id)
}
