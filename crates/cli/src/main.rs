//! `storagecleaner` — command-line front end for the storageCleaner core.

use std::io::{BufRead, Write};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result, bail};
use clap::{Parser, Subcommand};
use console::{Style, style};
use indicatif::{ProgressBar, ProgressStyle};
use storage_cleaner_core::delete::{self, DeleteMode, DeleteRequestItem, PERMANENT_CONFIRM_PHRASE};
use storage_cleaner_core::disks;
use storage_cleaner_core::history::{self, History};
use storage_cleaner_core::model::{NodeId, ROOT, Tree};
use storage_cleaner_core::report;
use storage_cleaner_core::safety::{Classifier, SafetyLevel};
use storage_cleaner_core::scan::{self, ScanControl, ScanOptions};
use storage_cleaner_core::util::{format_bytes, now_unix};

#[derive(Parser)]
#[command(
    name = "storagecleaner",
    version,
    about = "Scan disks, see what uses space, and clean it up safely."
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// List drives with total and free space.
    Disks {
        #[arg(long)]
        json: bool,
    },
    /// Scan a folder or drive and print a size report.
    Scan {
        path: PathBuf,
        /// How many levels of the tree to print.
        #[arg(short, long, default_value_t = 2)]
        depth: usize,
        /// Entries shown per folder.
        #[arg(short, long, default_value_t = 10)]
        top: usize,
        /// Also list the largest files.
        #[arg(long, default_value_t = 10)]
        largest: usize,
        /// Write the report as CSV.
        #[arg(long)]
        csv: Option<PathBuf>,
        /// Print machine-readable JSON instead.
        #[arg(long)]
        json: bool,
    },
    /// Scan and show what can most likely be deleted safely.
    Suggest {
        path: PathBuf,
        /// Also show "review" items (installers, logs, old leftovers...).
        #[arg(long)]
        review: bool,
    },
    /// Ranked cleanup recommendations and ready-made plans.
    Recommend {
        path: PathBuf,
        #[arg(short, long, default_value_t = 20)]
        top: usize,
    },
    /// Delete files or folders (Recycle Bin by default).
    Clean {
        paths: Vec<PathBuf>,
        /// Delete permanently instead of moving to the Recycle Bin.
        #[arg(long)]
        permanent: bool,
        /// Skip the interactive y/N prompt (permanent mode still needs --confirm).
        #[arg(short, long)]
        yes: bool,
        /// Confirmation phrase for permanent mode (non-interactive use).
        #[arg(long)]
        confirm: Option<String>,
        /// Only show the plan, delete nothing.
        #[arg(long)]
        dry_run: bool,
    },
    /// Show past cleanups.
    History {
        #[arg(short, long, default_value_t = 20)]
        limit: usize,
        /// Show the items of one run.
        #[arg(long)]
        run: Option<i64>,
    },
    /// Restore a cleanup run from the Recycle Bin.
    Restore { run: i64 },
    /// Show how much space the Recycle Bin uses (and optionally empty it).
    RecycleBin {
        /// Empty it (all drives, or the one given with --drive). Cannot be undone.
        #[arg(long)]
        empty: bool,
        #[arg(long)]
        drive: Option<String>,
        #[arg(short, long)]
        yes: bool,
    },
    /// Record a free-space snapshot of all drives (for the analytics graph).
    Snapshot,
}

fn main() {
    if let Err(e) = run() {
        eprintln!("{} {e:#}", style("error:").red().bold());
        std::process::exit(1);
    }
}

fn run() -> Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Command::Disks { json } => cmd_disks(json),
        Command::Scan {
            path,
            depth,
            top,
            largest,
            csv,
            json,
        } => cmd_scan(path, depth, top, largest, csv, json),
        Command::Suggest { path, review } => cmd_suggest(path, review),
        Command::Recommend { path, top } => cmd_recommend(path, top),
        Command::Clean {
            paths,
            permanent,
            yes,
            confirm,
            dry_run,
        } => cmd_clean(paths, permanent, yes, confirm, dry_run),
        Command::History { limit, run } => cmd_history(limit, run),
        Command::Restore { run } => {
            let h = History::open_default()?;
            let (ok, missing) = history::restore_run(&h, run)?;
            println!("Restored {ok} item(s). {missing} could not be found in the Recycle Bin.");
            Ok(())
        }
        Command::RecycleBin { empty, drive, yes } => cmd_recycle_bin(empty, drive, yes),
        Command::Snapshot => {
            let h = History::open_default()?;
            let n = disks::record_snapshots(&h, "cli", 0)?;
            println!("Recorded free space for {n} drive(s).");
            Ok(())
        }
    }
}

