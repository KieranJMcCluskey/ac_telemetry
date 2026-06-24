# AC Dashboard

A session dashboard and **AI driving coach** for Assetto Corsa. It reads your laps
from Content Manager sessions and captured telemetry — speed, throttle, brake, gear,
sector splits — compares them side by side, and delivers AI coaching that pinpoints
exactly where and how to find time.

## Install (Windows)

No need to clone this repo. Either:

**Option A — one-click:** download the installer and double-click it:
👉 [**Download Installer**](https://www.sugarollymountain.com/downloads/ac-telemetry/Install-ACDashboard.bat)

**Option B — one line:** paste this into PowerShell:

```powershell
irm https://www.sugarollymountain.com/downloads/ac-telemetry/install.ps1 | iex
```

The installer:
- Installs **Node.js** automatically (via winget) if you don't have it
- Downloads the latest app and installs it to `%LOCALAPPDATA%\ACDashboard`
- **Installs the in-game capture plugin** into Assetto Corsa (found via Steam) so your
  laps are recorded for coaching
- Creates **Desktop** and **Start Menu** shortcuts
- Preserves your settings when you re-run it to update

> **Close Assetto Corsa before installing** (the plugin install needs it closed). After
> installing, open AC → enable **Python apps** in settings → add the **AcDashboard** widget
> to your HUD. Completed laps are saved to `Documents\AC Dashboard\captured`.

Then launch **AC Dashboard** from your desktop — your browser opens at
`http://localhost:3000`.

## AI coaching

Open **⚙ Settings → 🎟 Coaching Tokens**, sign in (or create an account), and buy a
token pack — you only need an email and password. Each coaching report uses one token.
Coaching analyses your **captured laps**, so drive a few laps with the plugin active first.

Prefer your own Anthropic key instead? Use **⚙ Settings → 🔑 API Key (BYOK)** and the
app calls Claude directly with your key.

## Manual / developer setup

If you'd rather run from source:

```bash
git clone https://github.com/KieranJMcCluskey/ac_telemetry
cd ac_telemetry/ac-dashboard/ac-dashboard
node server.js
```

Then open `http://localhost:3000`. The server uses only Node built-ins — no
`npm install` required. See [`ac-dashboard/ac-dashboard/README.md`](ac-dashboard/ac-dashboard/README.md)
for paths and environment overrides (`SESSIONS_PATH`, `PORT`, etc.).

## Backend

The token/coaching backend (Netlify Functions + Supabase + Stripe + Anthropic) lives
in [`backend/`](backend/). Setup and operational notes are in
[`STATUS.md`](STATUS.md).
