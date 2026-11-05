use std::time::{SystemTime, UNIX_EPOCH};

/// Timestamps before 2000-01-01 are treated as unknown: some programs stamp
/// files with placeholder dates (1980, 1601...), which would otherwise look
/// like files "untouched for decades".
pub const MIN_VALID_TIME: i64 = 946_684_800;

pub fn is_valid_time(t: i64) -> bool {
    t >= MIN_VALID_TIME
}

/// Current time as unix seconds.
pub fn now_unix() -> i64 {
    to_unix(SystemTime::now())
}

pub fn to_unix(t: SystemTime) -> i64 {
    match t.duration_since(UNIX_EPOCH) {
        Ok(d) => d.as_secs() as i64,
        Err(e) => -(e.duration().as_secs() as i64),
    }
}

/// Human readable size using binary units (what Windows Explorer shows).
pub fn format_bytes(bytes: u64) -> String {
    const UNITS: [&str; 6] = ["B", "KB", "MB", "GB", "TB", "PB"];
    if bytes < 1024 {
        return format!("{bytes} B");
    }
    let mut value = bytes as f64;
    let mut unit = 0;
    while value >= 1024.0 && unit < UNITS.len() - 1 {
        value /= 1024.0;
        unit += 1;
    }
    if value >= 100.0 {
        format!("{value:.0} {}", UNITS[unit])
    } else if value >= 10.0 {
        format!("{value:.1} {}", UNITS[unit])
    } else {
        format!("{value:.2} {}", UNITS[unit])
    }
}

/// Lowercase, separator-normalised form of a path used for rule matching.
/// On Windows paths are case-insensitive, so matching is done on this form.
pub fn normalize(path: &str) -> String {
    // Windows-style: backslashes, no verbatim prefix from canonicalize().
    let s = path.replace('/', "\\");
    let s = s.strip_prefix(r"\\?\UNC\").map(|r| format!(r"\\{r}")).unwrap_or(s);
    let s = s.strip_prefix(r"\\?\").map(str::to_string).unwrap_or(s);
    let mut s = s.to_lowercase();
    // Drop trailing separators except for roots like "c:\".
    while s.len() > 1 && s.ends_with('\\') && !s.ends_with(":\\") {
        s.pop();
    }
    // "c:" alone means the drive root.
    if s.len() == 2 && s.ends_with(':') {
        s.push('\\');
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_bytes() {
        assert_eq!(format_bytes(0), "0 B");
        assert_eq!(format_bytes(1023), "1023 B");
        assert_eq!(format_bytes(1024), "1.00 KB");
        assert_eq!(format_bytes(15 * 1024 * 1024), "15.0 MB");
        assert_eq!(format_bytes(512 * 1024 * 1024 * 1024), "512 GB");
    }
}