fn level_style(level: SafetyLevel) -> Style {
    match level {
        SafetyLevel::Safe => Style::new().green(),
        SafetyLevel::Review => Style::new().yellow(),
        SafetyLevel::Unknown => Style::new().dim(),
        SafetyLevel::Protected => Style::new().red(),
    }
}

fn badge(level: SafetyLevel) -> String {
    let s = level_style(level);
    s.apply_to(format!("{:<9}", level.as_str())).to_string()
}

fn bar(share: f64, width: usize) -> String {
    let filled = ((share.clamp(0.0, 1.0)) * width as f64).round() as usize;
    format!("{}{}", "█".repeat(filled), "░".repeat(width - filled))
}

fn cmd_disks(json: bool) -> Result<()> {
    let list = disks::list_disks();
    if json {
        println!("{}", serde_json::to_string_pretty(&list)?);
        return Ok(());
    }
    println!(
        "{:<12} {:<8} {:>10} {:>10} {:>10}  usage",
        "drive", "fs", "total", "used", "free"
    );
    for d in list {
        let share = if d.total_bytes == 0 {
            0.0
        } else {
            d.used_bytes as f64 / d.total_bytes as f64
        };
        let st = if share > 0.9 {
            Style::new().red()
        } else if share > 0.75 {
            Style::new().yellow()
        } else {
            Style::new().green()
        };
        println!(
            "{:<12} {:<8} {:>10} {:>10} {:>10}  {} {:>3.0}%",
            d.mount,
            d.file_system,
            format_bytes(d.total_bytes),
            format_bytes(d.used_bytes),
            format_bytes(d.free_bytes),
            st.apply_to(bar(share, 20)),
            share * 100.0
        );
    }
    Ok(())
}

fn do_scan(path: &PathBuf, classifier: &Classifier) -> Result<Tree> {
    let path = std::path::absolute(path).with_context(|| format!("invalid path {}", path.display()))?;
    let control = Arc::new(ScanControl::new());
    let pb = ProgressBar::new_spinner();
    pb.set_style(ProgressStyle::with_template("{spinner:.cyan} {msg}").unwrap());
    pb.enable_steady_tick(Duration::from_millis(100));

    let ctrl = control.clone();
    let pb2 = pb.clone();
    let ticker = std::thread::spawn(move || {
        while !ctrl.is_cancelled() {
            let p = ctrl.progress();
            pb2.set_message(format!(
                "{} files · {} · {}",
                p.files,
                format_bytes(p.bytes),
                truncate(&p.current_path, 70)
            ));
            std::thread::sleep(Duration::from_millis(150));
        }
    });
    let result = scan::scan(&path, classifier, &control, &ScanOptions::default());
    control.cancel(); // stops the ticker thread
    let _ = ticker.join();
    pb.finish_and_clear();
    let tree = result?;

    if let Ok(h) = History::open_default() {
        let _ = h.record_scan(&report::summary(&tree));
        let _ = disks::record_snapshots(&h, "scan", 15 * 60);
    }
    Ok(tree)
}

fn truncate(s: &str, max: usize) -> String {
    let chars: Vec<char> = s.chars().collect();
    if chars.len() <= max {
        s.to_string()
    } else {
        format!("…{}", chars[chars.len() - max + 1..].iter().collect::<String>())
    }
}

