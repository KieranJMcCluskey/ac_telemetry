#Requires -Version 5.1
<#
.SYNOPSIS
    AC Dashboard web installer for Windows.
.DESCRIPTION
    Downloads the latest AC Dashboard straight from GitHub, installs Node.js if
    missing, installs the app to %LOCALAPPDATA%\ACDashboard, points it at the
    hosted coaching backend, and creates desktop + Start Menu shortcuts.

    No repo download or manual editing required. Run it with:

      irm https://www.sugarollymountain.com/downloads/ac-telemetry/install.ps1 | iex

    Canonical source: github.com/KieranJMcCluskey/ac_telemetry (install.ps1).
    The copy served from sugarollymountain is kept in sync with this file.
#>

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12  # GitHub requires TLS 1.2+

$AppName    = 'AC Dashboard'
$InstallDir = Join-Path $env:LOCALAPPDATA 'ACDashboard'
$Repo       = 'KieranJMcCluskey/ac_telemetry'
$Ref        = 'main'                                   # branch or tag to install
$ZipUrl     = "https://github.com/$Repo/archive/refs/heads/$Ref.zip"
$BackendUrl = 'https://accoach.netlify.app'

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
        Write-Host "  Please install it manually from https://nodejs.org then re-run this installer." -ForegroundColor Red
        Write-Host ""
        Read-Host "  Press Enter to exit"
        exit 1
    }
} else {
    Write-Host "  Node.js $nodeVer found." -ForegroundColor Green
}

# ── 2. Download the latest app from GitHub ──────────────────────────────────
$tmp = Join-Path $env:TEMP ("acdash_" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
    $zip = Join-Path $tmp 'app.zip'
    Write-Host "  Downloading AC Dashboard ($Ref)…" -ForegroundColor Cyan
    Invoke-WebRequest -Uri $ZipUrl -OutFile $zip -UseBasicParsing
    Expand-Archive -Path $zip -DestinationPath $tmp -Force

    # GitHub archives extract to <repo>-<ref>\ ; the app lives two levels in.
    $extractedRoot = Get-ChildItem $tmp -Directory |
        Where-Object { $_.Name -like 'ac_telemetry-*' } | Select-Object -First 1
    if (-not $extractedRoot) { throw 'Could not find extracted archive folder.' }
    $AppSrc = Join-Path $extractedRoot.FullName 'ac-dashboard\ac-dashboard'
    if (-not (Test-Path (Join-Path $AppSrc 'server.js'))) {
        throw "App files not found in download (expected $AppSrc\server.js)."
    }

    # ── 3. Install (preserving existing config.json) ────────────────────────
    Write-Host "  Installing to: $InstallDir" -ForegroundColor Cyan
    $backupConfig = $null
    if (Test-Path $InstallDir) {
        Write-Host "  Updating existing installation…" -ForegroundColor DarkGray
        $existingConfig = Join-Path $InstallDir 'config.json'
        if (Test-Path $existingConfig) { $backupConfig = Get-Content $existingConfig -Raw }
        Remove-Item $InstallDir -Recurse -Force
    }
    Copy-Item $AppSrc $InstallDir -Recurse -Force

    # config.json: restore the user's if we had one, else seed token mode at the backend
    $cfgPath = Join-Path $InstallDir 'config.json'
    if ($backupConfig) {
        Set-Content $cfgPath $backupConfig -Encoding UTF8
        Write-Host "  Preserved existing config.json." -ForegroundColor DarkGray
    } else {
        $seed = [ordered]@{
            mode       = 'token'
            apiKey     = ''
            backendUrl = $BackendUrl
            account    = [ordered]@{ email = ''; accessToken = ''; refreshToken = '' }
        } | ConvertTo-Json -Depth 5
        Set-Content $cfgPath $seed -Encoding UTF8
    }
}
finally {
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

# ── 4. Create launcher batch file ────────────────────────────────────────────
$launcherPath = Join-Path $InstallDir 'Start-ACDashboard.bat'
$launcherContent = @"
@echo off
title AC Dashboard
cd /d "%~dp0"
echo.
echo   Starting AC Dashboard...
echo   Open your browser at http://localhost:3000
echo.
start "" http://localhost:3000
node server.js
pause
"@
Set-Content $launcherPath $launcherContent -Encoding ASCII

# ── 5. Create desktop + Start Menu shortcuts ────────────────────────────────
$wsh      = New-Object -ComObject WScript.Shell
$nodePath = (Get-Command node -ErrorAction SilentlyContinue)?.Source

function New-AppShortcut($path) {
    $link = $wsh.CreateShortcut($path)
    $link.TargetPath       = $launcherPath
    $link.WorkingDirectory = $InstallDir
    $link.Description      = 'AC Session Dashboard with AI Coaching'
    if ($nodePath) { $link.IconLocation = "$nodePath,0" }
    $link.Save()
}

$desktopPath = [System.Environment]::GetFolderPath('Desktop')
New-AppShortcut (Join-Path $desktopPath "$AppName.lnk")
Write-Host "  Desktop shortcut created." -ForegroundColor Green

$startMenuDir = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
New-AppShortcut (Join-Path $startMenuDir "$AppName.lnk")
Write-Host "  Start Menu entry created." -ForegroundColor Green

# ── 6. Done ──────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ══════════════════════════════════════════" -ForegroundColor DarkGray
Write-Host "    Installation complete!" -ForegroundColor Green
Write-Host ""
Write-Host "    • Double-click '$AppName' on your desktop to launch" -ForegroundColor White
Write-Host "    • Your browser opens at http://localhost:3000" -ForegroundColor White
Write-Host "    • Click ⚙ (top-right) → Coaching Tokens → Sign In to start coaching" -ForegroundColor White
Write-Host "  ══════════════════════════════════════════" -ForegroundColor DarkGray
Write-Host ""

$launch = Read-Host "  Launch AC Dashboard now? (Y/n)"
if ($launch -ne 'n' -and $launch -ne 'N') {
    Start-Process $launcherPath
}
