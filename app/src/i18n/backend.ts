/**
 * Translations for text produced by the Rust core (which stays English):
 * safety-rule reasons, category labels, cleanup plans, recommendation
 * reasons, delete warnings and error messages.
 *
 * Exact strings are looked up first, then dynamic messages are matched by
 * pattern. Anything unknown falls back to the original English, so a new
 * backend message is never lost, just untranslated.
 *
 * Keep in sync with: crates/core/src/{safety,recommend,delete,report}.rs
 * and app/src-tauri/src/commands.rs.
 */
import { currentLang, type Lang } from "./index";

type Table = Record<string, string>;

/** Safety-rule reasons, keyed by rule id (NodeView.rule / PlanItem.rule). */
const RULE_REASON_EN: Table = {
  unknown: "Not recognised. Check what it is before deleting.",
  drive_root: "The root of a drive can never be deleted.",
  windows_dir: "Windows system files. Deleting these can make the PC unbootable.",
  program_files: "Installed programs. Uninstall them from Settings > Apps instead.",
  program_data: "Shared data used by installed programs and Windows services.",
  app_packages: "Microsoft Store apps and WSL distributions. Remove them from Settings > Apps.",
  users_root: "Folder holding every user profile on this PC.",
  user_profile: "A user profile folder. Delete individual items inside it instead.",
  appdata_root: "Application settings root. Programs break without it.",
  known_folder: "A Windows library folder (Desktop, Documents, Downloads...). Keep the folder; review its contents.",
  keep_folder: "Keep this folder itself. Its contents are what can be cleaned.",
  system_dir: "System folder used for booting, recovery or the operating system.",
  system_file: "Core system file (page file, hibernation, boot or registry hive).",
  recycle_bin: "The Recycle Bin. Empty it from the Recycle Bin itself.",
  system_volume_info: "Restore points and volume metadata. Manage them via System Protection settings.",
  virtual_disk: "Virtual disk image (VM, WSL or Docker). Delete it from the app that owns it.",
  git_repository: "Git history. Deleting it loses every commit not pushed. Delete the whole project instead if you mean to.",
  app_own_data: "storageCleaner's own files. They are in use while the app runs.",
  temp_contents: "Temporary files. Programs recreate what they need; files in use are skipped.",
  windows_temp: "Windows temporary files. Safe to clear; may need administrator rights.",
  windows_update_cache: "Downloaded Windows Update packages that are already installed.",
  error_reports: "Windows Error Reporting files, only useful for crash diagnostics.",
  crash_dumps: "Crash dump. Only useful for debugging a crash that already happened.",
  internet_cache: "Internet cache used by Windows components. Rebuilt automatically.",
  browser_cache: "Browser cache. Web pages re-download it; you stay logged in.",
  app_cache: "Application cache. The app rebuilds it when needed.",
  shader_cache: "Graphics shader cache. Rebuilt by your GPU driver and games.",
  thumbnail_cache: "Explorer thumbnail/icon cache. Rebuilt automatically (in-use files are skipped).",
  cachedir_tag: "Folder marked as a cache (CACHEDIR.TAG), e.g. a Rust target folder. Regenerated on next build.",
  node_modules: "Node.js dependencies. Restore any time with `npm install`.",
  build_cache: "Build or tool cache (Python, Next.js, Gradle...). Regenerated on next run.",
  package_cache: "Package manager download cache (npm, pip, cargo, yarn, Go...). Re-downloaded when needed.",
  temp_file: "Temporary file left behind by a program.",
  downloads: "In your Downloads folder. Often safe, but make sure you still don't need it.",
  personal_files: "Your personal files. Only you can tell if they are still needed.",
  cloud_synced: "Synced with OneDrive. Deleting it here also deletes it from the cloud.",
  installer: "Installer or disk image in Downloads. Usually not needed after installing.",
  archive: "Archive in Downloads. Not needed if you already extracted it.",
  virtual_env: "Python virtual environment. Recreate it with `pip install -r requirements.txt`.",
  nuget_packages: ".NET package cache. Re-downloaded on next restore, which can be slow.",
  upgrade_leftovers: "Leftovers from a Windows upgrade. Prefer Settings > Storage > Temporary files.",
  windows_old: "Previous Windows installation. Removing it disables rollback; use Settings > Storage.",
  log_file: "Log file. Usually safe unless you are troubleshooting something.",
  old_large_file: "Large file not modified in over 2 years.",
  browser_ai_model: "Chrome's on-device AI model. Chrome downloads it again unless you turn off on-device AI in chrome://flags.",
};

