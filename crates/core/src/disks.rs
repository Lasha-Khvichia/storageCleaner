//! Mounted drives and free-space snapshots (feeds the analytics graph).

use serde::{Deserialize, Serialize};
use sysinfo::{DiskKind, Disks};

use crate::error::Result;
use crate::history::{History, SpaceSnapshot};
use crate::util::now_unix;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskInfo {
    pub name: String,
    pub mount: String,
    pub file_system: String,
    pub kind: String,
    pub removable: bool,
    pub read_only: bool,
    pub total_bytes: u64,
    pub free_bytes: u64,
    pub used_bytes: u64,
}

pub fn list_disks() -> Vec<DiskInfo> {
    let disks = Disks::new_with_refreshed_list();
    let mut out: Vec<DiskInfo> = Vec::new();
    for d in disks.list() {
        let total = d.total_space();
        if total == 0 {
            continue;
        }
        let mount = d.mount_point().to_string_lossy().into_owned();
        if out.iter().any(|o| o.mount == mount) {
            continue;
        }
        let free = d.available_space();
        out.push(DiskInfo {
            name: d.name().to_string_lossy().into_owned(),
            mount,
            file_system: d.file_system().to_string_lossy().into_owned(),
            kind: match d.kind() {
                DiskKind::SSD => "ssd".into(),
                DiskKind::HDD => "hdd".into(),
                _ => "unknown".into(),
            },
            removable: d.is_removable(),
            read_only: d.is_read_only(),
            total_bytes: total,
            free_bytes: free,
            used_bytes: total.saturating_sub(free),
        });
    }
    out.sort_by(|a, b| a.mount.cmp(&b.mount));
    out
}

/// Record free space for every drive. Skips drives that already have a
/// snapshot newer than `min_interval_secs` (use 0 to always record, e.g.
/// right after a cleanup).
pub fn record_snapshots(history: &History, trigger: &str, min_interval_secs: i64) -> Result<usize> {
    let now = now_unix();
    let mut n = 0;
    for d in list_disks() {
        if min_interval_secs > 0
            && let Some(last) = history.last_snapshot_at(&d.mount)?
            && now - last < min_interval_secs
        {
            continue;
        }
        history.record_snapshot(&SpaceSnapshot {
            taken_at: now,
            label: if d.name.is_empty() {
                d.mount.clone()
            } else {
                d.name.clone()
            },
            mount: d.mount,
            total_bytes: d.total_bytes,
            free_bytes: d.free_bytes,
            trigger: trigger.into(),
        })?;
        n += 1;
    }
    Ok(n)
}
