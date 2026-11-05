//! Safety classification: decides how safe it is to delete every entry.
//!
//! Every scanned entry gets a [`Rule`], and every rule maps to one
//! [`SafetyLevel`], a [`Category`] and a human readable reason that the UI
//! shows next to the item ("why is this safe?").
//!
//! Evaluation order for an entry (first match wins):
//! 1. Longest matching *path rule* if it is `Protected` or `Safe`
//!    (e.g. everything under `C:\Windows` is protected, but
//!    `C:\Windows\Temp\*` is safe because that rule is longer/more specific).
//! 2. Inherit the parent's rule if the parent is `Safe` or `Protected` and the
//!    rule covers whole trees (children of `node_modules` are safe too).
//! 3. *Name rules* (`node_modules`, `*.dmp`, browser cache folders, ...).
//! 4. A non-final path rule (`Review`, e.g. contents of Downloads).
//! 5. Inherit a parent `Review` rule.
//! 6. Heuristics (large files untouched for years).
//! 7. `Unknown`.

use std::path::{Component, Path};

use serde::{Deserialize, Serialize};

use crate::model::NodeKind;
use crate::util::{normalize, now_unix};

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SafetyLevel {
    /// Junk that is regenerated automatically or never needed again.
    Safe,
    /// Probably removable, but it is the user's data: look before deleting.
    Review,
    /// No rule matched. Could be anything.
    Unknown,
    /// Deleting would break Windows, programs or the user profile. Blocked.
    Protected,
}

