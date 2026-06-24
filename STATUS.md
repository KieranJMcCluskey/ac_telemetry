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

**Source (in repo):** `ac-plugin/AcDashboard/AcDashboard.py` — bundled and **auto-installed by `install.ps1`** (Steam-aware: registry → `libraryfolders.vdf` → `apps\python\AcDashboard`, and `[ACDASHBOARD] ACTIVE=1` added to `python.ini`).
**Installed to:** `<Assetto Corsa>\apps\python\AcDashboard\AcDashboard.py`
**Registered in:** `Documents\Assetto Corsa\cfg\python.ini` → `[ACDASHBOARD] ACTIVE=1`

The app runs inside AC, samples telemetry at 10 Hz, and on each completed lap **writes the lap JSON directly to disk** (no HTTP, no UDP, no running server needed — the old "POSTs to localhost:3000" description and the `SERVER_HOST/PORT` constants are gone). Captured laps are saved to:
```
%USERPROFILE%\Documents\AC Dashboard\captured\<track>\lap<N>_<lapMs>_<ts>_<pts>.json
```
This path **must match** the dashboard server's `CAPTURE_PATH` (server.js), which now defaults to the same folder (env-overridable via `CAPTURE_PATH`). It lives **outside** the install dir so captures survive app updates.

### How to confirm it's working in AC
- In AC settings, **enable Python apps**, then add **AcDashboard** to your HUD
- You should see a small red widget: `REC  Lap 0  |  0 pts`
- The point count increases as you drive; it resets after each completed lap (lap saved)
- Check the debug log at `Documents\Assetto Corsa\logs\acdashboard_debug.txt`:
  ```
  [AcDashboard] Lap 2 saved — 78541ms 785 pts -> lap2_78541_..._785.json
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
| `Documents\AC Dashboard\captured\` | Per-lap JSON captures — written by the plugin, read by the server (server's `CAPTURE_PATH`; outside the install dir so it survives updates) |
| `Documents\Assetto Corsa\ctelemetry\player\*.tc` | AC best-lap binary files |
| `AppData\Local\AcTools Content Manager\Progress\Sessions\*.json` | Session data (lap times, sector splits) |
| `Documents\Assetto Corsa\logs\acdashboard_debug.txt` | Plugin debug log — check after closing AC |
| `ac-plugin\AcDashboard\AcDashboard.py` (repo) | AC telemetry capture plugin — auto-installed into AC by `install.ps1` |

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

---

## Backend Setup (AI Coaching Tokens)

The `backend/` folder is a **Netlify Functions** app that sells coaching tokens.
The code is complete — setup is purely provisioning external services and env vars.

Deployed function URLs (after deploy):
`https://<your-site>.netlify.app/.netlify/functions/{auth,checkout,webhook,tokens,coach}`

| Function | Job |
|---|---|
| `auth.js` | Register/login via Supabase email+password → returns access token |
| `checkout.js` | Creates a Stripe Checkout session for a 10- or 100-token pack |
| `webhook.js` | Stripe → credits tokens (idempotent on `checkout.session.completed`) |
| `tokens.js` | Returns the user's current balance |
| `coach.js` | Checks balance → calls Claude (`claude-sonnet-4-6`) → deducts 1 token |

### 1. Supabase
1. New project → **Settings → API**: copy Project URL (`SUPABASE_URL`),
   `anon public` key (`SUPABASE_ANON_KEY`), `service_role` key (`SUPABASE_SERVICE_KEY` — server only).
2. **SQL Editor** → run `backend/supabase/schema.sql` (tables + atomic
   `deduct_token` / `credit_tokens` functions).
3. **Authentication → Providers → Email**: enable. Decide on "Confirm email"
   (if ON, users must verify before login/buy). Set **Site URL** to the Netlify URL.

### 2. Anthropic
- **API Keys → Create Key** → `ANTHROPIC_API_KEY`. Ensure workspace has billing/credit.

### 3. Stripe (live mode)
1. **Products** → create two one-time prices:
   - "10 Coaching Tokens" → Price ID → `STRIPE_PRICE_10`
   - "100 Coaching Tokens" → Price ID → `STRIPE_PRICE_100`
2. **Developers → API keys** → Secret key (`sk_live_...`) → `STRIPE_SECRET_KEY`
3. **Developers → Webhooks → Add endpoint** (do this *after* first deploy, once the URL exists):
   - URL: `https://<your-site>.netlify.app/.netlify/functions/webhook`
   - Event: **`checkout.session.completed`** only
   - Signing secret (`whsec_...`) → `STRIPE_WEBHOOK_SECRET`, then redeploy.

### 4. Netlify env vars (Site settings → Environment variables)
```
SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY,
ANTHROPIC_API_KEY,
STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_10, STRIPE_PRICE_100,
SITE_URL            ← https://<your-site>.netlify.app  (Stripe success/cancel redirects)
```
Upstash Redis pair (`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`) is optional —
without it, rate limiting is silently skipped.

