pub mod commands;
pub mod service;

pub use service::*;
// Don't re-export commands to avoid conflicts - lib.rs will import directly
