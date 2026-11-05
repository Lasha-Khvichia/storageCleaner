use std::sync::{Arc, Mutex, RwLock};

use storage_cleaner_core::history::History;
use storage_cleaner_core::model::Tree;
use storage_cleaner_core::safety::Classifier;
use storage_cleaner_core::scan::ScanControl;

pub struct AppState {
    pub classifier: Arc<Classifier>,
    /// The latest completed scan.
    pub tree: Arc<RwLock<Option<Tree>>>,
    /// Set while a scan is running.
    pub scan: Mutex<Option<Arc<ScanControl>>>,
    pub history: Mutex<History>,
}

impl AppState {
    pub fn new() -> storage_cleaner_core::Result<Self> {
        Ok(AppState {
            classifier: Arc::new(Classifier::system()),
            tree: Arc::new(RwLock::new(None)),
            scan: Mutex::new(None),
            history: Mutex::new(History::open_default()?),
        })
    }
}