fn cmd_scan(path: PathBuf, depth: usize, top: usize, largest: usize, csv: Option<PathBuf>, json: bool) -> Result<()> {
    let classifier = Classifier::system();
    let tree = do_scan(&path, &classifier)?;
    let root = tree.root();

    if let Some(out) = &csv {
        report::export_csv(&tree, out, depth.max(3))?;
    }
    if json {
        let v = serde_json::json!({
            "root": tree.view(ROOT),
            "children": tree.children_views(ROOT, 0, top),
            "largestFiles": report::largest_files(&tree, largest),
            "types": report::type_breakdown(&tree),
            "suggestions": report::suggestions(&tree, false, 10),
        });
        println!("{}", serde_json::to_string_pretty(&v)?);
        return Ok(());
    }

    println!(
        "{} {}  ·  {} files  ·  {} folders  ·  {:.1}s{}",
        style(tree.root_path.display()).bold(),
        style(format_bytes(root.size)).cyan().bold(),
        root.files,
        root.dirs,
        tree.duration_ms as f64 / 1000.0,
        if root.errors > 0 {
            format!("  ·  {} unreadable", style(root.errors).yellow())
        } else {
            String::new()
        }
    );
    println!();
    print_tree(&tree, ROOT, 0, depth, top);

    if largest > 0 {
        println!("\n{}", style("Largest files").bold().underlined());
        for v in report::largest_files(&tree, largest) {
            println!("  {:>10}  {}  {}", format_bytes(v.size), badge(v.safety), v.path);
        }
    }

    println!("\n{}", style("By safety").bold().underlined());
    let totals = report::safety_totals(&tree);
    for level in [
        SafetyLevel::Safe,
        SafetyLevel::Review,
        SafetyLevel::Unknown,
        SafetyLevel::Protected,
    ] {
        println!(
            "  {}  {:>10}",
            badge(level),
            format_bytes(*totals.get(&level).unwrap_or(&0))
        );
    }
    if let Some(out) = csv {
        println!("\nCSV written to {}", out.display());
    }
    Ok(())
}

fn print_tree(tree: &Tree, id: NodeId, level: usize, max_depth: usize, top: usize) {
    if level >= max_depth {
        return;
    }
    let n = &tree.nodes[id as usize];
    for &c in n.children.iter().take(top) {
        let Some(v) = tree.view(c) else { continue };
        let icon = match v.kind {
            storage_cleaner_core::model::NodeKind::Dir => "📁",
            storage_cleaner_core::model::NodeKind::File => "📄",
            storage_cleaner_core::model::NodeKind::Link => "🔗",
        };
        println!(
            "{}{:>10} {} {:>5.1}%  {}  {} {}",
            "  ".repeat(level),
            format_bytes(v.size),
            style(bar(v.share_of_parent, 10)).cyan(),
            v.share_of_parent * 100.0,
            badge(v.safety),
            icon,
            v.name
        );
        if v.kind == storage_cleaner_core::model::NodeKind::Dir {
            print_tree(tree, c, level + 1, max_depth, top);
        }
    }
    if n.children.len() > top {
        let rest: u64 = n.children.iter().skip(top).map(|&c| tree.nodes[c as usize].size).sum();
        println!(
            "{}{:>10} {}",
            "  ".repeat(level),
            format_bytes(rest),
            style(format!("… {} more", n.children.len() - top)).dim()
        );
    }
}

fn cmd_suggest(path: PathBuf, review: bool) -> Result<()> {
    let classifier = Classifier::system();
    let tree = do_scan(&path, &classifier)?;
    let groups = report::suggestions(&tree, review, 5);
    if groups.is_empty() {
        println!("Nothing obviously safe to delete was found. 🎉");
        return Ok(());
    }
    let safe_total: u64 = groups
        .iter()
        .filter(|g| g.safety == SafetyLevel::Safe)
        .map(|g| g.bytes)
        .sum();
    println!(
        "{} {}\n",
        style("You can most likely free").bold(),
        style(format_bytes(safe_total)).green().bold()
    );
    for g in groups {
        println!(
            "{}  {}  {} ({} item{})",
            badge(g.safety),
            style(format!("{:>10}", format_bytes(g.bytes))).bold(),
            style(&g.label).bold(),
            g.count,
            if g.count == 1 { "" } else { "s" }
        );
        for it in &g.items {
            println!("      {:>10}  {}", format_bytes(it.size), it.path);
        }
        if let Some(first) = g.items.first() {
            println!("      {}", style(first.reason).dim());
        }
        println!();
    }
    println!("Delete with: {}", style("storagecleaner clean <path>...").cyan());
    Ok(())
}

fn prompt(msg: &str) -> Result<String> {
    print!("{msg}");
    std::io::stdout().flush()?;
    let mut line = String::new();
    std::io::stdin().lock().read_line(&mut line)?;
    Ok(line.trim_end_matches(['\r', '\n']).to_string())
}

