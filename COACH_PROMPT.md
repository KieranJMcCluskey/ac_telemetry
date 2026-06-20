# Driving Coach — Prompt Design

## Overview
The coach feature calls the Claude API with compressed telemetry + track knowledge and returns
structured, actionable coaching output rendered in a new dashboard tab.

---

## System Prompt

```
You are an expert motorsport driving coach specialising in data-driven lap analysis.
You receive telemetry data captured from Assetto Corsa at 10 Hz and produce precise,
actionable coaching for an amateur driver. You do not give generic advice — every
observation must reference a specific track position (normalised 0.0–1.0), lap number,
or measured value from the data.

Your analysis covers four areas:
1. BRAKING — where the driver brakes, how hard, how long, and whether they are leaving
   time on the table through early or light braking.
2. THROTTLE — when and how smoothly throttle is re-applied after corners; full-throttle
   percentage and where coasting time can be recovered.
3. CONSISTENCY — lap-to-lap variation at each key zone; highlight the single zone with
   the most variation as the priority focus.
4. TRACK-SPECIFIC TIPS — coaching points anchored to the named corners of this circuit.

Output format — respond with valid JSON matching this schema exactly:
{
  "trackSummary": "2–3 sentence overview of the session",
  "bestLap": { "lap": <int>, "timeMs": <int> },
  "theoreticalBestMs": <int>,
  "zones": [
    {
      "name": "<corner or zone name>",
      "position": <float 0–1>,
      "type": "braking | throttle | consistency | track-tip",
      "priority": <int 1–5, 1 = highest>,
      "observation": "<what the data shows, with specific numbers>",
      "instruction": "<single, direct action the driver should take next session>",
      "deltaMs": <estimated milliseconds available — null if unknown>
    }
  ],
  "lapComparison": [
    {
      "lap": <int>,
      "timeMs": <int>,
      "vsbestMs": <int>,
      "strongSector": "<S1|S2|S3 or zone name>",
      "weakSector": "<S1|S2|S3 or zone name>"
    }
  ],
  "topPriority": "<copy of the single most impactful instruction>"
}

Zones should be ordered by priority (1 = most time to gain). Aim for 6–10 zones.
Keep observations factual and grounded in the numbers. Keep instructions short and direct.
```

---

## Track Knowledge Block (inject per track)

For **Circuit Gilles Villeneuve, Montreal** prepend this to the user message:

```
TRACK: Circuit Gilles Villeneuve, Montreal
Length: 4.361 km | Turns: 14 | Character: street circuit, heavy braking, wall-lined

KEY CORNERS (name, normalised position, type, typical gear, speed in → out):
- T1 Pit Entry         pos≈0.02  tight left        3rd   300→120 km/h
- T2 Senna Hairpin     pos≈0.05  180° hairpin       1st   150→77 km/h   [overtaking]
- T3-4 Chicane         pos≈0.12  right-left chicane 3rd   250→150 km/h  [wall right]
- T6-7 Chicane         pos≈0.25  left-right chicane 3rd   220→140 km/h
- T8 Bridge Kink       pos≈0.40  fast kink          6th+  flat
- T9 Wall Corner       pos≈0.45  right-left         4th   [wall outside T9]
- T10 Casino Hairpin   pos≈0.60  180° hairpin       1st   300→50 km/h   [overtaking, hardest braking]
- T13 Final Chicane    pos≈0.85  heavy braking      2nd   340→180 km/h  [hardest braking on calendar]
- T14 Wall of Champs   pos≈0.92  chicane exit       3rd   [world champions crash here]

SECTOR SPLITS (approximate position boundaries):
- S1: 0.00 → 0.33
- S2: 0.33 → 0.67
- S3: 0.67 → 1.00

KEY RISKS: walls at T4 (right), T9 (outside), T14 (left exit). No run-off.
COACHING PRIORITY: T10 hairpin braking + exit traction; T13 braking zone; T14 discipline.
```

---

## User Message (constructed per request)

```
SESSION DATA — {track}, {date}
Car: {car} | Driver: {driver}
Laps driven: {lapCount} | Best lap: {bestLapTime} (Lap {bestLapNum})
Theoretical best (sum of best sectors): {theoreticalBest}

--- LAP SUMMARY ---
{foreach lap:}
Lap {N}: {lapTime} | S1={s1} S2={s2} S3={s3} | vs best: {delta}

--- BRAKING ZONES (from best lap) ---
{foreach zone:}
Zone {N} pos={brakePoint} | entry={speedIn}km/h apex={speedApex}km/h | peak brake={peakBrake}% | duration={duration}s | trail={trailBrake}

--- SPEED TRACE SUMMARY (best lap, sampled at key positions) ---
pos=0.00 spd={v} | pos=0.05 spd={v} | pos=0.10 spd={v} | ... (every 0.05)

--- LAP-TO-LAP BRAKING DELTAS ---
{foreach zone: show best lap vs each other lap's matching zone}
Zone {N} (pos={p}): best={duration}s {foreach other lap: LapX={duration}s Δ={delta}s}

--- THROTTLE STATS (per lap) ---
{foreach lap:}
Lap {N}: full-throttle={pct}% | coasting={pct}% | avg-speed={v}km/h | top-speed={v}km/h

Analyse this data and return the JSON coaching report.
```

---

## Data Preparation Notes

The raw 10Hz point arrays are too large to send directly. Before calling the API:

1. **Speed trace** — downsample to one reading every 0.05 of track position (20 values)
   by finding the point closest to each 0.05 increment in the `position` channel.

2. **Braking zones** — already computed by `analyseLap()` in server.js; send the top 8
   by `speedLoss` (most significant stops).

3. **Sector times** — from Content Manager session JSON (S1/S2/S3 per lap).

4. **Lap-to-lap deltas** — for each braking zone in the best lap, find the matching zone
   in each other lap (by position ±0.05) and compute duration delta.

5. **Throttle stats** — already in `analyseLap().stats` (throttlePct, coastPct, avgSpeed,
   topSpeed).

Typical token count for a 3-lap session: ~800–1200 tokens for the user message.
Use **claude-sonnet-4-6** for speed and cost; upgrade to **claude-opus-4-7** for deeper
analysis if the user opts in.

---

## Recommended API Settings

```javascript
{
  model: "claude-sonnet-4-6",
  max_tokens: 2000,
  system: <system prompt above>,
  messages: [{ role: "user", content: <track block + session data> }]
}
```

Enable **prompt caching** on the system prompt + track block (these are static per track).
Cache the system prompt with `cache_control: { type: "ephemeral" }` to cut repeat costs
by ~90% when a driver reviews the same track multiple times in a session.
