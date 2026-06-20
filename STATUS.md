# AC Dashboard — Session Status

## What This Project Is
A Node.js + HTML telemetry dashboard for Assetto Corsa. Goal: show drivers **where and how to improve** by comparing laps side-by-side. Runs at `http://localhost:3000`.

---

## Two File Locations — Important

| Location | Purpose |
|---|---|
| `C:\Users\Kieran\Projects\Assetto Corsa Dashboard\` | Source / development copy |
| `C:\Users\Kieran\Documents\Assetto Corsa Dashboard\` | Live copy — what the PS script actually runs |

**When making code changes, edit the Projects copy then copy files across to Documents before restarting the server.** The Desktop shortcut (`Start-ACDashboard.ps1`) always runs from Documents.

Copy command (run in PowerShell):
```powershell
$src = "C:\Users\Kieran\Projects\Assetto Corsa Dashboard\ac-dashboard\ac-dashboard"
$dst = "C:\Users\Kieran\Documents\Assetto Corsa Dashboard\ac-dashboard\ac-dashboard"
Copy-Item "$src\server.js" "$dst\server.js" -Force
Copy-Item "$src\public\lap.html" "$dst\public\lap.html" -Force
Copy-Item "$src\public\index.html" "$dst\public\index.html" -Force
```

---

## How to Start the Dashboard

1. Double-click `C:\Users\Kieran\Desktop\Start-ACDashboard.ps1`
2. A PowerShell window opens running `node server.js` — **do not close this window**
3. Edge opens to `http://localhost:3000`
4. Open AC via Content Manager **after** the server window is open

---

## AC Python App (Telemetry Capture)

**File:** `C:\Program Files (x86)\Steam\steamapps\common\assettocorsa\apps\python\AcDashboard\AcDashboard.py`  
**Registered in:** `C:\Users\Kieran\Documents\Assetto Corsa\cfg\python.ini` → `[ACDASHBOARD] ACTIVE=1`

The app runs inside AC, samples telemetry at 10Hz, and POSTs each completed lap to `localhost:3000/api/capture`. Captured laps are saved as JSON to:
```
Documents\Assetto Corsa Dashboard\ac-dashboard\ac-dashboard\captured\<track>\lap<N>_<time>_<timestamp>.json
```

### How to confirm it's working in AC
- Open the AC app tray and add **AcDashboard** to your HUD
- You should see a small red widget: `REC  Lap 0  |  0 pts`
- The point count increases as you drive
- After finishing a lap the count resets — data is being sent to the server
- After closing AC, check `Documents\Assetto Corsa\logs\py_log.txt` — you should see:
  ```
  [AcDashboard] Lap 2 sent — 78541ms 785 pts -> HTTP 200
  ```

---

## Current Status of Each Feature

### ✅ Working
- Session list at `localhost:3000` — shows all Content Manager sessions
- Sector analysis per session — best/avg/worst per sector, theoretical best lap
- "This Lap vs Session Best" panel in lap detail (Analysis tab)
- .tc file telemetry for tracks where the file has valid data (Miami, Suzuka, Losail, Shanghai, Highlands Short, Albert Park ACU all have good data)
- Compare via sector times when no separate telemetry exists
- AC Python app loads and updates REC widget in AC HUD

### ❌ Not Working Yet — Root Cause Known
- **Compare lap charts / braking zone overlay / "Lap N Overview" label** — these all depend on **captured lap files existing**. No captures have been saved yet because every time the user drove laps, the server was not running at the same time.

### ⚠️ Known Data Issue
- `_montreal__.tc` — the data section is all zeros (corrupted). Header is valid (77686ms, 3999 pts) but all speed/throttle/brake/gear bytes are 0x00. This causes "100% coasting" in the analysis. About half the .tc files have this problem. Fix: captured laps from the Python app will replace .tc files for those tracks.

---

## The One Thing Needed to Unlock Everything

**Drive laps with the server window open at the same time as AC.**

Once `captured/montreal/` has at least 2 JSON files:
- The compare lap picker will show full chart overlays (speed, throttle/brake, gear)
- Braking zone comparison table will populate
- "Lap N Overview" label will show correctly (already coded, just needs data)
- Cumulative time delta chart will appear

The server code (`handleCompare`) already checks captured laps first, then .tc files, so this will work automatically.

---

## Key File Paths

| File | Purpose |
|---|---|
| `Documents\Assetto Corsa Dashboard\ac-dashboard\ac-dashboard\server.js` | Node server — sessions, telemetry, compare, capture APIs |
| `Documents\Assetto Corsa Dashboard\ac-dashboard\ac-dashboard\public\index.html` | Session list + sector analysis UI |
| `Documents\Assetto Corsa Dashboard\ac-dashboard\ac-dashboard\public\lap.html` | Lap detail popup — charts + analysis |
| `Documents\Assetto Corsa Dashboard\ac-dashboard\ac-dashboard\captured\` | Per-lap JSON captures (created once first lap is sent) |
| `Documents\Assetto Corsa\ctelemetry\player\*.tc` | AC best-lap binary files |
| `AppData\Local\AcTools Content Manager\Progress\Sessions\*.json` | Session data (lap times, sector splits) |
| `Documents\Assetto Corsa\logs\py_log.txt` | Python app log — check after closing AC |
| `C:\Program Files (x86)\Steam\steamapps\common\assettocorsa\apps\python\AcDashboard\AcDashboard.py` | AC telemetry capture app |

---

## API Endpoints

| Endpoint | Description |
|---|---|
| `GET /api/sessions` | All Content Manager sessions |
| `GET /api/telemetry?track=&lap=&lapTime=&sessionDate=&driver=` | Lap telemetry (checks captured first, then .tc) |
| `GET /api/compare?track=&lapTime1=&lapTime2=&sessionDate=&driver=` | Compare two laps (captured > mixed > .tc > sector fallback) |
| `GET /api/sectors?track=&sessionDate=` | Sector times for a session |
| `POST /api/capture` | Receives lap data from the AC Python app |

---

## Next Session Checklist

1. Start server via Desktop PS script → confirm PowerShell window stays open
2. Open AC via Content Manager
3. Add AcDashboard to HUD — confirm `REC Lap 0 | 0 pts` is visible
4. Drive 3+ laps
5. Close AC
6. Check `py_log.txt` for `Lap X sent → HTTP 200` lines
7. Check `captured/` folder for JSON files
8. Open `localhost:3000`, pick a session, click a lap, use the Compare dropdown
9. Charts, braking zones, and cumulative delta should all appear