const RULE_REASON: Record<Exclude<Lang, "en">, Table> = {
  ka: {
    unknown: "ამოუცნობია. წაშლამდე გაარკვიეთ, რა არის.",
    drive_root: "დისკის ძირეული საქაღალდის წაშლა შეუძლებელია.",
    windows_dir: "Windows-ის სისტემური ფაილები. მათმა წაშლამ შეიძლება კომპიუტერი ვეღარ ჩაიტვირთოს.",
    program_files: "დაინსტალირებული პროგრამები. წაშალეთ ისინი პარამეტრები > აპები-დან.",
    program_data: "დაინსტალირებული პროგრამებისა და Windows-ის სერვისების საერთო მონაცემები.",
    app_packages: "Microsoft Store-ის აპები და WSL-ის დისტრიბუციები. წაშალეთ პარამეტრები > აპები-დან.",
    users_root: "საქაღალდე, სადაც ამ კომპიუტერის ყველა მომხმარებლის პროფილია.",
    user_profile: "მომხმარებლის პროფილის საქაღალდე. სანაცვლოდ წაშალეთ ცალკეული ელემენტები მის შიგნით.",
    appdata_root: "აპლიკაციების პარამეტრების ძირეული საქაღალდე. მის გარეშე პროგრამები ფუჭდება.",
    known_folder: "Windows-ის ბიბლიოთეკის საქაღალდე (სამუშაო მაგიდა, დოკუმენტები, ჩამოტვირთვები...). საქაღალდე დატოვეთ, შიგთავსი გადახედეთ.",
    keep_folder: "თავად ეს საქაღალდე დატოვეთ — გასუფთავება მის შიგთავსს შეიძლება.",
    system_dir: "სისტემური საქაღალდე ჩატვირთვისთვის, აღდგენისთვის ან ოპერაციული სისტემისთვის.",
    system_file: "სისტემის ძირითადი ფაილი (page file, ჰიბერნაცია, ჩატვირთვა ან რეესტრი).",
    recycle_bin: "ნაგვის ურნა. დაცალეთ თავად ნაგვის ურნიდან.",
    system_volume_info: "აღდგენის წერტილები და ტომის მეტამონაცემები. მართეთ სისტემის დაცვის პარამეტრებიდან.",
    virtual_disk: "ვირტუალური დისკის ასლი (VM, WSL ან Docker). წაშალეთ იმ აპიდან, რომელსაც ეკუთვნის.",
    git_repository: "Git-ის ისტორია. წაშლით დაიკარგება ყველა ჯერ არ ატვირთული commit. თუ ეს გსურთ, წაშალეთ მთელი პროექტი.",
    app_own_data: "storageCleaner-ის საკუთარი ფაილები. აპის მუშაობისას ისინი გამოიყენება.",
    temp_contents: "დროებითი ფაილები. პროგრამები საჭიროს თავიდან შექმნიან; გამოყენებული ფაილები გამოიტოვება.",
    windows_temp: "Windows-ის დროებითი ფაილები. გასუფთავება უსაფრთხოა; შეიძლება ადმინისტრატორის უფლება დასჭირდეს.",
    windows_update_cache: "Windows Update-ის ჩამოტვირთული პაკეტები, რომლებიც უკვე დაინსტალირებულია.",
    error_reports: "Windows-ის შეცდომების ანგარიშები, საჭიროა მხოლოდ ავარიის დიაგნოსტიკისთვის.",
    crash_dumps: "ავარიის დამპი. საჭიროა მხოლოდ უკვე მომხდარი ავარიის გამოსაკვლევად.",
    internet_cache: "Windows-ის კომპონენტების ინტერნეტ-ქეში. ავტომატურად აღდგება.",
    browser_cache: "ბრაუზერის ქეში. გვერდები თავიდან ჩამოტვირთავს; ანგარიშიდან არ გამოხვალთ.",
    app_cache: "აპის ქეში. საჭიროებისას აპი თავიდან შექმნის.",
    shader_cache: "გრაფიკული შეიდერების ქეში. GPU-ს დრაივერი და თამაშები თავიდან შექმნის.",
    thumbnail_cache: "Explorer-ის მინიატურებისა და ხატულების ქეში. ავტომატურად აღდგება (გამოყენებული ფაილები გამოიტოვება).",
    cachedir_tag: "ქეშად მონიშნული საქაღალდე (CACHEDIR.TAG), მაგ. Rust-ის target. შემდეგ build-ზე თავიდან შეიქმნება.",
    node_modules: "Node.js-ის დამოკიდებულებები. ნებისმიერ დროს აღადგენთ `npm install`-ით.",
    build_cache: "build-ის ან ხელსაწყოს ქეში (Python, Next.js, Gradle...). შემდეგ გაშვებაზე თავიდან შეიქმნება.",
    package_cache: "პაკეტების მენეჯერის ჩამოტვირთვების ქეში (npm, pip, cargo, yarn, Go...). საჭიროებისას თავიდან ჩამოიტვირთება.",
    temp_file: "პროგრამის მიერ დატოვებული დროებითი ფაილი.",
    downloads: "თქვენს ჩამოტვირთვებშია. ხშირად უსაფრთხოა, მაგრამ დარწმუნდით, რომ აღარ გჭირდებათ.",
    personal_files: "თქვენი პირადი ფაილები. მხოლოდ თქვენ იცით, ჯერ კიდევ გჭირდებათ თუ არა.",
    cloud_synced: "სინქრონიზებულია OneDrive-თან. აქ წაშლა ღრუბლიდანაც წაშლის.",
    installer: "ინსტალერი ან დისკის ასლი ჩამოტვირთვებში. დაინსტალირების შემდეგ ჩვეულებრივ აღარ არის საჭირო.",
    archive: "არქივი ჩამოტვირთვებში. საჭირო აღარ არის, თუ უკვე ამოაარქივეთ.",
    virtual_env: "Python-ის ვირტუალური გარემო. თავიდან შექმნით `pip install -r requirements.txt`-ით.",
    nuget_packages: ".NET-ის პაკეტების ქეში. შემდეგ აღდგენაზე თავიდან ჩამოიტვირთება, რასაც შეიძლება დრო დასჭირდეს.",
    upgrade_leftovers: "Windows-ის განახლების ნარჩენები. სჯობს: პარამეტრები > მეხსიერება > დროებითი ფაილები.",
    windows_old: "Windows-ის წინა ინსტალაცია. წაშლით უკან დაბრუნება შეუძლებელი გახდება; გამოიყენეთ პარამეტრები > მეხსიერება.",
    log_file: "ლოგ-ფაილი. ჩვეულებრივ უსაფრთხოა, თუ რაიმე პრობლემას არ იკვლევთ.",
    old_large_file: "დიდი ფაილი, რომელიც 2 წელზე მეტია არ შეცვლილა.",
    browser_ai_model: "Chrome-ის მოწყობილობაზე მომუშავე AI მოდელი. Chrome თავიდან ჩამოტვირთავს, თუ chrome://flags-ში on-device AI-ს არ გამორთავთ.",
  },
};