impl SafetyLevel {
    pub fn as_str(self) -> &'static str {
        match self {
            SafetyLevel::Safe => "safe",
            SafetyLevel::Review => "review",
            SafetyLevel::Unknown => "unknown",
            SafetyLevel::Protected => "protected",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Category {
    System,
    Program,
    UserData,
    Temp,
    BrowserCache,
    AppCache,
    Developer,
    PackageCache,
    Installer,
    CrashReport,
    WindowsUpdate,
    Logs,
    OldFile,
    VirtualDisk,
    Other,
}

impl Category {
    pub fn label(self) -> &'static str {
        match self {
            Category::System => "System",
            Category::Program => "Programs",
            Category::UserData => "Personal files",
            Category::Temp => "Temporary files",
            Category::BrowserCache => "Browser cache",
            Category::AppCache => "App cache",
            Category::Developer => "Developer clutter",
            Category::PackageCache => "Package manager cache",
            Category::Installer => "Installers & archives",
            Category::CrashReport => "Crash reports",
            Category::WindowsUpdate => "Windows Update",
            Category::Logs => "Logs",
            Category::OldFile => "Old large files",
            Category::VirtualDisk => "Virtual disks",
            Category::Other => "Other",
        }
    }
}

/// Whether a rule applies to a whole subtree (children inherit it) or only to
/// the entry itself (e.g. "keep the Downloads folder, judge its contents").
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Scope {
    Tree,
    SelfOnly,
}

macro_rules! rules {
    ($( $variant:ident => ($level:ident, $cat:ident, $scope:ident, $id:literal, $reason:literal) ),* $(,)?) => {
        /// Every classification outcome. Stored per node (1 byte).
        #[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
        #[repr(u8)]
        pub enum Rule { $($variant),* }

        impl Rule {
            pub const ALL: &'static [Rule] = &[$(Rule::$variant),*];
            pub fn level(self) -> SafetyLevel { match self { $(Rule::$variant => SafetyLevel::$level),* } }
            pub fn category(self) -> Category { match self { $(Rule::$variant => Category::$cat),* } }
            pub fn scope(self) -> Scope { match self { $(Rule::$variant => Scope::$scope),* } }
            pub fn id(self) -> &'static str { match self { $(Rule::$variant => $id),* } }
            pub fn reason(self) -> &'static str { match self { $(Rule::$variant => $reason),* } }
            pub fn from_id(id: &str) -> Option<Rule> { Rule::ALL.iter().copied().find(|r| r.id() == id) }
        }
    };
}

rules! {
    // ── Unknown ──────────────────────────────────────────────────────────
    Unknown => (Unknown, Other, SelfOnly, "unknown",
        "Not recognised. Check what it is before deleting."),

    // ── Protected ────────────────────────────────────────────────────────
    DriveRoot => (Protected, System, SelfOnly, "drive_root",
        "The root of a drive can never be deleted."),
    WindowsDir => (Protected, System, Tree, "windows_dir",
        "Windows system files. Deleting these can make the PC unbootable."),
    ProgramFiles => (Protected, Program, Tree, "program_files",
        "Installed programs. Uninstall them from Settings > Apps instead."),
    ProgramData => (Protected, Program, Tree, "program_data",
        "Shared data used by installed programs and Windows services."),
    AppPackages => (Protected, Program, Tree, "app_packages",
        "Microsoft Store apps and WSL distributions. Remove them from Settings > Apps."),
    UsersRoot => (Protected, System, SelfOnly, "users_root",
        "Folder holding every user profile on this PC."),
    UserProfile => (Protected, UserData, SelfOnly, "user_profile",
        "A user profile folder. Delete individual items inside it instead."),
    AppDataRoot => (Protected, System, SelfOnly, "appdata_root",
        "Application settings root. Programs break without it."),
    KnownFolder => (Protected, UserData, SelfOnly, "known_folder",
        "A Windows library folder (Desktop, Documents, Downloads...). Keep the folder; review its contents."),
    KeepFolder => (Protected, System, SelfOnly, "keep_folder",
        "Keep this folder itself. Its contents are what can be cleaned."),
    SystemDir => (Protected, System, Tree, "system_dir",
        "System folder used for booting, recovery or the operating system."),
    SystemFile => (Protected, System, Tree, "system_file",
        "Core system file (page file, hibernation, boot or registry hive)."),
    RecycleBin => (Protected, System, Tree, "recycle_bin",
        "The Recycle Bin. Empty it from the Recycle Bin itself."),
    SystemVolumeInfo => (Protected, System, Tree, "system_volume_info",
        "Restore points and volume metadata. Manage them via System Protection settings."),
    VirtualDisk => (Protected, VirtualDisk, Tree, "virtual_disk",
        "Virtual disk image (VM, WSL or Docker). Delete it from the app that owns it."),
    GitRepository => (Protected, Developer, Tree, "git_repository",
        "Git history. Deleting it loses every commit not pushed. Delete the whole project instead if you mean to."),
    AppOwnData => (Protected, Program, Tree, "app_own_data",
        "storageCleaner's own files. They are in use while the app runs."),

    // ── Safe ─────────────────────────────────────────────────────────────
    TempContents => (Safe, Temp, Tree, "temp_contents",
        "Temporary files. Programs recreate what they need; files in use are skipped."),
    WindowsTemp => (Safe, Temp, Tree, "windows_temp",
        "Windows temporary files. Safe to clear; may need administrator rights."),
    WindowsUpdateCache => (Safe, WindowsUpdate, Tree, "windows_update_cache",
        "Downloaded Windows Update packages that are already installed."),
    ErrorReports => (Safe, CrashReport, Tree, "error_reports",
        "Windows Error Reporting files, only useful for crash diagnostics."),
    CrashDumps => (Safe, CrashReport, Tree, "crash_dumps",
        "Crash dump. Only useful for debugging a crash that already happened."),
    InternetCache => (Safe, BrowserCache, Tree, "internet_cache",
        "Internet cache used by Windows components. Rebuilt automatically."),
    BrowserCache => (Safe, BrowserCache, Tree, "browser_cache",
        "Browser cache. Web pages re-download it; you stay logged in."),
    AppCache => (Safe, AppCache, Tree, "app_cache",
        "Application cache. The app rebuilds it when needed."),
    ShaderCache => (Safe, AppCache, Tree, "shader_cache",
        "Graphics shader cache. Rebuilt by your GPU driver and games."),
    ThumbnailCache => (Safe, AppCache, Tree, "thumbnail_cache",
        "Explorer thumbnail/icon cache. Rebuilt automatically (in-use files are skipped)."),
    CacheDirTag => (Safe, AppCache, Tree, "cachedir_tag",
        "Folder marked as a cache (CACHEDIR.TAG), e.g. a Rust target folder. Regenerated on next build."),
    NodeModules => (Safe, Developer, Tree, "node_modules",
        "Node.js dependencies. Restore any time with `npm install`."),
    BuildCache => (Safe, Developer, Tree, "build_cache",
        "Build or tool cache (Python, Next.js, Gradle...). Regenerated on next run."),
    PackageCache => (Safe, PackageCache, Tree, "package_cache",
        "Package manager download cache (npm, pip, cargo, yarn, Go...). Re-downloaded when needed."),
    TempFile => (Safe, Temp, Tree, "temp_file",
        "Temporary file left behind by a program."),

    // ── Review ───────────────────────────────────────────────────────────
    DownloadsContent => (Review, UserData, Tree, "downloads",
        "In your Downloads folder. Often safe, but make sure you still don't need it."),
    PersonalFiles => (Review, UserData, Tree, "personal_files",
        "Your personal files. Only you can tell if they are still needed."),
    CloudSynced => (Review, UserData, Tree, "cloud_synced",
        "Synced with OneDrive. Deleting it here also deletes it from the cloud."),
    Installer => (Review, Installer, Tree, "installer",
        "Installer or disk image in Downloads. Usually not needed after installing."),
    Archive => (Review, Installer, Tree, "archive",
        "Archive in Downloads. Not needed if you already extracted it."),
    VirtualEnv => (Review, Developer, Tree, "virtual_env",
        "Python virtual environment. Recreate it with `pip install -r requirements.txt`."),
    NugetPackages => (Review, PackageCache, Tree, "nuget_packages",
        ".NET package cache. Re-downloaded on next restore, which can be slow."),
    UpgradeLeftovers => (Review, WindowsUpdate, Tree, "upgrade_leftovers",
        "Leftovers from a Windows upgrade. Prefer Settings > Storage > Temporary files."),
    WindowsOld => (Review, WindowsUpdate, Tree, "windows_old",
        "Previous Windows installation. Removing it disables rollback; use Settings > Storage."),
    LogFile => (Review, Logs, Tree, "log_file",
        "Log file. Usually safe unless you are troubleshooting something."),
    OldLargeFile => (Review, OldFile, SelfOnly, "old_large_file",
        "Large file not modified in over 2 years."),
    BrowserAiModel => (Review, BrowserCache, Tree, "browser_ai_model",
        "Chrome's on-device AI model. Chrome downloads it again unless you turn off on-device AI in chrome://flags."),
}

/// Marker files found directly inside a directory, used by name rules.
#[derive(Clone, Copy, Debug, Default)]
pub struct Markers {
    pub cachedir_tag: bool,
    pub pyvenv_cfg: bool,
    pub package_json: bool,
}

impl Markers {
    pub fn observe(&mut self, file_name: &str) {
        if file_name == "CACHEDIR.TAG" {
            self.cachedir_tag = true;
        } else if file_name.eq_ignore_ascii_case("package.json") {
            self.package_json = true;
        } else if file_name.eq_ignore_ascii_case("pyvenv.cfg") {
            self.pyvenv_cfg = true;
        }
    }
}

/// Everything the classifier needs to know about one entry.
pub struct Entry<'a> {
    /// Normalised full path (see [`normalize`]).
    pub path: &'a str,
    /// Lowercase file name.
    pub name: &'a str,
    pub kind: NodeKind,
    pub parent: Option<Rule>,
    pub parent_is_root: bool,
    pub markers: Markers,
    /// Marker files in the parent directory (e.g. a `package.json` next to `node_modules`).
    pub parent_markers: Markers,
    pub size: u64,
    pub modified: i64,
}

