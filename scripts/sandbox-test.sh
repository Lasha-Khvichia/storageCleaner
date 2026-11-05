#!/usr/bin/env bash
# End-to-end safety tests for the CLI, run inside the Docker sandbox
# (tmpfs at /sandbox, no network, source mounted read-only).
#
#   docker compose run --rm sandbox
set -euo pipefail

cd /workspace
echo "▶ building CLI"
cargo build --quiet --offline --locked -p storage-cleaner-cli
SC=/cargo-target/debug/storagecleaner
PHRASE="DELETE PERMANENTLY"

pass=0
ok()   { echo "  ✔ $1"; pass=$((pass + 1)); }
fail() { echo "  ✘ $1"; exit 1; }
# Reads ALL input (unlike grep -q, which exits early and breaks the pipe).
has() { grep -c -- "$1" >/dev/null; }
run_id() { grep -o 'history run #[0-9]*' | grep -o '[0-9]*$'; }

F=/sandbox/fake
mkdir -p "$HOME" "$F/proj/node_modules/react" "$F/proj/target/debug" "$F/proj/.git/objects" "$F/docs"
head -c 200000 /dev/urandom > "$F/proj/node_modules/react/index.js"
head -c 500000 /dev/urandom > "$F/proj/target/debug/app"
echo "Signature: 8a477f597d28d172789f06886806bc55" > "$F/proj/target/CACHEDIR.TAG"
echo "ref: refs/heads/main" > "$F/proj/.git/HEAD"
echo "{}" > "$F/proj/package.json"
echo "important" > "$F/docs/notes.txt"
echo "junk" > "$F/docs/old.tmp"

echo "▶ scan & classification"
$SC scan "$F" --json --depth 3 | has '"rule": "node_modules"' && ok "scan rates node_modules" || fail "scan JSON missing node_modules rule"
$SC suggest "$F" | has "Developer clutter" && ok "node_modules suggested as developer clutter" || fail "node_modules not suggested"
$SC suggest "$F" | has "target" && ok "Rust target dir (CACHEDIR.TAG) suggested" || fail "target not suggested"
$SC suggest "$F" | has "notes.txt" && fail "personal file was suggested" || ok "personal files are not suggested"

echo "▶ recycle bin delete + restore"
out=$($SC clean "$F/proj/node_modules" --yes)
id=$(echo "$out" | run_id)
[ ! -e "$F/proj/node_modules" ] && ok "moved to trash" || fail "still exists after trash delete"
$SC restore "$id" | has "Restored 1" && [ -e "$F/proj/node_modules/react/index.js" ] && ok "restored from trash (run #$id)" || fail "restore failed"

echo "▶ permanent delete guards"
if $SC clean "$F/docs/old.tmp" --permanent --confirm "yes please" >/dev/null 2>&1; then fail "permanent delete ran with wrong phrase"; fi
[ -e "$F/docs/old.tmp" ] && ok "wrong confirmation phrase is rejected" || fail "file deleted with wrong phrase"
$SC clean "$F/docs/old.tmp" --permanent --confirm "$PHRASE" >/dev/null
[ ! -e "$F/docs/old.tmp" ] && ok "permanent delete with exact phrase works" || fail "permanent delete failed"

echo "▶ protected paths are never deleted"
$SC clean "$F/proj/.git" --permanent --confirm "$PHRASE" | has BLOCKED && [ -e "$F/proj/.git/HEAD" ] \
  && ok ".git is blocked" || fail ".git was not blocked"
$SC clean /etc --permanent --confirm "$PHRASE" | has BLOCKED && [ -e /etc/hostname ] \
  && ok "/etc is blocked" || fail "/etc was not blocked"
$SC clean / --permanent --confirm "$PHRASE" | has BLOCKED && ok "filesystem root is blocked" || fail "/ was not blocked"
$SC clean "$STORAGE_CLEANER_DATA_DIR" --permanent --confirm "$PHRASE" | has BLOCKED \
  && ok "the app's own data folder is blocked" || fail "data dir was not blocked"

echo "▶ symlinks are never followed"
mkdir -p /sandbox/outside && echo keep > /sandbox/outside/keep.txt
mkdir -p "$F/linky" && ln -s /sandbox/outside "$F/linky/link"
$SC clean "$F/linky" --permanent --confirm "$PHRASE" >/dev/null
[ -e /sandbox/outside/keep.txt ] && [ ! -e "$F/linky" ] && ok "link target survived" || fail "link target was deleted"

echo "▶ history"
$SC history | has "cleanup(s)" && ok "history recorded" || fail "no history"

echo
echo "All $pass sandbox checks passed."