### 5. Deploy
`backend/netlify.toml` sets `functions = "netlify/functions"`, `publish = "public"`.
Point Netlify's **base directory at `backend/`**, or CLI from `backend/`:
```
netlify deploy --prod
```
Then finish Stripe step 3 (webhook URL + secret) and redeploy.

### 6. Smoke test (live)
```bash
# register
curl -sX POST https://<site>/.netlify/functions/auth \
  -H 'content-type: application/json' \
  -d '{"action":"register","email":"you@x.com","password":"..."}'
# login (action:"login") → grab accessToken
# balance (should be 0)
curl -s https://<site>/.netlify/functions/tokens -H "authorization: Bearer <accessToken>"
```
Buy a 10-pack via checkout → Stripe webhook shows 200 → balance becomes 10 →
a `/coach` call decrements to 9.

### 7. Point the dashboard at the backend
Set coach mode to **`token`** (valid values are `byok | token`). The live config file
the server reads is **`config.json`** (NOT `config.default.json`) at
`ac-dashboard/ac-dashboard/config.json`. Prefer the dashboard's **⚙ Settings UI** —
logging in there stores the `accessToken` automatically. Resulting config:
```json
{
  "mode": "token",
  "backendUrl": "https://accoach.netlify.app",
  "account": { "email": "...", "accessToken": "...", "refreshToken": "..." }
}
```
Notes:
- Token mode requires **both** `backendUrl` and a logged-in `account.accessToken`.
- The dashboard calls the backend over **HTTPS only** (`https.request`), so token mode
  cannot point at a local `http://localhost` backend — test it against the live Netlify URL.
- A `402` from the backend is surfaced as `insufficient_tokens` (out-of-tokens prompt).

### Status — ✅ COMPLETE & LIVE (2026-06-24)

Deployed at **https://accoach.netlify.app** (Netlify site `accoach`, CI/CD auto-deploys
from GitHub `main`, base directory `backend`). All five functions verified live:

| Function | Verified |
|---|---|
| `auth` (register/login) | ✅ register 200 → instant login (email confirmation off) |
| `tokens` (balance) | ✅ returns balance |
| `checkout` (Stripe session) | ✅ creates live `cs_live_` Checkout URL |
| `webhook` (credit on payment) | ✅ real purchase credited balance 0 → 10 |
| `coach` (Claude + deduct) | ✅ live Claude report returned, balance 10 → 9 |
| dashboard token mode | ✅ `/api/tokens/balance` proxied live balance from backend |

Setup notes for future reference:
- **Runtime gotcha:** Netlify runs these functions on **Node 20** regardless of
  `NODE_VERSION` / `AWS_LAMBDA_JS_RUNTIME` in `netlify.toml`. `@supabase/supabase-js`'s
  `createClient` builds a realtime client needing a global `WebSocket`, so we polyfill it
  via `ws` in `functions/_shared/ws-polyfill.js` (required by both `_shared/supabase.js`
  and `auth.js`). Don't remove it.
- **Stripe account is shared with the `who-am-i` app.** ac-coach checkouts are tagged
  `metadata.app='ac-coach'`; the webhook ack-ignores (200) any event without it.
  who-am-i's webhook likewise 200-ignores ac-coach's events. Both confirmed.
- **Supabase Auth:** Email provider enabled, email **confirmation disabled** (instant login).

Remaining (non-blocking): configure the dashboard on the gaming PC via the ⚙ Settings UI
with a real account; refund the $5 live test purchase in Stripe.

---

## Installer / Distribution — ✅ LIVE (2026-06-24)

End users install via a hosted web installer — no repo download, no manual script edits.

**Entry points** (served from the marketing site, `www.sugarollymountain.com`):
- One-click: `https://www.sugarollymountain.com/downloads/ac-telemetry/Install-ACDashboard.bat`
  (double-click `.bat` → runs PowerShell with `-ExecutionPolicy Bypass`)
- One-line: `irm https://www.sugarollymountain.com/downloads/ac-telemetry/install.ps1 | iex`

Both URLs verified HTTP 200 live.

**What `install.ps1` does:**
1. Installs Node.js via `winget` (OpenJS.NodeJS.LTS) if missing.
2. Downloads the latest app from `github.com/KieranJMcCluskey/ac_telemetry/archive/refs/heads/main.zip`
   (the `$Ref` variable — switch to a tag to pin a version).
3. Installs to `%LOCALAPPDATA%\ACDashboard`, preserving an existing `config.json` on update;
   on a fresh install it seeds `config.json` to token mode pointing at `accoach.netlify.app`.