struct PathRule {
    prefix: String,
    on_self: Option<Rule>,
    on_contents: Option<Rule>,
}

/// Bundle identifier of the desktop app (its WebView data lives in
/// `%LOCALAPPDATA%\<identifier>`).
pub const APP_IDENTIFIER: &str = "com.lashakhvichia.storagecleaner";

/// Well-known locations, resolved once from the environment. Separate from
/// [`Classifier`] so tests can inject fake paths.
#[derive(Debug, Clone, Default)]
pub struct SystemPaths {
    pub windows: Option<String>,
    pub program_files: Vec<String>,
    pub program_data: Option<String>,
    pub users_root: Option<String>,
    pub home: Option<String>,
    pub local_appdata: Option<String>,
    pub roaming_appdata: Option<String>,
    pub temp: Vec<String>,
    pub downloads: Option<String>,
    pub personal: Vec<String>,
    pub onedrive: Vec<String>,
    /// Never delete the app itself or its data.
    pub app_paths: Vec<String>,
    pub unix: bool,
    /// Apply the Unix system-folder rules (/usr, /etc, /tmp...). Off in tests,
    /// whose temporary folders live under /tmp.
    pub unix_system_dirs: bool,
}

impl SystemPaths {
    pub fn detect() -> Self {
        let env = |k: &str| std::env::var(k).ok().filter(|v| !v.is_empty());
        let s = |p: std::path::PathBuf| p.to_string_lossy().into_owned();
        let mut sp = SystemPaths {
            windows: env("SystemRoot").or_else(|| env("windir")),
            program_files: ["ProgramFiles", "ProgramFiles(x86)", "ProgramW6432"]
                .iter()
                .filter_map(|k| env(k))
                .collect(),
            program_data: env("ProgramData"),
            home: dirs::home_dir().map(s),
            local_appdata: env("LOCALAPPDATA"),
            roaming_appdata: env("APPDATA"),
            temp: [env("TEMP"), env("TMP"), Some(s(std::env::temp_dir()))]
                .into_iter()
                .flatten()
                .collect(),
            downloads: dirs::download_dir().map(s),
            personal: [
                dirs::desktop_dir(),
                dirs::document_dir(),
                dirs::picture_dir(),
                dirs::audio_dir(),
                dirs::video_dir(),
            ]
            .into_iter()
            .flatten()
            .map(s)
            .collect(),
            onedrive: ["OneDrive", "OneDriveConsumer", "OneDriveCommercial"]
                .iter()
                .filter_map(|k| env(k))
                .collect(),
            unix: cfg!(unix),
            unix_system_dirs: cfg!(unix),
            ..Default::default()
        };
        sp.users_root = sp
            .home
            .as_ref()
            .and_then(|h| Path::new(h).parent().map(|p| p.to_string_lossy().into_owned()));
        if let Ok(exe) = std::env::current_exe()
            && let Some(dir) = exe.parent()
        {
            sp.app_paths.push(dir.to_string_lossy().into_owned());
        }
        if let Some(d) = crate::history::default_data_dir() {
            sp.app_paths.push(d.to_string_lossy().into_owned());
        }
        // The desktop app's WebView profile is locked while the app runs.
        if let Some(l) = &sp.local_appdata {
            sp.app_paths.push(format!("{l}\\{APP_IDENTIFIER}"));
        }
        sp
    }
}

pub struct Classifier {
    rules: Vec<PathRule>,
    downloads: Option<String>,
    local_appdata: Option<String>,
    roaming_appdata: Option<String>,
    home: Option<String>,
    /// Paths that may never be deleted, nor any folder containing them.
    critical: Vec<String>,
    sep: char,
}

impl Classifier {
    pub fn system() -> Self {
        Self::new(&SystemPaths::detect())
    }