/** English reason text → rule id (to translate reasons sent as plain text). */
const RULE_BY_REASON: Table = Object.fromEntries(Object.entries(RULE_REASON_EN).map(([id, text]) => [text, id]));

/** Suggestion categories (SuggestionGroup.category) and their English labels. */
const CATEGORY: Record<Exclude<Lang, "en">, Table> = {
  ka: {
    system: "სისტემა",
    program: "პროგრამები",
    user_data: "პირადი ფაილები",
    temp: "დროებითი ფაილები",
    browser_cache: "ბრაუზერის ქეში",
    app_cache: "აპების ქეში",
    developer: "დეველოპერული ნარჩენები",
    package_cache: "პაკეტების მენეჯერის ქეში",
    installer: "ინსტალერები და არქივები",
    crash_report: "ავარიის ანგარიშები",
    windows_update: "Windows Update",
    logs: "ლოგები",
    old_file: "ძველი დიდი ფაილები",
    virtual_disk: "ვირტუალური დისკები",
    other: "სხვა",
  },
};

/** Cleanup plans (recommend.rs build_plans), by plan id. */
const PLANS: Record<Exclude<Lang, "en">, Record<string, { title: string; description: string }>> = {
  ka: {
    recommended: {
      title: "რეკომენდებული",
      description: "ადგილისა და უსაფრთხოების საუკეთესო ბალანსი: ყველაფერი უსაფრთხო და დიდი ელემენტები, რომლებშიც დარწმუნებულები ვართ.",
    },
    quick_safe: {
      title: "სწრაფი და უსაფრთხო",
      description: "მხოლოდ ის, რაც ავტომატურად აღდგება ან აღარასდროს დაგჭირდებათ. ნულოვანი რისკი.",
    },
    stale_dev: {
      title: "მიტოვებული დეველოპერული პროექტები",
      description: "პროექტების დამოკიდებულებები და build-ის შედეგები, რომლებსაც 3+ თვეა არ შეხებიხართ.",
    },
    old_downloads: {
      title: "ძველი ჩამოტვირთვები და ინსტალერები",
      description: "ინსტალერები, არქივები და ფაილები, რომლებიც ჩამოტვირთვებში თვეზე მეტია დევს.",
    },
    forgotten_large: {
      title: "დავიწყებული დიდი ფაილები",
      description: "დიდი ფაილები, რომლებსაც წელზე მეტია არავინ შეხებია. თითოეული გადაამოწმეთ — ზოგი შეიძლება მნიშვნელოვანი იყოს.",
    },
  },
};