4. **Installs the AC capture plugin** — finds Assetto Corsa via Steam, copies
   `ac-plugin\AcDashboard` into `apps\python\AcDashboard`, and activates `[ACDASHBOARD]`
   in `python.ini` (non-destructive, BOM-free). Skips gracefully if AC isn't found.
5. Creates a `Start-ACDashboard.bat` launcher + Desktop and Start Menu shortcuts.

> AC must be **closed** during install (file locks). After install, the user still has to
> enable Python apps in AC and add the AcDashboard widget to their HUD (can't be automated).

**Where the files live:**
| File | Repo / path | Purpose |
|---|---|---|
| `install.ps1` | `ac_telemetry/install.ps1` | Canonical source (lives with the app) |
| `install.ps1` | `sugarollymountain/downloads/ac-telemetry/install.ps1` | **Served copy** — re-copy from canonical if it changes |
| `Install-ACDashboard.bat` | `sugarollymountain/downloads/ac-telemetry/` | Double-click bootstrapper |
| AC Telemetry card | `sugarollymountain/apps.html` | Download link swapped from GitHub → installer; copy updated to "Windows App" |

**Notes:**
- The two `install.ps1` copies are kept in sync manually — editing the canonical one means
  re-copying to the sugarollymountain repo and redeploying that site.
- **`install.ps1` must stay Windows PowerShell 5.1 compatible** — end users run stock 5.1, not
  PS7. No `?.` / `??` / ternary / `&&` / `||` (7+ only; they're parse errors that abort the
  whole script). A `?.Source` slipped through once and broke every Windows install.
- `install.ps1` sets TLS 1.2 explicitly (Windows PowerShell 5.1 needs it for GitHub).
- The served installer URL only works after the `sugarollymountain` site redeploys; the app
  download works anytime (public repo).
- **Token UI:** the dashboard's Coaching Tokens settings no longer show a "Backend URL" field —
  the URL is baked in (`DEFAULT_BACKEND_URL` in index.html) and seeded by the installer. Users
  only enter email + password.

Remaining: run the one-liner once on the gaming PC (AC closed) to confirm the Windows install +
plugin install + capture → coaching end-to-end (can't be tested from macOS).

---

## Coaching Knowledge — Tracks & Car Classes

The coach message (`buildCoachMessage` + the assembly in `handleCoach`, server.js) is built
**once** and sent in both BYOK and token modes, so all knowledge lives in `userContent` —
**no system-prompt change** (which would have to be duplicated in `server.js` and the backend
`prompt.js`).

### Track knowledge
- Files: `ac-dashboard/ac-dashboard/trackKnowledge/*.txt` (one per track; ~20 lines — corners
  with normalised positions/gears/speeds, sector splits, risks, priorities).
- Lookup: `getTrackKnowledge(track)` does `slug.includes(key)` — keys are **short distinctive
  slugs** (`brands_hatch`, `mugello`, `laguna_seca`, `vallelunga`, `nurburgring`, …) so they
  match whatever prefix/layout the AC track id carries. No file → block omitted, coach still
  runs on telemetry.
- Added (verified against real AC folder ids): Brands Hatch, Mugello, Laguna Seca, Vallelunga,
  Nürburgring, **Nordschleife**, **Highlands**. Zandvoort already existed.
- Nordschleife and Highlands use a **section-based** format (not corner-by-corner): Nordschleife
  has 150+ corners so it's anchored to named sections; Highlands is fictional with no official
  corner names, so it's character/layout-based. Both lean on the telemetry for fine detail.
- **Limitation:** the matcher can't distinguish track **layouts** (Brands Hatch GP/Indy,
  Nürburgring GP/Sprint, Vallelunga Club/Classic/Extended) — one file per track, each noting
  its variants. Splitting per-layout needs the capture/session `track` field to carry the
  layout (unconfirmed). Corner positions/gears/speeds are approximate (car-dependent).

### Car-class knowledge
- Files: `ac-dashboard/ac-dashboard/classKnowledge/*.txt` — `f1, gt3, tcr, supercars_v8, lmp1,
  hypercar, vintage` (class-specific braking/throttle/downforce/common-mistakes notes).
- `detectCarClass(carId, cfg)` (server.js): checks `config.classByCar` overrides first
  (`{ "<ac_car_id>": "GT3" }`), then a pattern map over the car id (e.g. `*gt3*`→gt3,
  `rss_formula_*`/`tatuusfa1`→f1, `*tcr*`→tcr, `*hypercar/lmh/lmdh/gtp*`→hypercar,
  `*supercar/v8/holden/falcon*`→supercars_v8, `*classic/vintage/historic*`→vintage).
- Unmatched cars → the message tells the model to infer the class from the car id and adapt.
- Injected into `userContent` as a "DRIVER'S CAR CLASS" block before the telemetry summary.

Both sets ship to users via the installer's GitHub pull (next install/update).
