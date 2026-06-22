<#
.SYNOPSIS
  HeySure Workspace bootstrap script (PowerShell).

.DESCRIPTION
  Clones (or updates) the three component repositories into the expected layout:
    ./web
    ./server
    ./device

  After running this, docker-compose.yml and all run*.bat scripts will work
  exactly as they did in the old monorepo.

  Usage:
    pwsh -File init-env.ps1

  You can override the repository base with the HEYSURE_REPO_BASE environment variable:
    $env:HEYSURE_REPO_BASE = "https://github.com/YourOrg"
    pwsh -File init-env.ps1
#>

[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$WorkspaceRoot = $PSScriptRoot
Set-Location $WorkspaceRoot

$RepoBase = if ($env:HEYSURE_REPO_BASE) { $env:HEYSURE_REPO_BASE.TrimEnd('/') } else { "https://github.com/Blight001" }

$Repos = @(
    @{ Name = "HeySure-Web";     Dir = "web" },
    @{ Name = "HeySure-Server";  Dir = "server" },
    @{ Name = "HeySure-Device";  Dir = "device" }
)

Write-Host "HeySure workspace bootstrap" -ForegroundColor Cyan
Write-Host "Repo base : $RepoBase" -ForegroundColor DarkGray
Write-Host ""

foreach ($r in $Repos) {
    $target = Join-Path $WorkspaceRoot $r.Dir
    $url = "$RepoBase/$($r.Name).git"

    if (Test-Path (Join-Path $target ".git")) {
        Write-Host "[skip] $($r.Dir) already has a git repository" -ForegroundColor Yellow
        continue
    }

    if (Test-Path $target) {
        Write-Host "[warn] $($r.Dir) exists but is not a git repo. Remove or rename it first." -ForegroundColor Red
        continue
    }

    Write-Host "[clone] $($r.Name) -> $($r.Dir)" -ForegroundColor Green
    git clone $url $target
}

Write-Host ""
Write-Host "Bootstrap complete." -ForegroundColor Green
Write-Host "You can now run:"
Write-Host "  docker-run.bat" -ForegroundColor White
Write-Host "  windows-run.bat" -ForegroundColor White
Write-Host "  server\run.bat" -ForegroundColor White
Write-Host "  web\run.bat" -ForegroundColor White
Write-Host ""
Write-Host "Remember to copy .env.example to .env and configure DATABASE_URL + INTERNAL_TOKEN." -ForegroundColor Yellow