    pub fn new(sp: &SystemPaths) -> Self {
        let sep = if sp.unix { '/' } else { '\\' };
        let n = |p: &str| normalize_with(p, sep);
        let join = |base: &str, rel: &str| {
            let rel = if sep == '/' {
                rel.replace('\\', "/")
            } else {
                rel.to_string()
            };
            format!("{}{sep}{}", n(base).trim_end_matches(sep), rel.to_lowercase())
        };
        let mut rules: Vec<PathRule> = Vec::new();
        let mut add = |prefix: String, on_self: Option<Rule>, on_contents: Option<Rule>| {
            rules.push(PathRule {
                prefix,
                on_self,
                on_contents,
            });
        };
        use Rule::*;

        if let Some(w) = &sp.windows {
            add(n(w), Some(WindowsDir), Some(WindowsDir));
            add(join(w, "temp"), Some(KeepFolder), Some(WindowsTemp));
            add(
                join(w, r"softwaredistribution\download"),
                Some(KeepFolder),
                Some(WindowsUpdateCache),
            );
        }
        for pf in &sp.program_files {
            add(n(pf), Some(ProgramFiles), Some(ProgramFiles));
        }
        if let Some(pd) = &sp.program_data {
            add(n(pd), Some(ProgramData), Some(ProgramData));
            add(join(pd, r"microsoft\windows\wer"), Some(KeepFolder), Some(ErrorReports));
        }
        if let Some(u) = &sp.users_root {
            add(n(u), Some(UsersRoot), None);
        }
        if let Some(h) = &sp.home {
            add(n(h), Some(UserProfile), None);
            add(join(h, "appdata"), Some(AppDataRoot), None);
            add(join(h, r"appdata\locallow"), Some(AppDataRoot), None);
            add(
                join(h, r".cargo\registry\cache"),
                Some(PackageCache),
                Some(PackageCache),
            );
            add(join(h, r".npm\_cacache"), Some(PackageCache), Some(PackageCache));
            add(join(h, r".gradle\caches"), Some(PackageCache), Some(PackageCache));
            add(join(h, r".nuget\packages"), Some(NugetPackages), Some(NugetPackages));
            if sp.unix {
                add(join(h, ".cache"), Some(KeepFolder), Some(AppCache));
                add(join(h, r".local\share\trash"), Some(RecycleBin), Some(RecycleBin));
            }
        }
        if let Some(l) = &sp.local_appdata {
            add(n(l), Some(AppDataRoot), None);
            add(join(l, "temp"), Some(KeepFolder), Some(TempContents));
            add(join(l, "crashdumps"), Some(KeepFolder), Some(CrashDumps));
            add(join(l, r"microsoft\windows\wer"), Some(KeepFolder), Some(ErrorReports));
            add(
                join(l, r"microsoft\windows\inetcache"),
                Some(KeepFolder),
                Some(InternetCache),
            );
            add(join(l, "d3dscache"), Some(ShaderCache), Some(ShaderCache));
            add(join(l, r"nvidia\dxcache"), Some(ShaderCache), Some(ShaderCache));
            add(join(l, r"nvidia\glcache"), Some(ShaderCache), Some(ShaderCache));
            add(join(l, r"amd\dxcache"), Some(ShaderCache), Some(ShaderCache));
            add(join(l, "npm-cache"), Some(PackageCache), Some(PackageCache));
            add(join(l, r"pip\cache"), Some(PackageCache), Some(PackageCache));
            add(join(l, r"yarn\cache"), Some(PackageCache), Some(PackageCache));
            add(join(l, "go-build"), Some(PackageCache), Some(PackageCache));
            add(join(l, "packages"), Some(AppPackages), Some(AppPackages));
            add(join(l, "docker"), Some(VirtualDisk), Some(VirtualDisk));
        }
        if let Some(r) = &sp.roaming_appdata {
            add(n(r), Some(AppDataRoot), None);
            add(join(r, "npm-cache"), Some(PackageCache), Some(PackageCache));
        }
        for t in &sp.temp {
            add(n(t), Some(KeepFolder), Some(TempContents));
        }
        if let Some(d) = &sp.downloads {
            add(n(d), Some(KnownFolder), Some(DownloadsContent));
        }
        for p in &sp.personal {
            add(n(p), Some(KnownFolder), Some(PersonalFiles));
        }
        for o in &sp.onedrive {
            add(n(o), Some(KnownFolder), Some(CloudSynced));
        }
        for a in &sp.app_paths {
            add(n(a), Some(AppOwnData), Some(AppOwnData));
        }
        if sp.unix_system_dirs {
            for d in [
                "/bin", "/boot", "/dev", "/etc", "/lib", "/lib32", "/lib64", "/proc", "/run", "/sbin", "/sys", "/usr",
                "/var", "/snap", "/opt", "/root",
            ] {
                add(d.to_string(), Some(SystemDir), Some(SystemDir));
            }
            add("/tmp".into(), Some(KeepFolder), Some(TempContents));
            add("/var/tmp".into(), Some(KeepFolder), Some(TempContents));
            add("/var/cache".into(), Some(KeepFolder), Some(AppCache));
            add("/home".into(), Some(UsersRoot), None);
        }

        // Longest prefix first so specific rules beat broad ones.
        rules.sort_by_key(|r| std::cmp::Reverse(r.prefix.len()));
        rules.dedup_by(|a, b| a.prefix == b.prefix);

        let mut critical: Vec<String> = Vec::new();
        critical.extend(sp.windows.iter().map(|p| n(p)));
        critical.extend(sp.program_files.iter().map(|p| n(p)));
        critical.extend(sp.program_data.iter().map(|p| n(p)));
        critical.extend(sp.users_root.iter().map(|p| n(p)));
        critical.extend(sp.home.iter().map(|p| n(p)));
        critical.extend(sp.local_appdata.iter().map(|p| n(p)));
        critical.extend(sp.roaming_appdata.iter().map(|p| n(p)));
        critical.extend(sp.app_paths.iter().map(|p| n(p)));
        if sp.unix_system_dirs {
            critical.extend(["/bin", "/boot", "/etc", "/lib", "/usr", "/var", "/home"].map(String::from));
        }

        Classifier {
            rules,
            downloads: sp.downloads.as_deref().map(n),
            local_appdata: sp.local_appdata.as_deref().map(n),
            roaming_appdata: sp.roaming_appdata.as_deref().map(n),
            home: sp.home.as_deref().map(n),
            critical,
            sep,
        }
    }

