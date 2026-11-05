//! Recommended cleanups: ranks deletion candidates by how much space they
//! free *and* how safe they are, then groups them into ready-made plans.
//!
//! ## Scoring (0–100)
//!
//! ```text
//! score = 100 × (0.50 × size + 0.35 × confidence + 0.15 × staleness)
//! ```
//!
//! * **size**: log scale, 1 MB → 0.0, 10 GB+ → 1.0. Big items win, but one
//!   huge file can't drown out everything else.
//! * **confidence**: how sure we are it can go: the safety level, refined
//!   by category (a cache beats an old download beats a personal file) and
//!   by activity (dev clutter of a project touched yesterday is less sure).
//! * **staleness**: time since anything inside changed, 0 → 1 over a year.
//!   For developer clutter the *project's* activity is used (its sibling
//!   files), because `node_modules` itself only changes on install.
//!
//! ## Candidates
//!
//! The tree is walked from the root. Protected subtrees are skipped. The
//! top-most Safe entries are candidates (their children are not listed
//! separately). Review entries are candidates when they're worth it. Inside
//! personal folders only large or stale files qualify. Unrated files qualify
//! only when they are huge *and* untouched for over a year.

use serde::Serialize;

use crate::model::{NodeId, NodeKind, NodeView, ROOT, Tree};
use crate::safety::{Category, Rule, SafetyLevel, Scope};
use crate::util::{format_bytes, now_unix};

const MB: u64 = 1024 * 1024;