/** Exact backend strings that aren't rule reasons. */
const EXACT: Record<Exclude<Lang, "en">, Table> = {
  ka: {
    // Category labels (also sent as SuggestionGroup.label)
    System: "სისტემა",
    Programs: "პროგრამები",
    "Personal files": "პირადი ფაილები",
    "Temporary files": "დროებითი ფაილები",
    "Browser cache": "ბრაუზერის ქეში",
    "App cache": "აპების ქეში",
    "Developer clutter": "დეველოპერული ნარჩენები",
    "Package manager cache": "პაკეტების მენეჯერის ქეში",
    "Installers & archives": "ინსტალერები და არქივები",
    "Crash reports": "ავარიის ანგარიშები",
    Logs: "ლოგები",
    "Old large files": "ძველი დიდი ფაილები",
    "Virtual disks": "ვირტუალური დისკები",
    Other: "სხვა",
    // File-type groups (report.rs group_of)
    Videos: "ვიდეო",
    Images: "სურათები",
    Audio: "აუდიო",
    Documents: "დოკუმენტები",
    Archives: "არქივები",
    "Disk images": "დისკის ასლები",
    Code: "კოდი",
    "Temp & logs": "დროებითი და ლოგები",
    Data: "მონაცემები",
    "(none)": "(გაფართოების გარეშე)",
    // Recommendation reasons
    "Modified this week": "შეიცვალა ამ კვირაში",
    "Lower confidence: open it and check before deleting": "დაბალი დარწმუნებულობა: წაშლამდე გახსენით და შეამოწმეთ",
    // Delete plan / validation
    "PERMANENT DELETE IS ON. Files will NOT go to the Recycle Bin and cannot be recovered.":
      "სამუდამო წაშლა ჩართულია. ფაილები ნაგვის ურნაში არ გადავა და მათი აღდგენა შეუძლებელი იქნება.",
    "Not recognised by any safety rule. Make sure you know what this is.":
      "არცერთი უსაფრთხოების წესით არ არის ამოცნობილი. დარწმუნდით, რომ იცით, რა არის.",
    "This is a link/junction. Only the link is removed, not its target.":
      "ეს ბმული/junction-ია. წაიშლება მხოლოდ ბმული და არა ის, რაზეც მიუთითებს.",
    "Permanent delete: this cannot be undone or restored from the Recycle Bin.":
      "სამუდამო წაშლა: ამის გაუქმება ან ნაგვის ურნიდან აღდგენა შეუძლებელია.",
    "Path must be absolute.": "მისამართი სრული უნდა იყოს.",
    // friendly_error()
    "In use by another program. Close that program (or restart) and try again.":
      "ფაილს სხვა პროგრამა იყენებს. დახურეთ ის (ან გადატვირთეთ კომპიუტერი) და სცადეთ თავიდან.",
    "Access denied. This item may need administrator rights.": "წვდომა აკრძალულია. შეიძლება ადმინისტრატორის უფლება დასჭირდეს.",
    "Already gone: it was deleted or moved by something else.": "უკვე აღარ არსებობს: სხვა რამემ წაშალა ან გადაიტანა.",
    // Tauri command errors
    "No scan results yet. Run a scan first.": "სკანირების შედეგები ჯერ არ არის. ჯერ გაუშვით სკანირება.",
    "A scan is already running.": "სკანირება უკვე მიმდინარეობს.",
    "Nothing selected.": "არაფერია მონიშნული.",
    "scan was cancelled": "სკანირება გაუქმდა",
  },
};