    pub fn sep(&self) -> char {
        self.sep
    }

    pub fn normalize(&self, path: &str) -> String {
        normalize_with(path, self.sep)
    }

    fn is_root(&self, path: &str) -> bool {
        if self.sep == '/' {
            path == "/"
        } else {
            // "c:\" or "c:" or a UNC share root.
            (path.len() <= 3 && path.as_bytes().get(1) == Some(&b':'))
                || (path.starts_with(r"\\")
                    && path
                        .trim_start_matches('\\')
                        .split('\\')
                        .filter(|s| !s.is_empty())
                        .count()
                        <= 2)
        }
    }

    fn path_rule(&self, path: &str) -> Option<Rule> {
        for r in &self.rules {
            if path == r.prefix {
                if r.on_self.is_some() {
                    return r.on_self;
                }
            } else if path.starts_with(&r.prefix)
                && (r.prefix.ends_with(self.sep) || path[r.prefix.len()..].starts_with(self.sep))
                && r.on_contents.is_some()
            {
                return r.on_contents;
            }
        }
        None
    }

    fn under(path: &str, base: &Option<String>, sep: char) -> bool {
        base.as_deref()
            .is_some_and(|b| path.len() > b.len() && path.starts_with(b) && path[b.len()..].starts_with(sep))
    }

    /// Inside program source or packaged code, where a folder called
    /// "cache" is part of the program rather than cached data.
    fn is_code_path(&self, path: &str) -> bool {
        let sep = self.sep;
        let seg = |s: &str| format!("{sep}{s}{sep}");
        [
            "node_modules",
            "site-packages",
            "dist-packages",
            "lib",
            "src",
            "resources",
            "extensions",
            "programs",
            "vendor",
            "_vendor",
        ]
        .iter()
        .any(|d| path.contains(&seg(d)))
    }

    /// Inside installed software rather than a user's own project: AppData
    /// (global npm, installed Electron apps, tool installs), editor extension
    /// folders, or an app's packaged resources.
    fn is_installed_software(&self, path: &str) -> bool {
        let sep = self.sep;
        if Self::under(path, &self.local_appdata, sep) || Self::under(path, &self.roaming_appdata, sep) {
            return true;
        }
        let seg = |s: &str| format!("{sep}{s}{sep}");
        [".vscode", ".vscode-insiders", ".cursor", ".windsurf"]
            .iter()
            .any(|d| path.contains(&seg(&format!("{d}{sep}extensions"))))
            || path.contains(&seg("app.asar.unpacked"))
            || path.contains(&seg("resources"))
            || (sep == '/' && (path.starts_with("/usr/") || path.contains("/.npm-global/") || path.contains("/.nvm/")))
    }

