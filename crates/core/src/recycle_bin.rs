//! The Recycle Bin: how much space it holds and emptying it.
//!
//! Files moved to the Recycle Bin still occupy space on their drive. This
//! module is what actually gives that space back. On Windows it uses the
//! same shell APIs as Explorer, so it covers *everything* in the bin, not
//! only what storageCleaner put there.

use serde::Serialize;

use crate::delete::DeleteMode;
use crate::error::{Error, Result};
use crate::history::{CleanupItemRecord, CleanupRunRecord, History, ItemStatus};
use crate::safety::SafetyLevel;
use crate::util::now_unix;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveBin {
    /// Drive root, e.g. `C:\`.
    pub drive: String,
    pub bytes: u64,
    pub items: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecycleBinInfo {
    pub bytes: u64,
    pub items: u64,
    pub drives: Vec<DriveBin>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmptyResult {
    pub freed_bytes: u64,
    pub items: u64,
    pub run_id: i64,
}

/// Size of the Recycle Bin on every drive.
pub fn info() -> Result<RecycleBinInfo> {
    let mut drives = Vec::new();
    for d in crate::disks::list_disks() {
        let (bytes, items) = os::query(Some(&d.mount))?;
        if items > 0 || bytes > 0 {
            drives.push(DriveBin {
                drive: d.mount,
                bytes,
                items,
            });
        }
    }
    Ok(RecycleBinInfo {
        bytes: drives.iter().map(|d| d.bytes).sum(),
        items: drives.iter().map(|d| d.items).sum(),
        drives,
    })
}

/// Empty the Recycle Bin (one drive, or all drives with `None`) and log it
/// in history. Items storageCleaner had moved there can no longer be
/// restored afterwards, so they are marked as purged.
pub fn empty(drive: Option<&str>, history: &History, source: &str) -> Result<EmptyResult> {
    let before = info()?;
    let targets: Vec<DriveBin> = before
        .drives
        .into_iter()
        .filter(|d| drive.is_none_or(|want| crate::util::normalize(want) == crate::util::normalize(&d.drive)))
        .collect();
    if targets.is_empty() {
        return Ok(EmptyResult {
            freed_bytes: 0,
            items: 0,
            run_id: 0,
        });
    }
    let started_at = now_unix();
    for t in &targets {
        os::empty(Some(&t.drive))?;
    }
    let freed_bytes = targets.iter().map(|t| t.bytes).sum();
    let items = targets.iter().map(|t| t.items).sum();
    let records: Vec<CleanupItemRecord> = targets
        .iter()
        .map(|t| CleanupItemRecord {
            id: 0,
            path: format!("Recycle Bin ({})", t.drive),
            kind: "dir".into(),
            size: t.bytes,
            rule: "recycle_bin".into(),
            safety: SafetyLevel::Review,
            status: ItemStatus::Deleted,
            error: None,
            restored_at: None,
        })
        .collect();
    let run_id = history.record_cleanup(
        &CleanupRunRecord {
            id: 0,
            started_at,
            finished_at: now_unix(),
            mode: DeleteMode::Permanent,
            source: source.into(),
            freed_bytes,
            deleted_count: records.len() as i64,
            failed_count: 0,
            skipped_count: 0,
        },
        &records,
    )?;
    history.mark_trashed_as_purged(drive)?;
    Ok(EmptyResult {
        freed_bytes,
        items,
        run_id,
    })
}

#[cfg(windows)]
mod os {
    use super::*;
    use windows_sys::Win32::UI::Shell::{
        SHERB_NOCONFIRMATION, SHERB_NOPROGRESSUI, SHERB_NOSOUND, SHEmptyRecycleBinW, SHQUERYRBINFO, SHQueryRecycleBinW,
    };

    /// Returned by SHEmptyRecycleBinW when the bin is already empty.
    const E_UNEXPECTED: i32 = 0x8000_FFFFu32 as i32;

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    pub fn query(root: Option<&str>) -> Result<(u64, u64)> {
        let path = root.map(wide);
        let mut info = SHQUERYRBINFO {
            cbSize: std::mem::size_of::<SHQUERYRBINFO>() as u32,
            i64Size: 0,
            i64NumItems: 0,
        };
        // SAFETY: `path` is a valid NUL-terminated UTF-16 string (or null for
        // all drives) and `info` is a properly sized, writable struct.
        let hr = unsafe { SHQueryRecycleBinW(path.as_ref().map_or(std::ptr::null(), |p| p.as_ptr()), &mut info) };
        if hr < 0 {
            // Drives without a Recycle Bin (some removable/network drives).
            return Ok((0, 0));
        }
        Ok((info.i64Size.max(0) as u64, info.i64NumItems.max(0) as u64))
    }

    pub fn empty(root: Option<&str>) -> Result<()> {
        let path = root.map(wide);
        // SAFETY: null HWND (no owner window), valid NUL-terminated path.
        let hr = unsafe {
            SHEmptyRecycleBinW(
                std::ptr::null_mut(),
                path.as_ref().map_or(std::ptr::null(), |p| p.as_ptr()),
                SHERB_NOCONFIRMATION | SHERB_NOPROGRESSUI | SHERB_NOSOUND,
            )
        };
        if hr < 0 && hr != E_UNEXPECTED {
            return Err(Error::Trash(format!(
                "emptying the Recycle Bin failed (HRESULT 0x{:08X})",
                hr as u32
            )));
        }
        Ok(())
    }
}

#[cfg(not(windows))]
mod os {
    use super::*;

    #[cfg(not(any(target_os = "macos", target_os = "ios", target_os = "android")))]
    fn items_on(root: Option<&str>) -> Result<Vec<trash::TrashItem>> {
        let all = trash::os_limited::list()?;
        Ok(match root {
            None => all,
            Some(r) => all.into_iter().filter(|i| i.original_parent.starts_with(r)).collect(),
        })
    }

    #[cfg(not(any(target_os = "macos", target_os = "ios", target_os = "android")))]
    pub fn query(root: Option<&str>) -> Result<(u64, u64)> {
        let items = items_on(root)?;
        let bytes = items
            .iter()
            .filter_map(|i| trash::os_limited::metadata(i).ok())
            .map(|m| match m.size {
                trash::TrashItemSize::Bytes(b) => b,
                trash::TrashItemSize::Entries(_) => 0,
            })
            .sum();
        Ok((bytes, items.len() as u64))
    }

    #[cfg(not(any(target_os = "macos", target_os = "ios", target_os = "android")))]
    pub fn empty(root: Option<&str>) -> Result<()> {
        trash::os_limited::purge_all(items_on(root)?).map_err(|e| Error::Trash(e.to_string()))
    }

    #[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
    pub fn query(_root: Option<&str>) -> Result<(u64, u64)> {
        Ok((0, 0))
    }

    #[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
    pub fn empty(_root: Option<&str>) -> Result<()> {
        Err(Error::Invalid(
            "emptying the trash is not supported on this platform".into(),
        ))
    }
}
