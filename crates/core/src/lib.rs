//! storageCleaner core.
//!
//! Everything that touches the file system lives here, so the CLI and the
//! desktop app share exactly the same scanning, safety and deletion rules.
//! The UI can never delete anything on its own: every deletion goes through
//! [`delete::execute`], which re-validates each path right before acting.

pub mod delete;
pub mod disks;
pub mod error;
pub mod history;
pub mod model;
pub mod recommend;
pub mod recycle_bin;
pub mod report;
pub mod safety;
pub mod scan;
pub mod util;

pub use error::{Error, Result};
