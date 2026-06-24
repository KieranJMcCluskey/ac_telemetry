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

# ── Locate Assetto Corsa (Steam-aware; libraries can be on any drive) ────────
function Find-AssettoCorsa {
    $candidates = @()
    $steam = $null
    try { $steam = (Get-ItemProperty 'HKCU:\Software\Valve\Steam' -ErrorAction SilentlyContinue).SteamPath } catch {}
    if (-not $steam) {
        try { $steam = (Get-ItemProperty 'HKLM:\SOFTWARE\WOW6432Node\Valve\Steam' -ErrorAction SilentlyContinue).InstallPath } catch {}
    }
    if ($steam) {
        $steam = $steam -replace '/', '\'
        $candidates += (Join-Path $steam 'steamapps\common\assettocorsa')
        $vdf = Join-Path $steam 'steamapps\libraryfolders.vdf'
        if (Test-Path $vdf) {
            foreach ($m in [regex]::Matches((Get-Content $vdf -Raw), '"path"\s+"([^"]+)"')) {
                $lib = $m.Groups[1].Value -replace '\\\\', '\'
                $candidates += (Join-Path $lib 'steamapps\common\assettocorsa')
            }
        }
    }
    $candidates += 'C:\Program Files (x86)\Steam\steamapps\common\assettocorsa'
    foreach ($c in $candidates) {
        if (Test-Path (Join-Path $c 'apps\python')) { return $c }
    }
    return $null
}
$PluginInstalled = $false

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

    # ── 3b. Install the AC telemetry plugin (captures laps for the coach) ────
    try {
        $acRoot = Find-AssettoCorsa
        $pluginSrc = Join-Path $extractedRoot.FullName 'ac-plugin\AcDashboard'
        if ($acRoot -and (Test-Path (Join-Path $pluginSrc 'AcDashboard.py'))) {
            $pluginDst = Join-Path $acRoot 'apps\python\AcDashboard'
            New-Item -ItemType Directory -Force -Path $pluginDst | Out-Null
            Copy-Item (Join-Path $pluginSrc '*') $pluginDst -Recurse -Force
            Write-Host "  AC plugin installed: $pluginDst" -ForegroundColor Green

            # Activate it in python.ini (line-by-line, non-destructive to other apps)
            $iniPath = Join-Path $env:USERPROFILE 'Documents\Assetto Corsa\cfg\python.ini'
            $iniDir  = Split-Path $iniPath
            if (-not (Test-Path $iniDir)) { New-Item -ItemType Directory -Force -Path $iniDir | Out-Null }

            $lines = if (Test-Path $iniPath) { @(Get-Content $iniPath) } else { @() }
            $out = New-Object System.Collections.Generic.List[string]
            $inSection = $false; $activeSet = $false; $sectionSeen = $false
            foreach ($line in $lines) {
                if ($line -match '^\s*\[(.+?)\]\s*$') {
                    if ($inSection -and -not $activeSet) { $out.Add('ACTIVE=1'); $activeSet = $true }
                    $inSection = ($Matches[1] -ieq 'ACDASHBOARD')
                    if ($inSection) { $sectionSeen = $true }
                    $out.Add($line); continue
                }
                if ($inSection -and $line -match '^\s*ACTIVE\s*=') { $out.Add('ACTIVE=1'); $activeSet = $true; continue }
                $out.Add($line)
            }
            if ($inSection -and -not $activeSet) { $out.Add('ACTIVE=1') }
            if (-not $sectionSeen) { $out.Add('[ACDASHBOARD]'); $out.Add('ACTIVE=1') }
            # Write without a BOM — a BOM on line 1 breaks AC's parsing of the first app.
            [System.IO.File]::WriteAllLines($iniPath, $out)
            Write-Host "  Plugin activated in python.ini." -ForegroundColor Green
            $PluginInstalled = $true
        } elseif (-not $acRoot) {
            Write-Host "  Assetto Corsa not found — skipped the plugin (dashboard still works)." -ForegroundColor Yellow
        }
    } catch {
        Write-Host "  Could not install the AC plugin automatically: $($_.Exception.Message)" -ForegroundColor Yellow
        Write-Host "  Dashboard still works; close AC and re-run, or see the README for manual steps." -ForegroundColor DarkGray
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
$nodeCmd  = Get-Command node -ErrorAction SilentlyContinue
$nodePath = if ($nodeCmd) { $nodeCmd.Source } else { $null }

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
if ($PluginInstalled) {
    Write-Host ""
    Write-Host "    AC telemetry plugin installed. In Assetto Corsa:" -ForegroundColor White
    Write-Host "    • Settings → enable Python apps, then add 'AcDashboard' to your HUD" -ForegroundColor White
    Write-Host "    • Drive laps — completed laps are captured automatically for coaching" -ForegroundColor White
    Write-Host "    (Restart AC if it was open during install.)" -ForegroundColor DarkGray
} else {
    Write-Host ""
    Write-Host "    NOTE: the AC capture plugin was not installed, so AI coaching has no" -ForegroundColor Yellow
    Write-Host "    lap data yet. Close Assetto Corsa and re-run this installer to add it." -ForegroundColor Yellow
}
Write-Host "  ══════════════════════════════════════════" -ForegroundColor DarkGray
Write-Host ""

$launch = Read-Host "  Launch AC Dashboard now? (Y/n)"
if ($launch -ne 'n' -and $launch -ne 'N') {
    Start-Process $launcherPath
}