    fn name_rule(&self, e: &Entry) -> Option<Rule> {
        use Rule::*;
        let name = e.name;
        let sep = self.sep;
        let ext = name.rsplit_once('.').map(|(_, x)| x).unwrap_or("");

        // Special entries directly at a drive root.
        if e.parent_is_root {
            match (e.kind, name) {
                (NodeKind::Dir, "$recycle.bin") => return Some(RecycleBin),
                (NodeKind::Dir, "system volume information") => return Some(SystemVolumeInfo),
                (
                    NodeKind::Dir,
                    "recovery"
                    | "boot"
                    | "efi"
                    | "$winreagent"
                    | "$sysreset"
                    | "config.msi"
                    | "documents and settings"
                    | "msocache",
                ) => {
                    return Some(SystemDir);
                }
                (NodeKind::Dir, "$windows.~bt" | "$windows.~ws" | "$getcurrent" | "esd") => {
                    return Some(UpgradeLeftovers);
                }
                (NodeKind::Dir, "windows.old") => return Some(WindowsOld),
                (
                    NodeKind::File,
                    "pagefile.sys" | "hiberfil.sys" | "swapfile.sys" | "bootmgr" | "bootnxt" | "dumpstack.log"
                    | "dumpstack.log.tmp",
                ) => return Some(SystemFile),
                _ => {}
            }
        }

        match e.kind {
            NodeKind::Dir => {
                if name == ".git" {
                    return Some(GitRepository);
                }
                // Only a *project's* node_modules is safe: it must sit next to a
                // package.json and not live inside installed software (global
                // npm packages, editor extensions, Electron apps), which would
                // break if their node_modules disappeared.
                if name == "node_modules" && e.parent_markers.package_json && !self.is_installed_software(e.path) {
                    return Some(NodeModules);
                }
                if e.markers.cachedir_tag {
                    return Some(CacheDirTag);
                }
                if e.markers.pyvenv_cfg {
                    return Some(VirtualEnv);
                }
                if matches!(
                    name,
                    "__pycache__"
                        | ".pytest_cache"
                        | ".mypy_cache"
                        | ".ruff_cache"
                        | ".tox"
                        | ".next"
                        | ".nuxt"
                        | ".parcel-cache"
                        | ".turbo"
                        | ".svelte-kit"
                        | ".angular"
                        | ".dart_tool"
                        | ".gradle"
                ) {
                    return Some(BuildCache);
                }
                // A folder merely *named* "cache" inside program code (e.g.
                // node_modules/webpack/lib/cache) is source code, not a cache.
                let in_code = self.is_code_path(e.path);
                let in_browser_profile = e.path.contains(&format!("{sep}user data{sep}"));
                if in_browser_profile
                    && !in_code
                    && matches!(
                        name,
                        "cache"
                            | "code cache"
                            | "gpucache"
                            | "dawncache"
                            | "dawngraphitecache"
                            | "dawnwebgpucache"
                            | "grshadercache"
                            | "graphitedawncache"
                            | "shadercache"
                            | "cachestorage"
                    )
                {
                    return Some(BrowserCache);
                }
                if name == "optguideondevicemodel" && in_browser_profile {
                    return Some(BrowserAiModel);
                }
                if name == "cache2" && e.path.contains(&format!("{sep}firefox{sep}profiles{sep}")) {
                    return Some(BrowserCache);
                }
                let in_appdata = Self::under(e.path, &self.local_appdata, sep)
                    || Self::under(e.path, &self.roaming_appdata, sep)
                    || (sep == '/' && Self::under(e.path, &self.home, sep) && e.path.contains("/.config/"));
                if in_appdata
                    && !in_code
                    && matches!(
                        name,
                        "cache" | "caches" | "code cache" | "gpucache" | "shadercache" | "cachestorage"
                    )
                {
                    return Some(AppCache);
                }
            }
            NodeKind::File => {
                if name.starts_with("ntuser.") || name.starts_with("usrclass.dat") {
                    return Some(SystemFile);
                }
                if matches!(ext, "vhd" | "vhdx" | "vmdk" | "vdi" | "qcow2" | "avhdx") {
                    return Some(VirtualDisk);
                }
                if (name.starts_with("thumbcache_") || name.starts_with("iconcache_")) && ext == "db" {
                    return Some(ThumbnailCache);
                }
                if matches!(ext, "dmp" | "mdmp" | "hdmp") {
                    return Some(CrashDumps);
                }
                if matches!(ext, "tmp" | "temp") || name.starts_with("~$") {
                    return Some(TempFile);
                }
                if Self::under(e.path, &self.downloads, sep) {
                    if matches!(
                        ext,
                        "exe"
                            | "msi"
                            | "msix"
                            | "msixbundle"
                            | "appx"
                            | "iso"
                            | "img"
                            | "dmg"
                            | "deb"
                            | "rpm"
                            | "appimage"
                    ) {
                        return Some(Installer);
                    }
                    if matches!(ext, "zip" | "7z" | "rar" | "tar" | "gz" | "tgz" | "xz" | "bz2" | "zst") {
                        return Some(Archive);
                    }
                }
                if matches!(ext, "log" | "etl") {
                    return Some(LogFile);
                }
            }
            NodeKind::Link => {}
        }
        None
    }

    /// Classify one entry. See module docs for the evaluation order.
    pub fn classify(&self, e: &Entry) -> Rule {
        if self.is_root(e.path) {
            return Rule::DriveRoot;
        }
        let path_rule = self.path_rule(e.path);
        if let Some(r) = path_rule
            && matches!(r.level(), SafetyLevel::Protected | SafetyLevel::Safe)
        {
            return r;
        }
        let inheritable = e.parent.filter(|p| p.scope() == Scope::Tree);
        if let Some(p) = inheritable
            && matches!(p.level(), SafetyLevel::Safe | SafetyLevel::Protected)
        {
            return p;
        }
        if let Some(r) = self.name_rule(e) {
            return r;
        }
        if let Some(r) = path_rule {
            return r;
        }
        if let Some(p) = inheritable
            && p.level() == SafetyLevel::Review
        {
            return p;
        }
        const TWO_YEARS: i64 = 2 * 365 * 24 * 3600;
        if e.kind == NodeKind::File
            && e.size >= 100 * 1024 * 1024
            && crate::util::is_valid_time(e.modified)
            && now_unix() - e.modified > TWO_YEARS
        {
            return Rule::OldLargeFile;
        }
        Rule::Unknown
    }

    /// Classify an arbitrary path on disk by walking down from its root, so
    /// inherited rules apply exactly as they would in a scan. Used to
    /// re-validate deletions independently of whatever the UI sent.
    pub fn classify_path(&self, path: &Path) -> Rule {
        let mut parent: Option<Rule> = None;
        let mut acc = std::path::PathBuf::new();
        let comps: Vec<Component> = path.components().collect();
        let mut rule = Rule::Unknown;
        let mut parent_was_root = false;
        for (i, c) in comps.iter().enumerate() {
            acc.push(c);
            if matches!(c, Component::Prefix(_)) {
                continue;
            }
            let norm = self.normalize(&acc.to_string_lossy());
            let is_last = i == comps.len() - 1;
            let meta = std::fs::symlink_metadata(&acc).ok();
            let kind = match &meta {
                Some(m) if m.file_type().is_symlink() => NodeKind::Link,
                Some(m) if m.is_file() => NodeKind::File,
                _ => NodeKind::Dir,
            };
            let read_markers = |dir: &Path| {
                let mut m = Markers::default();
                if let Ok(rd) = std::fs::read_dir(dir) {
                    for entry in rd.flatten().take(10_000) {
                        m.observe(&entry.file_name().to_string_lossy());
                    }
                }
                m
            };
            // Markers only matter for the final entry (its own and its parent's).
            let markers = if is_last && kind == NodeKind::Dir {
                read_markers(&acc)
            } else {
                Markers::default()
            };
            let parent_markers = match acc.parent() {
                Some(p) if is_last => read_markers(p),
                _ => Markers::default(),
            };
            let name = c.as_os_str().to_string_lossy().to_lowercase();
            rule = self.classify(&Entry {
                path: &norm,
                name: &name,
                kind,
                parent,
                parent_is_root: parent_was_root,
                markers,
                parent_markers,
                size: meta.as_ref().map(|m| m.len()).unwrap_or(0),
                modified: meta
                    .as_ref()
                    .and_then(|m| m.modified().ok())
                    .map(crate::util::to_unix)
                    .unwrap_or(0),
            });
            parent_was_root = rule == Rule::DriveRoot;
            parent = Some(rule);
        }
        rule
    }

