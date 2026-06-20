# Start-ACDashboard.ps1
# Launches the Assetto Corsa Dashboard node server and opens it in Microsoft Edge

$dashboardPath    = Join-Path $PSScriptRoot "ac-dashboard\ac-dashboard"
$publicPath       = "$dashboardPath\public"
$aimPath          = "C:\Users\Kieran\Documents\Assetto Corsa\aim"
$archivePath      = "$aimPath\archive"
$ctelemetryPath   = "C:\Users\Kieran\Documents\Assetto Corsa\ctelemetry"
$chartJsPath      = "$publicPath\chart.umd.js"
$chartJsUrl       = "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js"
$url              = "http://localhost:3000"

# ── Archive .act files before each session ────────────────────────────────────
if (-not (Test-Path $archivePath)) {
    New-Item -ItemType Directory -Path $archivePath | Out-Null
    Write-Host "Created archive folder: $archivePath" -ForegroundColor DarkGray
}
$actFiles = Get-ChildItem -Path $aimPath -Filter "*.act" -File -ErrorAction SilentlyContinue
foreach ($actFile in $actFiles) {
    $timestamp   = (Get-Item $actFile.FullName).LastWriteTime.ToString("yyMMdd-HHmmss")
    $baseName    = [System.IO.Path]::GetFileNameWithoutExtension($actFile.Name)
    $archiveName = "${baseName}_${timestamp}.act"
    $archiveDest = Join-Path $archivePath $archiveName
    if (-not (Test-Path $archiveDest)) {
        Copy-Item -Path $actFile.FullName -Destination $archiveDest
        Write-Host "Archived: $($actFile.Name) → $archiveName" -ForegroundColor DarkGray
    }
}

# ── Download Chart.js if not already present ──────────────────────────────────
if (-not (Test-Path $chartJsPath)) {
    Write-Host "Downloading Chart.js (first run only)..." -ForegroundColor Cyan
    try {
        Invoke-WebRequest -Uri $chartJsUrl -OutFile $chartJsPath -UseBasicParsing
        Write-Host "Chart.js saved." -ForegroundColor Green
    } catch {
        Write-Host "Warning: Could not download Chart.js." -ForegroundColor Yellow
    }
} else {
    Write-Host "Chart.js already present." -ForegroundColor DarkGray
}

# ── Launch node server ────────────────────────────────────────────────────────
Write-Host "Starting AC Dashboard server..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    "`$env:AIM_PATH = '$aimPath'; `$env:CTELEMETRY_PATH = '$ctelemetryPath'; Set-Location '$dashboardPath'; node server.js"
)

Start-Sleep -Seconds 2

# ── Open in Edge ──────────────────────────────────────────────────────────────
Write-Host "Opening dashboard in Microsoft Edge..." -ForegroundColor Cyan
Start-Process "msedge.exe" $url
Write-Host "Done! Dashboard running at $url" -ForegroundColor Green