fn cmd_clean(paths: Vec<PathBuf>, permanent: bool, yes: bool, confirm: Option<String>, dry_run: bool) -> Result<()> {
    if paths.is_empty() {
        bail!("give at least one path to delete");
    }
    let classifier = Classifier::system();
    let mode = if permanent {
        DeleteMode::Permanent
    } else {
        DeleteMode::Trash
    };
    let items: Vec<DeleteRequestItem> = paths
        .iter()
        .map(|p| DeleteRequestItem {
            path: std::path::absolute(p).unwrap_or_else(|_| p.clone()),
            size: 0,
        })
        .collect();

    // Validate first, then measure only what is allowed (never walk a
    // blocked path like "/" just to report its size).
    let mut plan = delete::plan(items, mode, &classifier);
    for it in plan.items.iter_mut().filter(|i| i.allowed) {
        it.size = quick_size(&it.path);
    }
    plan.allowed_bytes = plan.items.iter().filter(|i| i.allowed).map(|i| i.size).sum();
    plan.total_bytes = plan.allowed_bytes;
    if permanent {
        println!(
            "{}",
            style("⚠  PERMANENT DELETE IS ON — nothing will go to the Recycle Bin. This cannot be undone.")
                .red()
                .bold()
                .reverse()
        );
        println!();
    }
    for it in &plan.items {
        if it.allowed {
            println!(
                "  {}  {:>10}  {}",
                badge(it.safety),
                format_bytes(it.size),
                it.path.display()
            );
            for w in &it.warnings {
                println!("               {} {}", style("!").yellow(), style(w).dim());
            }
        } else {
            println!(
                "  {}  {:>10}  {}  {}",
                style("BLOCKED  ").red().bold(),
                format_bytes(it.size),
                it.path.display(),
                style(it.blocked_reason.as_deref().unwrap_or("")).red()
            );
        }
    }
    println!();
    for w in &plan.warnings {
        println!("{} {}", style("warning:").yellow().bold(), w);
    }
    println!(
        "{} item(s), {} will be {}.",
        plan.allowed_count,
        style(format_bytes(plan.allowed_bytes)).bold(),
        if permanent {
            style("PERMANENTLY DELETED").red().bold().to_string()
        } else {
            "moved to the Recycle Bin".to_string()
        }
    );
    if plan.allowed_count == 0 || dry_run {
        return Ok(());
    }

    let phrase = if permanent {
        match confirm {
            Some(c) => Some(c),
            None => Some(prompt(&format!(
                "Type {} to continue: ",
                style(PERMANENT_CONFIRM_PHRASE).red().bold()
            ))?),
        }
    } else {
        if !yes {
            let a = prompt("Continue? [y/N] ")?;
            if !a.eq_ignore_ascii_case("y") && !a.eq_ignore_ascii_case("yes") {
                println!("Cancelled. Nothing was deleted.");
                return Ok(());
            }
        }
        None
    };

    let to_delete: Vec<DeleteRequestItem> = plan
        .items
        .iter()
        .filter(|i| i.allowed)
        .map(|i| DeleteRequestItem {
            path: i.path.clone(),
            size: i.size,
        })
        .collect();
    let history = History::open_default()?;
    let report = delete::execute(to_delete, mode, phrase.as_deref(), &classifier, &history, "cli")?;
    let _ = disks::record_snapshots(&history, "cleanup", 0);

    for o in report.items.iter().filter(|o| o.error.is_some()) {
        println!(
            "  {} {}  {}",
            style("failed").red(),
            o.path.display(),
            style(o.error.as_deref().unwrap_or("")).dim()
        );
    }
    println!(
        "{} Freed {} · {} deleted · {} failed · {} skipped  (history run #{})",
        style("✔").green().bold(),
        style(format_bytes(report.freed_bytes)).green().bold(),
        report.deleted_count,
        report.failed_count,
        report.skipped_count,
        report.run_id
    );
    if mode == DeleteMode::Trash && report.deleted_count > 0 {
        println!(
            "Undo with: {}",
            style(format!("storagecleaner restore {}", report.run_id)).cyan()
        );
    }
    Ok(())
}