const DAY: i64 = 86_400;
/// Recommendations scoring below this aren't shown.
const MIN_SCORE: u8 = 25;
const MAX_ITEMS: usize = 300;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Recommendation {
    pub node: NodeView,
    /// 0–100, higher is a better cleanup.
    pub score: u8,
    /// 0–1, how sure we are this can be deleted.
    pub confidence: f64,
    /// Days since anything relevant changed (project activity for dev clutter).
    pub age_days: i64,
    /// Human readable reasons, most important first.
    pub reasons: Vec<String>,
    /// Ids of the plans that include this item.
    pub plans: Vec<&'static str>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub id: &'static str,
    pub title: &'static str,
    pub description: &'static str,
    /// Riskiest safety level among the plan's items.
    pub risk: SafetyLevel,
    pub bytes: u64,
    pub count: usize,
    pub item_ids: Vec<NodeId>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendationReport {
    pub root: String,
    pub scanned_bytes: u64,
    pub candidates: usize,
    pub plans: Vec<Plan>,
    pub items: Vec<Recommendation>,
}

struct Candidate {
    id: NodeId,
    rule: Rule,
    size: u64,
    age_days: i64,
    /// Whether `age_days` measures the surrounding project, not the item.
    project_age: bool,
}

/// Build recommendations from a scanned tree.
pub fn recommend(tree: &Tree) -> RecommendationReport {
    let now = now_unix();
    let candidates = collect(tree, now);
    let total = tree.root().size.max(1);

    let mut items: Vec<Recommendation> = candidates
        .iter()
        .filter_map(|c| {
            let node = tree.view(c.id)?;
            let (score, confidence) = score(c);
            if score < MIN_SCORE {
                return None;
            }
            let reasons = reasons(c, &node, confidence, total);
            Some(Recommendation {
                node,
                score,
                confidence,
                age_days: c.age_days,
                reasons,
                plans: Vec::new(),
            })
        })
        .collect();
    items.sort_by(|a, b| b.score.cmp(&a.score).then(b.node.size.cmp(&a.node.size)));
    items.truncate(MAX_ITEMS);

    let plans = build_plans(&mut items, &candidates);
    RecommendationReport {
        root: tree.root_path.to_string_lossy().into_owned(),
        scanned_bytes: tree.root().size,
        candidates: candidates.len(),
        plans,
        items,
    }
}

fn age_days(modified: i64, now: i64) -> i64 {
    if !crate::util::is_valid_time(modified) {
        0
    } else {
        ((now - modified) / DAY).max(0)
    }
}

/// Newest modification among a node's siblings that aren't clutter
/// themselves: a proxy for "when was this project last worked on".
fn project_activity(tree: &Tree, id: NodeId) -> Option<i64> {
    let parent = tree.nodes[id as usize].parent?;
    tree.nodes[parent as usize]
        .children
        .iter()
        .filter(|&&c| c != id)
        .map(|&c| &tree.nodes[c as usize])
        .filter(|n| !n.deleted && n.rule.level() != SafetyLevel::Safe && n.rule != Rule::GitRepository)
        .map(|n| n.modified)
        .filter(|&m| m > 0)
        .max()
}

fn collect(tree: &Tree, now: i64) -> Vec<Candidate> {
    let mut out = Vec::new();
    let mut stack = vec![ROOT];
    while let Some(id) = stack.pop() {
        let n = &tree.nodes[id as usize];
        if n.deleted || n.kind == NodeKind::Link {
            continue;
        }
        let rule = n.rule;
        let level = rule.level();
        let category = rule.category();
        let is_dir = n.kind == NodeKind::Dir;
        let mut age = age_days(n.modified, now);
        let descend = |stack: &mut Vec<NodeId>| stack.extend(n.children.iter().copied());

        match level {
            SafetyLevel::Protected => {
                // "Keep this folder" style rules protect only the folder itself.
                if rule.scope() == Scope::SelfOnly || id == ROOT {
                    descend(&mut stack);
                }
            }
            SafetyLevel::Safe => {
                // Explorer keeps its thumbnail/icon caches locked while Windows
                // runs: recommending them only produces failures.
                if n.size >= MB && rule != Rule::ThumbnailCache {
                    let mut project_age = false;
                    if matches!(category, Category::Developer)
                        && let Some(m) = project_activity(tree, id)
                    {
                        age = age_days(m, now);
                        project_age = true;
                    }
                    out.push(Candidate {
                        id,
                        rule,
                        size: n.size,
                        age_days: age,
                        project_age,
                    });
                }
            }
            SafetyLevel::Review => {
                if category == Category::UserData {
                    // Personal folders: never recommend whole folders, only
                    // files that are big, or big-ish and stale.
                    if is_dir {
                        descend(&mut stack);
                    } else if n.size >= 500 * MB
                        || (n.size >= 50 * MB && age >= 180)
                        || (rule == Rule::DownloadsContent && n.size >= 50 * MB && age >= 30)
                    {
                        out.push(Candidate {
                            id,
                            rule,
                            size: n.size,
                            age_days: age,
                            project_age: false,
                        });
                    }
                } else if n.size >= 10 * MB {
                    out.push(Candidate {
                        id,
                        rule,
                        size: n.size,
                        age_days: age,
                        project_age: false,
                    });
                } else if is_dir {
                    descend(&mut stack);
                }
            }
            SafetyLevel::Unknown => {
                if is_dir {
                    descend(&mut stack);
                } else if n.size >= 500 * MB && age >= 365 {
                    out.push(Candidate {
                        id,
                        rule,
                        size: n.size,
                        age_days: age,
                        project_age: false,
                    });
                }
            }
        }
    }
    out
}

fn base_confidence(rule: Rule) -> f64 {
    match rule.level() {
        SafetyLevel::Safe => 0.95,
        SafetyLevel::Review => match rule {
            Rule::Installer => 0.8,
            Rule::Archive | Rule::LogFile => 0.7,
            Rule::NugetPackages => 0.7,
            Rule::VirtualEnv => 0.65,
            Rule::UpgradeLeftovers | Rule::WindowsOld => 0.6,
            Rule::DownloadsContent => 0.5,
            Rule::OldLargeFile => 0.45,
            Rule::PersonalFiles => 0.3,
            Rule::CloudSynced => 0.25,
            _ => 0.5,
        },
        SafetyLevel::Unknown => 0.2,
        SafetyLevel::Protected => 0.0,
    }
}

fn confidence(c: &Candidate) -> f64 {
    let mut conf = base_confidence(c.rule);
    // Clutter of a project you worked on this week: deleting it means a
    // reinstall/rebuild you'll notice soon.
    if c.project_age && c.age_days < 14 {
        conf -= 0.25;
    }
    // Personal and unrated files gain confidence the longer they sit untouched.
    if matches!(c.rule.level(), SafetyLevel::Review | SafetyLevel::Unknown) && c.rule.category() != Category::Installer
    {
        conf += 0.15 * (c.age_days as f64 / 730.0).min(1.0);
    }
    conf.clamp(0.0, 1.0)
}

fn size_score(size: u64) -> f64 {
    let mb = (size as f64 / MB as f64).max(1.0);
    (mb.log10() / 4.0).clamp(0.0, 1.0) // 1 MB → 0, 10 GB → 1
}

fn score(c: &Candidate) -> (u8, f64) {
    let conf = confidence(c);
    let stale = (c.age_days as f64 / 365.0).clamp(0.0, 1.0);
    let s = 100.0 * (0.50 * size_score(c.size) + 0.35 * conf + 0.15 * stale);
    (s.round().clamp(0.0, 100.0) as u8, conf)
}

fn describe_age(days: i64) -> String {
    match days {
        d if d >= 730 => format!("{} years", d / 365),
        d if d >= 60 => format!("{} months", d / 30),
        d if d >= 14 => format!("{} weeks", d / 7),
        d => format!("{d} days"),
    }
}

fn reasons(c: &Candidate, node: &NodeView, conf: f64, total: u64) -> Vec<String> {
    let mut r = Vec::new();
    let share = c.size as f64 / total as f64;
    if share >= 0.01 {
        r.push(format!(
            "Frees {} ({:.1}% of the scan)",
            format_bytes(c.size),
            share * 100.0
        ));
    } else {
        r.push(format!("Frees {}", format_bytes(c.size)));
    }
    r.push(node.reason.to_string());
    if c.project_age {
        if c.age_days >= 90 {
            r.push(format!("Project inactive for {}", describe_age(c.age_days)));
        } else if c.age_days < 14 {
            r.push(format!(
                "Project changed {} ago, so you may still need this",
                describe_age(c.age_days)
            ));
        }
    } else if c.age_days >= 90 {
        r.push(format!("Not modified in {}", describe_age(c.age_days)));
    } else if c.age_days < 7 && c.rule.level() != SafetyLevel::Safe {
        r.push("Modified this week".into());
    }
    if conf < 0.5 {
        r.push("Lower confidence: open it and check before deleting".into());
    }
    r
}

fn build_plans(items: &mut [Recommendation], candidates: &[Candidate]) -> Vec<Plan> {
    let cand = |id: NodeId| candidates.iter().find(|c| c.id == id);
    type Pred = fn(&Recommendation, &Candidate) -> bool;
    let defs: [(&'static str, &'static str, &'static str, Pred); 5] = [
        (
            "recommended",
            "Recommended",
            "The best mix of space and safety: everything safe, plus large items we're confident about.",
            |r, _| {
                r.node.safety == SafetyLevel::Safe
                    || (r.node.safety == SafetyLevel::Review && r.confidence >= 0.6 && r.score >= 55)
            },
        ),
        (
            "quick_safe",
            "Quick & safe",
            "Only items that are rebuilt automatically or never needed again. Zero risk.",
            |r, _| r.node.safety == SafetyLevel::Safe,
        ),
        (
            "stale_dev",
            "Stale dev projects",
            "Dependencies and build output of projects you haven't touched in 3+ months.",
            |r, c| {
                matches!(c.rule.category(), Category::Developer)
                    && c.project_age
                    && c.age_days >= 90
                    && r.node.safety != SafetyLevel::Protected
            },
        ),
        (
            "old_downloads",
            "Old downloads & installers",
            "Installers, archives and files sitting in Downloads for over a month.",
            |_, c| matches!(c.rule, Rule::Installer | Rule::Archive | Rule::DownloadsContent) && c.age_days >= 30,
        ),
        (
            "forgotten_large",
            "Forgotten large files",
            "Big files nobody has touched in over a year. Check each one; some may matter.",
            |r, c| r.node.kind == NodeKind::File && c.size >= 500 * MB && c.age_days >= 365,
        ),
    ];
    let mut plans = Vec::new();
    for (id, title, description, pred) in defs {
        let mut ids = Vec::new();
        let (mut bytes, mut risk) = (0u64, SafetyLevel::Safe);
        for r in items.iter_mut() {
            let Some(c) = cand(r.node.id) else { continue };
            if pred(r, c) {
                ids.push(r.node.id);
                bytes += r.node.size;
                risk = risk.max(r.node.safety);
                r.plans.push(id);
            }
        }
        if !ids.is_empty() {
            plans.push(Plan {
                id,
                title,
                description,
                risk,
                bytes,
                count: ids.len(),
                item_ids: ids,
            });
        }
    }
    plans
}

#[cfg(test)]
mod tests {
    use super::*;

    const GB: u64 = 1024 * MB;

    fn cand(rule: Rule, size: u64, age_days: i64) -> Candidate {
        Candidate {
            id: 0,
            rule,
            size,
            age_days,
            project_age: false,
        }
    }

    #[test]
    fn bigger_and_safer_scores_higher() {
        let (big_safe, _) = score(&cand(Rule::BrowserCache, 5 * GB, 30));
        let (small_safe, _) = score(&cand(Rule::BrowserCache, 5 * MB, 30));
        let (big_personal, _) = score(&cand(Rule::PersonalFiles, 5 * GB, 30));
        assert!(big_safe > small_safe);
        assert!(big_safe > big_personal);
    }

    #[test]
    fn stale_beats_fresh_for_same_item() {
        let (old, _) = score(&cand(Rule::DownloadsContent, GB, 400));
        let (new, _) = score(&cand(Rule::DownloadsContent, GB, 2));
        assert!(old > new);
    }

    #[test]
    fn active_project_clutter_is_less_confident() {
        let mut active = cand(Rule::NodeModules, GB, 2);
        active.project_age = true;
        let mut stale = cand(Rule::NodeModules, GB, 200);
        stale.project_age = true;
        assert!(confidence(&active) < confidence(&stale));
    }

    #[test]
    fn recommends_from_a_real_tree() {
        use crate::safety::{Classifier, SystemPaths};
        use crate::scan::{ScanControl, ScanOptions, scan};
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join("proj/node_modules/x")).unwrap();
        std::fs::write(root.join("proj/package.json"), b"{}").unwrap();
        std::fs::write(root.join("proj/node_modules/x/big.js"), vec![0u8; 3 * MB as usize]).unwrap();
        std::fs::write(root.join("notes.txt"), vec![0u8; 3 * MB as usize]).unwrap();
        let c = Classifier::new(&SystemPaths {
            unix: cfg!(unix),
            ..Default::default()
        });
        let tree = scan(root, &c, &ScanControl::new(), &ScanOptions::default()).unwrap();
        let rep = recommend(&tree);
        assert!(rep.items.iter().any(|r| r.node.name == "node_modules"));
        assert!(
            !rep.items.iter().any(|r| r.node.name == "notes.txt"),
            "unrated small file must not be recommended"
        );
        let quick = rep.plans.iter().find(|p| p.id == "quick_safe").unwrap();
        assert_eq!(quick.risk, SafetyLevel::Safe);
    }
}
