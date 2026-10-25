//! The build script: tells cargo when to run it again.
fn main() {
    println!("cargo:rerun-if-changed=build.rs");
}
