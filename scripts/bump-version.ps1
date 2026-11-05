<#
.SYNOPSIS
  Set a new storageCleaner version everywhere it is stored.

.DESCRIPTION
  Updates app/src-tauri/tauri.conf.json (the version GitHub Actions releases),
  app/package.json and the Rust workspace Cargo.toml. Pushing the change to
  main then builds the installer and publishes a GitHub Release automatically.

.EXAMPLE
  ./scripts/bump-version.ps1 0.2.0
  git commit -am "Release v0.2.0"; git push
#>
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^\d+\.\d+\.\d+$')]
  [string]$Version
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

function Set-Version([string]$file, [string]$pattern, [string]$replacement) {
  $path = Join-Path $root $file
  $text = [System.IO.File]::ReadAllText($path)
  $new = [regex]::Replace($text, $pattern, $replacement, 1)
  if ($new -eq $text) { throw "Version not found in $file" }
  [System.IO.File]::WriteAllText($path, $new)
  Write-Host "  $file -> $Version"
}

Write-Host "Setting version $Version"
Set-Version 'app/src-tauri/tauri.conf.json' '"version":\s*"[^"]+"' "`"version`": `"$Version`""
Set-Version 'app/package.json' '"version":\s*"[^"]+"' "`"version`": `"$Version`""
# Only the [workspace.package] version line (it is the first `version =` line).
Set-Version 'Cargo.toml' '(?m)^version = "[^"]+"' "version = `"$Version`""

Write-Host ""
Write-Host "Next: commit and push to main. GitHub Actions builds the installer and publishes release v$Version."
Write-Host "  git commit -am `"Release v$Version`"; git push"
