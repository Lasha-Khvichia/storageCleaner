# storageCleaner

Scan whole drives, see exactly what uses your space, and clean it up safely.

* **Full disk report**: interactive treemap and size-sorted folder tree, largest files, file types
* **Safety ratings** on every file and folder: 🟢 Safe · 🟡 Review · ⚪ Unknown · 🔴 Protected, each with the reason
* **One-click suggestions**: "You can safely free 23 GB" (temp files, caches, `node_modules`, build output...)
* **Safe deletion**: Recycle Bin by default, preview before deleting, protected system locations are blocked
* **Optional permanent delete** with loud warnings and a typed confirmation phrase
* **History & restore**: every cleanup is logged and can be restored from the Recycle Bin
* **Free-space analytics**: graph of free space on every drive over time
* **CLI** included: `storagecleaner scan C:\`

Rust core · Tauri v2 · React + TypeScript · SQLite · Docker for dev/CI.
See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Install (Windows)

Download the latest **`storageCleaner_x.y.z_x64-setup.exe`** from
[Releases](https://github.com/Lasha-Khvichia/storageCleaner/releases) and run it.
The installer lets you pick *just me / all users* and the install folder, and adds
Start-menu & desktop shortcuts. Uninstall from **Settings → Apps**.

> The installer isn't code-signed yet, so SmartScreen may say "unknown publisher".
> Click **More info → Run anyway**.

## Releasing a new version

Releases are built by GitHub Actions ([release.yml](.github/workflows/release.yml)),
never locally, and **only when the version changes**:

```powershell
./scripts/bump-version.ps1 0.2.0      # updates tauri.conf.json, package.json, Cargo.toml
git commit -am "Release v0.2.0"
git push                              # → Actions builds the installer and publishes release v0.2.0
```

Ordinary pushes only run CI (tests + lint). You can also trigger a release
manually from the **Actions → Release → Run workflow** button.

## Run the desktop app from source (Windows)

Prerequisites: [Rust](https://rustup.rs), [Node.js 22+](https://nodejs.org),
Visual Studio C++ Build Tools, WebView2 (preinstalled on Windows 11).

```powershell
cd app
npm install
npm run tauri dev        # development
npm run tauri build      # installer → target\release\bundle\
```

## CLI

```powershell
cargo run -p storage-cleaner-cli -- disks
cargo run -p storage-cleaner-cli -- scan C:\Users --depth 2
cargo run -p storage-cleaner-cli -- suggest C:\
cargo run -p storage-cleaner-cli -- clean C:\path\to\folder            # → Recycle Bin
cargo run -p storage-cleaner-cli -- clean C:\path --permanent          # asks for "DELETE PERMANENTLY"
cargo run -p storage-cleaner-cli -- history
cargo run -p storage-cleaner-cli -- restore <run-id>
```

## Docker

Requires [Docker Desktop](https://www.docker.com/products/docker-desktop/).

```bash
docker compose run --rm test          # all Rust tests
docker compose run --rm lint          # rustfmt + clippy + TypeScript typecheck
docker compose run --rm sandbox       # end-to-end delete/restore safety tests on fake files
docker compose run --rm build-linux   # Linux .deb / .AppImage → ./dist-linux
docker compose run --rm dev           # shell with the full toolchain

# Scan any host folder (mounted read-only)
SCAN_PATH=D:/Projects docker compose run --rm cli scan /scan --depth 2
```

## Project layout

```
crates/core   Rust library: scanner, safety rules, deletion, history (the only code that deletes)
crates/cli    storagecleaner CLI
app/          Tauri desktop app (src-tauri = Rust commands, src = React UI)
docker/       Dockerfile (dev image + CLI image)
scripts/      sandbox safety tests
```
