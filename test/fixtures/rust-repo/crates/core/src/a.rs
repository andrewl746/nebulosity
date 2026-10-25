//! Things, and the inner module that marks them.
pub mod inner;
#[cfg(test)]
mod tests;

use self::inner::Y;

/// A thing in the shop.
#[derive(Debug, Clone, Default)]
pub struct Thing {
    pub id: u32,
    label: String,
}

impl Thing {
    pub fn new(id: u32) -> Self {
        Thing { id, label: String::new() }
    }

    pub fn marker(&self) -> Y {
        Y
    }
}
