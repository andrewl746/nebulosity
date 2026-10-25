//! Small helpers.
use std::collections::HashMap;

pub fn helper() -> u32 {
    let counts: HashMap<&str, u32> = std::collections::HashMap::new();
    counts.len() as u32
}