/// Size of a path without building a full tree (used for CLI deletes).
fn quick_size(p: &std::path::Path) -> u64 {
    let Ok(m) = std::fs::symlink_metadata(p) else { return 0 };
    if m.is_file() {
        return m.len();
    }
    if m.file_type().is_symlink() {
        return 0;
    }
    let mut total = 0;
    let mut stack = vec![p.to_path_buf()];
    while let Some(d) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&d) else { continue };
        for e in rd.flatten() {
            let Ok(m) = e.metadata() else { continue };
            if m.file_type().is_symlink() {
                continue;
            }
            if m.is_dir() {
                stack.push(e.path());
            } else {
                total += m.len();
            }
        }
    }
    total
}

fn cmd_history(limit: usize, run: Option<i64>) -> Result<()> {
    let h = History::open_default()?;
    if let Some(id) = run {
        for it in h.cleanup_items(id)? {
            println!(
                "{:<9} {:>10}  {}  {}",
                format!("{:?}", it.status).to_lowercase(),
                format_bytes(it.size),
                badge(it.safety),
                it.path
            );
        }
        return Ok(());
    }
    let totals = h.totals()?;
    println!(
        "{} cleanup(s), {} freed in total.\n",
        totals.runs,
        style(format_bytes(totals.freed_bytes)).green().bold()
    );
    let now = now_unix();
    for r in h.cleanup_runs(limit)? {
        let ago = now - r.finished_at;
        let when = if ago < 3600 {
            format!("{}m ago", ago / 60)
        } else if ago < 86400 {
            format!("{}h ago", ago / 3600)
        } else {
            format!("{}d ago", ago / 86400)
        };
        println!(
            "#{:<5} {:>8}  {:>10}  {:<9}  {} deleted, {} failed, {} skipped  [{}]",
            r.id,
            when,
            format_bytes(r.freed_bytes),
            if r.mode == DeleteMode::Permanent {
                style("permanent").red().to_string()
            } else {
                "trash    ".into()
            },
            r.deleted_count,
            r.failed_count,
            r.skipped_count,
            r.source
        );
    }
    Ok(())
}

fn cmd_recommend(path: PathBuf, top: usize) -> Result<()> {
    let classifier = Classifier::system();
    let tree = do_scan(&path, &classifier)?;
    let rep = storage_cleaner_core::recommend::recommend(&tree);
    println!("{}\n", style("Cleanup plans").bold().underlined());
    for p in &rep.plans {
        println!(
            "  {}  {:>10}  {:<28} {} item(s)",
            badge(p.risk),
            style(format_bytes(p.bytes)).bold(),
            p.title,
            p.count
        );
    }
    println!(
        "\n{}\n",
        style(format!("Top {top} recommendations")).bold().underlined()
    );
    for r in rep.items.iter().take(top) {
        println!(
            "  {:>3}  {}  {:>10}  {}",
            style(r.score).cyan().bold(),
            badge(r.node.safety),
            format_bytes(r.node.size),
            r.node.path
        );
        println!("       {}", style(r.reasons[1..].join(" · ")).dim());
    }
    Ok(())
}

fn cmd_recycle_bin(empty: bool, drive: Option<String>, yes: bool) -> Result<()> {
    use storage_cleaner_core::recycle_bin;
    let info = recycle_bin::info()?;
    println!(
        "Recycle Bin: {} in {} item(s)",
        style(format_bytes(info.bytes)).bold(),
        info.items
    );
    for d in &info.drives {
        println!("  {:<6} {:>10}  {} item(s)", d.drive, format_bytes(d.bytes), d.items);
    }
    if !empty {
        return Ok(());
    }
    if !yes {
        let a = prompt(&format!("{} Empty it? This cannot be undone. [y/N] ", style("⚠").red()))?;
        if !a.eq_ignore_ascii_case("y") {
            println!("Cancelled.");
            return Ok(());
        }
    }
    let h = History::open_default()?;
    let r = recycle_bin::empty(drive.as_deref(), &h, "cli")?;
    let _ = disks::record_snapshots(&h, "recycle_bin", 0);
    println!(
        "{} Freed {} ({} items).",
        style("✔").green(),
        format_bytes(r.freed_bytes),
        r.items
    );
    Ok(())
}