const AGE_UNITS: Record<Exclude<Lang, "en">, Table> = {
  ka: { years: "წელი", months: "თვე", weeks: "კვირა", days: "დღე" },
};

function age(text: string, lang: Exclude<Lang, "en">): string {
  return text.replace(/(\d+) (years|months|weeks|days)/, (_, n, u) => `${n} ${AGE_UNITS[lang][u]}`);
}

/** Dynamic messages: [pattern, Georgian builder]. Order matters. */
const PATTERNS: Record<Exclude<Lang, "en">, [RegExp, (m: RegExpMatchArray, tr: (s: string) => string) => string][]> = {
  ka: [
    [/^Frees (.+) \(([\d.]+)% of the scan\)$/, (m) => `ათავისუფლებს ${m[1]}-ს (სკანირებულის ${m[2]}%)`],
    [/^Frees (.+)$/, (m) => `ათავისუფლებს ${m[1]}-ს`],
    [/^Not modified in (.+)$/, (m) => `უცვლელია ${age(m[1], "ka")}`],
    [/^Project inactive for (.+)$/, (m) => `პროექტი უმოქმედოა ${age(m[1], "ka")}`],
    [/^Project changed (.+) ago, so you may still need this$/, (m) => `პროექტი ${age(m[1], "ka")}-ის წინ შეიცვალა — შესაძლოა ჯერ კიდევ გჭირდებათ`],
    [/^(\d+) item\(s\) are not rated Safe\. Review them before continuing\.$/, (m) => `${m[1]} ელემენტს არ აქვს „უსაფრთხო“ შეფასება. გაგრძელებამდე გადახედეთ.`],
    [/^(\d+) protected item\(s\) will be skipped\.$/, (m) => `${m[1]} დაცული ელემენტი გამოიტოვება.`],
    [/^Needs review: (.+)$/, (m, tr) => `საჭიროებს გადამოწმებას: ${tr(m[1])}`],
    [/^Very large item \((.+)\)\.$/, (m) => `ძალიან დიდი ელემენტი (${m[1]}).`],
    [/^Cannot access: (.+)$/, (m) => `წვდომა ვერ მოხერხდა: ${m[1]}`],
    [/^Contains a protected location: (.+)$/, (m) => `შეიცავს დაცულ ადგილს: ${m[1]}`],
    [/^Partly cleaned: (\d+) item\(s\) are in use by other programs and were left\.$/, (m) => `ნაწილობრივ გასუფთავდა: ${m[1]} ელემენტს სხვა პროგრამები იყენებს და დარჩა.`],
    [/^Recycle Bin \((.+)\)$/, (m) => `ნაგვის ურნა (${m[1]})`],
    [/^deletion blocked: (.+)$/, (m, tr) => `წაშლა დაბლოკილია: ${tr(m[1])}`],
    [
      /^permanent deletion requires typing the confirmation phrase "(.+)"$/,
      (m) => `სამუდამო წაშლისთვის საჭიროა დადასტურების ფრაზის ინგლისურად აკრეფა: "${m[1]}"`,
    ],
  ],
};

/** Translate any text that came from the backend (falls back to English). */
export function trBackend(text: string | null | undefined, lang: Lang = currentLang()): string {
  if (!text) return text ?? "";
  if (lang === "en") return text;
  const rule = RULE_BY_REASON[text];
  if (rule) return RULE_REASON[lang][rule] ?? text;
  const exact = EXACT[lang][text];
  if (exact) return exact;
  for (const [re, build] of PATTERNS[lang]) {
    const m = text.match(re);
    if (m) return build(m, (s) => trBackend(s, lang));
  }
  return text;
}

/** Rule reason by rule id (preferred over matching text when the id is known). */
export function trRule(ruleId: string, english: string, lang: Lang = currentLang()): string {
  if (lang === "en") return english;
  return RULE_REASON[lang][ruleId] ?? trBackend(english, lang);
}

export function trCategory(id: string, english: string, lang: Lang = currentLang()): string {
  if (lang === "en") return english;
  return CATEGORY[lang][id] ?? trBackend(english, lang);
}

export function trPlan(id: string, title: string, description: string, lang: Lang = currentLang()) {
  if (lang === "en") return { title, description };
  return PLANS[lang][id] ?? { title, description };
}
