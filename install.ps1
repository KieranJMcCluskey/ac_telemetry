#Requires -Version 5.1
<#
.SYNOPSIS
    AC Dashboard installer for Windows
.DESCRIPTION
    Installs the AC Dashboard app to AppData\Local\ACDashboard,
    creates a desktop shortcut, and optionally adds it to the Start Menu.
#>

$ErrorActionPreference = 'Stop'
$AppName    = 'AC Dashboard'
$InstallDir = Join-Path $env:LOCALAPPDATA 'ACDashboard'
$AppSrc     = Join-Path $PSScriptRoot 'ac-dashboard\ac-dashboard'

Write-Host ""
Write-Host "  ══════════════════════════════════════════" -ForegroundColor DarkGray
Write-Host "    AC Dashboard  —  Installer" -ForegroundColor White
Write-Host "  ══════════════════════════════════════════" -ForegroundColor DarkGray
Write-Host ""

# ── 1. Check / install Node.js ──────────────────────────────────────────────
function Get-NodeVersion {
    try { (& node --version 2>$null) -replace 'v','' } catch { $null }
}

$nodeVer = Get-NodeVersion
if (-not $nodeVer) {
    Write-Host "  Node.js not found. Installing via winget…" -ForegroundColor Yellow
    try {
        winget install --id OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements
        $env:PATH = [System.Environment]::GetEnvironmentVariable('PATH','Machine') + ';' +
                    [System.Environment]::GetEnvironmentVariable('PATH','User')
        $nodeVer = Get-NodeVersion
        if (-not $nodeVer) { throw 'node still not found after install' }
        Write-Host "  Node.js $nodeVer installed." -ForegroundColor Green
    } catch {
        Write-Host ""
        Write-Host "  Could not install Node.js automatically." -ForegroundColor Red
        Write-Host "  Please install it manually from https://nodejs.org then re-run this script." -ForegroundColor Red
        Write-Host ""
        Read-Host "  Press Enter to exit"
        exit 1
    }
} else {
    Write-Host "  Node.js $nodeVer found." -ForegroundColor Green
}

# ── 2. Copy app files ────────────────────────────────────────────────────────
Write-Host "  Installing to: $InstallDir" -ForegroundColor Cyan

if (-not (Test-Path $AppSrc)) {
    Write-Host ""
    Write-Host "  ERROR: Source folder not found: $AppSrc" -ForegroundColor Red
    Write-Host "  Run install.ps1 from the project root directory." -ForegroundColor Red
    Read-Host "  Press Enter to exit"
    exit 1
}

if (Test-Path $InstallDir) {
    Write-Host "  Updating existing installation…" -ForegroundColor DarkGray
    # Preserve user's config.json if it exists
    $existingConfig = Join-Path $InstallDir 'config.json'
    $backupConfig   = $null
    if (Test-Path $existingConfig) {
        $backupConfig = Get-Content $existingConfig -Raw
    }
    Remove-Item $InstallDir -Recurse -Force
}

Copy-Item $AppSrc $InstallDir -Recurse -Force

# Restore config.json if we had one
if ($backupConfig) {
    Set-Content (Join-Path $InstallDir 'config.json') $backupConfig -Encoding UTF8
    Write-Host "  Preserved existing config.json." -ForegroundColor DarkGray
} elseif (Test-Path (Join-Path $InstallDir 'config.default.json')) {
    Copy-Item (Join-Path $InstallDir 'config.default.json') (Join-Path $InstallDir 'config.json')
}

# ── 3. Create launcher batch file ────────────────────────────────────────────
$launcherPath = Join-Path $InstallDir 'Start-ACDashboard.bat'
$launcherContent = @"
@echo off
title AC Dashboard
cd /d "%~dp0"
echo.
echo   Starting AC Dashboard...
echo   Open your browser at http://localhost:3000
echo.
node server.js
pause
"@
Set-Content $launcherPath $launcherContent -Encoding ASCII

# ── 4. Create desktop shortcut ───────────────────────────────────────────────
$desktopPath  = [System.Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktopPath "$AppName.lnk"

$wsh  = New-Object -ComObject WScript.Shell
$link = $wsh.CreateShortcut($shortcutPath)
$link.TargetPath       = $launcherPath
$link.WorkingDirectory = $InstallDir
$link.Description      = 'AC Session Dashboard with AI Coaching'
# Use node.exe icon as fallback
$nodePath = (Get-Command node -ErrorAction SilentlyContinue)?.Source
if ($nodePath) { $link.IconLocation = "$nodePath,0" }
$link.Save()

Write-Host "  Desktop shortcut created." -ForegroundColor Green

# ── 5. Start Menu entry ──────────────────────────────────────────────────────
$startMenuDir = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
$startShortcut = Join-Path $startMenuDir "$AppName.lnk"
$link2 = $wsh.CreateShortcut($startShortcut)
$link2.TargetPath       = $launcherPath
$link2.WorkingDirectory = $InstallDir
$link2.Description      = 'AC Session Dashboard with AI Coaching'
if ($nodePath) { $link2.IconLocation = "$nodePath,0" }
$link2.Save()

Write-Host "  Start Menu entry created." -ForegroundColor Green

# ── 6. Done ──────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ══════════════════════════════════════════" -ForegroundColor DarkGray
Write-Host "    Installation complete!" -ForegroundColor Green
Write-Host ""
Write-Host "    • Double-click '$AppName' on your desktop to launch" -ForegroundColor White
Write-Host "    • Then open http://localhost:3000 in your browser" -ForegroundColor White
Write-Host "    • Click ⚙ in the top-right to configure your API key" -ForegroundColor White
Write-Host "  ══════════════════════════════════════════" -ForegroundColor DarkGray
Write-Host ""

$launch = Read-Host "  Launch AC Dashboard now? (Y/n)"
if ($launch -ne 'n' -and $launch -ne 'N') {
    Start-Process $launcherPath
    Start-Sleep 2
    Start-Process 'http://localhost:3000'
}