    /// If deleting `path` would also delete a critical location, return it.
    pub fn contains_critical(&self, path: &Path) -> Option<&str> {
        let p = self.normalize(&path.to_string_lossy());
        let sep = self.sep;
        self.critical.iter().map(String::as_str).find(|c| {
            *c == p || (c.len() > p.len() && c.starts_with(&p) && (p.ends_with(sep) || c[p.len()..].starts_with(sep)))
        })
    }
}

fn normalize_with(path: &str, sep: char) -> String {
    if sep == '/' {
        let mut s = path.replace('\\', "/").to_lowercase();
        while s.len() > 1 && s.ends_with('/') {
            s.pop();
        }
        s
    } else {
        normalize(path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn win() -> Classifier {
        let sp = SystemPaths {
            windows: Some(r"C:\Windows".into()),
            program_files: vec![r"C:\Program Files".into(), r"C:\Program Files (x86)".into()],
            program_data: Some(r"C:\ProgramData".into()),
            users_root: Some(r"C:\Users".into()),
            home: Some(r"C:\Users\me".into()),
            local_appdata: Some(r"C:\Users\me\AppData\Local".into()),
            roaming_appdata: Some(r"C:\Users\me\AppData\Roaming".into()),
            temp: vec![r"C:\Users\me\AppData\Local\Temp".into()],
            downloads: Some(r"C:\Users\me\Downloads".into()),
            personal: vec![r"C:\Users\me\Documents".into()],
            onedrive: vec![],
            app_paths: vec![],
            unix: false,
            unix_system_dirs: false,
        };
        Classifier::new(&sp)
    }

    /// Classify a chain of path components the way the scanner does.
    /// Every folder is treated as containing a package.json (a JS project).
    fn chain(c: &Classifier, parts: &[(&str, NodeKind)]) -> Rule {
        chain_with(c, parts, true)
    }

    fn chain_with(c: &Classifier, parts: &[(&str, NodeKind)], package_json: bool) -> Rule {
        let mut path = String::new();
        let mut parent = None;
        let mut parent_is_root = false;
        let mut rule = Rule::Unknown;
        for (i, (name, kind)) in parts.iter().enumerate() {
            if i == 0 {
                path = name.to_string();
            } else {
                if !path.ends_with('\\') {
                    path.push('\\');
                }
                path.push_str(name);
            }
            let norm = c.normalize(&path);
            rule = c.classify(&Entry {
                path: &norm,
                name: &name.to_lowercase(),
                kind: *kind,
                parent,
                parent_is_root,
                markers: Markers::default(),
                parent_markers: Markers {
                    package_json,
                    ..Default::default()
                },
                size: 0,
                modified: 0,
            });
            parent_is_root = rule == Rule::DriveRoot;
            parent = Some(rule);
        }
        rule
    }

    use NodeKind::{Dir as D, File as F};

    #[test]
    fn system_locations_are_protected() {
        let c = win();
        assert_eq!(chain(&c, &[(r"C:\", D)]), Rule::DriveRoot);
        assert_eq!(
            chain(&c, &[(r"C:\", D), ("Windows", D), ("System32", D)]),
            Rule::WindowsDir
        );
        assert_eq!(
            chain(
                &c,
                &[(r"C:\", D), ("Program Files", D), ("nodejs", D), ("node_modules", D)]
            ),
            Rule::ProgramFiles
        );
        assert_eq!(chain(&c, &[(r"C:\", D), ("pagefile.sys", F)]), Rule::SystemFile);
        assert_eq!(
            chain(&c, &[(r"C:\", D), ("$Recycle.Bin", D), ("S-1-5", D)]),
            Rule::RecycleBin
        );
        assert_eq!(chain(&c, &[(r"C:\", D), ("Users", D)]), Rule::UsersRoot);
        assert_eq!(chain(&c, &[(r"C:\", D), ("Users", D), ("me", D)]), Rule::UserProfile);
        assert_eq!(
            chain(&c, &[(r"C:\", D), ("Users", D), ("me", D), ("Downloads", D)]),
            Rule::KnownFolder
        );
    }

    #[test]
    fn specific_safe_rules_beat_broad_protected_ones() {
        let c = win();
        assert_eq!(chain(&c, &[(r"C:\", D), ("Windows", D), ("Temp", D)]), Rule::KeepFolder);
        assert_eq!(
            chain(&c, &[(r"C:\", D), ("Windows", D), ("Temp", D), ("x.log", F)]),
            Rule::WindowsTemp
        );
        assert_eq!(
            chain(
                &c,
                &[
                    (r"C:\", D),
                    ("ProgramData", D),
                    ("Microsoft", D),
                    ("Windows", D),
                    ("WER", D),
                    ("ReportArchive", D)
                ]
            ),
            Rule::ErrorReports
        );
    }

    #[test]
    fn known_folder_contents_are_not_protected() {
        let c = win();
        let dl = [(r"C:\", D), ("Users", D), ("me", D), ("Downloads", D)];
        let mut p = dl.to_vec();
        p.push(("movie.mkv", F));
        assert_eq!(chain(&c, &p), Rule::DownloadsContent);
        let mut p = dl.to_vec();
        p.push(("setup.exe", F));
        assert_eq!(chain(&c, &p), Rule::Installer);
        let mut p = dl.to_vec();
        p.extend([("proj", D), ("node_modules", D), ("react", D)]);
        assert_eq!(chain(&c, &p), Rule::NodeModules);
    }

    #[test]
    fn caches_and_dev_clutter_are_safe() {
        let c = win();
        let local = [(r"C:\", D), ("Users", D), ("me", D), ("AppData", D), ("Local", D)];
        let mut p = local.to_vec();
        p.extend([("Temp", D), ("abc", D)]);
        assert_eq!(chain(&c, &p), Rule::TempContents);
        let mut p = local.to_vec();
        p.extend([
            ("Google", D),
            ("Chrome", D),
            ("User Data", D),
            ("Default", D),
            ("Cache", D),
        ]);
        assert_eq!(chain(&c, &p), Rule::BrowserCache);
        let mut p = local.to_vec();
        p.extend([
            ("Google", D),
            ("Chrome", D),
            ("User Data", D),
            ("Default", D),
            ("Bookmarks", F),
        ]);
        assert_eq!(chain(&c, &p), Rule::Unknown);
        assert_eq!(
            chain(&c, &[(r"D:\", D), ("code", D), ("app", D), ("__pycache__", D)]),
            Rule::BuildCache
        );
        assert_eq!(
            chain(&c, &[(r"D:\", D), ("code", D), (".git", D), ("objects", D)]),
            Rule::GitRepository
        );
    }

    /// Regression: these node_modules belong to installed software and were
    /// once rated Safe. Deleting them breaks the program.
    #[test]
    fn installed_software_node_modules_are_not_safe() {
        let c = win();
        let home = [(r"C:\", D), ("Users", D), ("me", D)];
        let cases: [&[(&str, NodeKind)]; 4] = [
            // Global npm packages.
            &[("AppData", D), ("Roaming", D), ("npm", D), ("node_modules", D)],
            // Editor extension internals.
            &[
                (".vscode", D),
                ("extensions", D),
                ("ms-dotnettools.csdevkit", D),
                ("node_modules", D),
            ],
            // Electron app resources.
            &[
                ("AppData", D),
                ("Local", D),
                ("Programs", D),
                ("signal-desktop", D),
                ("resources", D),
                ("app.asar.unpacked", D),
                ("node_modules", D),
            ],
            // Tool installed into AppData.
            &[
                ("AppData", D),
                ("Local", D),
                ("Microsoft", D),
                ("TypeScript", D),
                ("5.9", D),
                ("node_modules", D),
            ],
        ];
        for rest in cases {
            let mut p = home.to_vec();
            p.extend_from_slice(rest);
            assert_ne!(chain(&c, &p), Rule::NodeModules, "{p:?}");
        }
        // A real project is still safe, but only with a package.json next to it.
        let project = [(r"D:\", D), ("code", D), ("web", D), ("node_modules", D)];
        assert_eq!(chain_with(&c, &project, true), Rule::NodeModules);
        assert_ne!(chain_with(&c, &project, false), Rule::NodeModules);
    }

    /// Regression: folders that are merely *named* "cache" inside program code
    /// were emptied once, which broke npm. They must never be rated as caches.
    #[test]
    fn cache_named_folders_inside_code_are_not_caches() {
        let c = win();
        let home = [(r"C:\", D), ("Users", D), ("me", D), ("AppData", D)];
        let cases: [&[(&str, NodeKind)]; 3] = [
            &[
                ("Roaming", D),
                ("npm", D),
                ("node_modules", D),
                ("npm", D),
                ("node_modules", D),
                ("make-fetch-happen", D),
                ("lib", D),
                ("cache", D),
            ],
            &[
                ("Roaming", D),
                ("npm", D),
                ("node_modules", D),
                ("webpack", D),
                ("lib", D),
                ("cache", D),
            ],
            &[
                ("Local", D),
                ("Programs", D),
                ("Python", D),
                ("Lib", D),
                ("site-packages", D),
                ("pip", D),
                ("_vendor", D),
                ("cachecontrol", D),
                ("caches", D),
            ],
        ];
        for rest in cases {
            let mut p = home.to_vec();
            p.extend_from_slice(rest);
            let r = chain(&c, &p);
            assert!(r.level() != SafetyLevel::Safe, "{p:?} rated {r:?}");
        }
        // Real app caches are still found.
        let mut p = home.to_vec();
        p.extend([("Roaming", D), ("Claude", D), ("Cache", D)]);
        assert_eq!(chain(&c, &p), Rule::AppCache);
    }

    #[test]
    fn critical_ancestors_are_detected() {
        let c = win();
        assert!(c.contains_critical(Path::new(r"C:\")).is_some());
        assert!(c.contains_critical(Path::new(r"C:\Users")).is_some());
        assert!(c.contains_critical(Path::new(r"C:\Users\me\Downloads\x")).is_none());
        assert!(c.contains_critical(Path::new(r"D:\stuff")).is_none());
    }
}
