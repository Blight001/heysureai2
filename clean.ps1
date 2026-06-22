<#
.SYNOPSIS
  One-click cleanup for HeySure workspace + components.

.DESCRIPTION
  Removes all generated heavy directories so the checkout feels light again.
  After running, you will need to re-run npm install / pip install where needed.
#>

[CmdletBinding()]
param()

$ErrorActionPreference = "Continue"

$root = $PSScriptRoot
Write-Host "Cleaning HeySure workspace..." -ForegroundColor Cyan

$targets = @(
    # Workspace level
    ".env",

    # Web
    "web/node_modules",
    "web/dist",
    "web/.vite",
    "web/package-lock.json",   # optional - comment out if you want to keep lockfile

    # Server
    "server/venv",
    "server/__pycache__",
    "server/main/api/__pycache__",
    "server/data/temp_images",
    "server/data/workspace",

    # Device (all platforms)
    "device/windows/node_modules",
    "device/windows/dist",
    "device/windows/release",
    "device/linux/node_modules",
    "device/linux/dist",
    "device/mac/node_modules",
    "device/mac/dist",
    "device/extension/node_modules",
    "device/extension/dist",
    "device/android/.gradle",
    "device/android/build",
    "device/android/app/build",
    "device/*/device_runtime/python/.venv"
)

foreach ($t in $targets) {
    $full = Join-Path $root $t
    if (Test-Path $full) {
        Write-Host "  Removing $t" -ForegroundColor DarkGray
        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $full
    }
}

Write-Host "Cleanup finished." -ForegroundColor Green
Write-Host "Re-run npm install / install-deps.bat inside the components you use." -ForegroundColor Yellow
