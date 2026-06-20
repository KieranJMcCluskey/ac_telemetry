const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const SESSIONS_PATH = process.env.SESSIONS_PATH ||
  path.join(process.env.USERPROFILE || process.env.HOME, 'AppData', 'Local',
    'AcTools Content Manager', 'Progress', 'Sessions');

const AIM_PATH = process.env.AIM_PATH ||
  path.join(process.env.USERPROFILE || process.env.HOME, 'Documents', 'Assetto Corsa', 'aim');

const CTELEMETRY_PATH = process.env.CTELEMETRY_PATH ||
  path.join(process.env.USERPROFILE || process.env.HOME, 'Documents', 'Assetto Corsa', 'ctelemetry');

const PORT = process.env.PORT || 3000;
const CAPTURE_PATH = path.join(__dirname, 'captured');
const CONFIG_PATH = path.join(__dirname, 'config.json');
const bus = new EventEmitter();

// ─── CONFIG ───────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG = {
  mode: 'byok',          // 'byok' | 'token'
  apiKey: '',            // for byok mode
  backendUrl: '',        // Netlify backend URL, e.g. https://ac-coach.netlify.app
  account: { email: '', accessToken: '', refreshToken: '' },
};

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) };
    }
  } catch {}
  return { ...DEFAULT_CONFIG };
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

// ─── SESSION PARSING ──────────────────────────────────────────────────────────

function parseSession(filePath) {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const filename = path.basename(filePath, '.json');

    let date = null;
    const m = filename.match(/^(\d{2})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/);
    if (m) {
      date = new Date(`20${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`);
    }

    const player = raw.players?.[0] || {};
    const sessions = (raw.sessions || []).map(s => {
      const playerLaps = (s.laps || []).filter(l => l.car === 0);
      const validLaps = playerLaps.filter(l => l.lap >= 0 && l.time > 0 && l.sectors?.[0] < 300000);
      const bestLapEntry = s.bestLaps?.find(b => b.car === 0);
      return {
        name: s.name,
        type: s.type,
        lapsCount: (s.lapstotal?.[0]) || 0,
        laps: playerLaps,
        validLaps,
        bestLap: bestLapEntry?.time || null,
        raceResult: s.raceResult || null,
        allDriverLaps: s.laps || [],
        bestLaps: s.bestLaps || [],
      };
    });

    let quickDrive = {};
    try { quickDrive = JSON.parse(raw.__quickDrive || '{}'); } catch {}

    return {
      filename,
      date: date ? date.toISOString() : null,
      track: raw.track,
      car: player.car || quickDrive.CarId || '',
      skin: player.skin || '',
      driver: player.name || 'Unknown',
      players: raw.players || [],
      sessions,
      extras: raw.extras || [],
    };
  } catch (e) {
    return null;
  }
}

function loadAllSessions() {
  if (!fs.existsSync(SESSIONS_PATH)) return [];
  return fs.readdirSync(SESSIONS_PATH)
    .filter(f => f.endsWith('.json'))
    .map(f => parseSession(path.join(SESSIONS_PATH, f)))
    .filter(Boolean)
    .sort((a, b) => (a.date || '') < (b.date || '') ? 1 : -1);
}

// ─── AIM TELEMETRY PARSER ─────────────────────────────────────────────────────

// ─── TC TELEMETRY PARSER ──────────────────────────────────────────────────────

function readString(buf, offset) {
  const len = buf.readInt32LE(offset);
  offset += 4;
  const str = len > 0 ? buf.toString('utf8', offset, offset + len) : '';
  return { value: str, nextOffset: offset + len };
}

function parseTcFile(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    let offset = 4; // skip unknown header bytes

    const driver   = readString(buf, offset); offset = driver.nextOffset;
    const track    = readString(buf, offset); offset = track.nextOffset;
    const car      = readString(buf, offset); offset = car.nextOffset;
    const variant  = readString(buf, offset); offset = variant.nextOffset;

    const lapTimeMs   = buf.readInt32LE(offset);  offset += 4;
    const numPoints   = buf.readInt32LE(offset);  offset += 4;

    const gear     = new Array(numPoints);
    const position = new Array(numPoints);
    const speed    = new Array(numPoints);
    const throttle = new Array(numPoints);
    const brake    = new Array(numPoints);

    for (let i = 0; i < numPoints; i++) {
      gear[i]     = buf.readInt32LE(offset)      - 1; // offset by 1 per spec
      position[i] = buf.readFloatLE(offset + 4);
      speed[i]    = buf.readFloatLE(offset + 8);
      throttle[i] = buf.readFloatLE(offset + 12);
      brake[i]    = buf.readFloatLE(offset + 16);
      offset += 20;
    }

    return {
      driver:    driver.value,
      track:     track.value,
      car:       car.value,
      variant:   variant.value,
      lapTimeMs,
      numPoints,
      gear, position, speed, throttle, brake,
    };
  } catch (e) {
    return null;
  }
}

// Find .tc files matching a track and lap time, within a session date window.
function findTcFiles(track, lapTimeMs, sessionDate, driver) {
  const trackSlug = (track || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  // Search all driver subfolders in ctelemetry
  const searchDirs = [];
  if (fs.existsSync(CTELEMETRY_PATH)) {
    if (driver) {
      const driverDir = path.join(CTELEMETRY_PATH, driver);
      if (fs.existsSync(driverDir)) searchDirs.push(driverDir);
    }
    try {
      fs.readdirSync(CTELEMETRY_PATH).forEach(name => {
        const dir = path.join(CTELEMETRY_PATH, name);
        if (fs.statSync(dir).isDirectory() && !searchDirs.includes(dir)) searchDirs.push(dir);
      });
    } catch {}
  }

  const candidates = [];
  for (const dir of searchDirs) {
    try {
      fs.readdirSync(dir).filter(f => f.endsWith('.tc')).forEach(f => {
        const filePath = path.join(dir, f);
        const tc = parseTcFile(filePath);
        if (!tc) return;

        const tcSlug = tc.track.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (!tcSlug.includes(trackSlug) && !trackSlug.includes(tcSlug)) return;
        if (Math.abs(tc.lapTimeMs - lapTimeMs) > 2000) return;

        const stat = fs.statSync(filePath);
        candidates.push({ filePath, tc, mtime: stat.mtimeMs });
      });
    } catch {}
  }

  const sessionMs = sessionDate ? new Date(sessionDate).getTime() : null;
  candidates.sort((a, b) => {
    const dtA = Math.abs(a.tc.lapTimeMs - lapTimeMs);
    const dtB = Math.abs(b.tc.lapTimeMs - lapTimeMs);
    if (dtA !== dtB) return dtA - dtB;
    if (sessionMs) return Math.abs(a.mtime - sessionMs) - Math.abs(b.mtime - sessionMs);
    return b.mtime - a.mtime;
  });

  return candidates;
}

function downsample(arr, maxPts) {
  if (!arr || arr.length === 0) return [];
  if (arr.length <= maxPts) return arr;
  const step = arr.length / maxPts;
  return Array.from({ length: maxPts }, (_, i) => arr[Math.floor(i * step)]);
}

// ─── LAP ANALYSIS ─────────────────────────────────────────────────────────────

function analyseLap(tc) {
  const { speed, throttle, brake, gear, position, lapTimeMs, numPoints } = tc;
  const lapDurS = lapTimeMs / 1000;

  const toTime = i => (i / numPoints) * lapDurS;

  const BRAKE_THRESH   = 0.05;
  const MIN_BRAKE_PTS  = 3;

  const brakingZones = [];
  let inBrake = false, zoneStart = 0;

  for (let i = 0; i <= numPoints; i++) {
    const braking = i < numPoints && brake[i] > BRAKE_THRESH;
    if (!inBrake && braking) {
      inBrake = true;
      zoneStart = i;
    } else if (inBrake && !braking) {
      if (i - zoneStart >= MIN_BRAKE_PTS) {
        const zoneSpeed = speed.slice(zoneStart, i);
        const zoneBrake = brake.slice(zoneStart, i);
        const minSpeed  = Math.min(...zoneSpeed);
        const minIdx    = zoneStart + zoneSpeed.indexOf(minSpeed);

        let throttleBack = -1;
        for (let j = minIdx; j < Math.min(i + 30, numPoints); j++) {
          if (throttle[j] > 0.1) { throttleBack = j; break; }
        }

        brakingZones.push({
          index:        brakingZones.length + 1,
          brakePoint:   Math.round(position[zoneStart] * 1000) / 1000,
          apexPos:      Math.round(position[minIdx] * 1000) / 1000,
          speedIn:      Math.round(speed[zoneStart] * 10) / 10,
          speedApex:    Math.round(minSpeed * 10) / 10,
          speedLoss:    Math.round((speed[zoneStart] - minSpeed) * 10) / 10,
          peakBrake:    Math.round(Math.max(...zoneBrake) * 100),
          timeIn:       Math.round(toTime(zoneStart) * 10) / 10,
          timeApex:     Math.round(toTime(minIdx) * 10) / 10,
          duration:     Math.round((toTime(i) - toTime(zoneStart)) * 10) / 10,
          throttleBack: throttleBack >= 0 ? Math.round(position[throttleBack] * 1000) / 1000 : null,
          trailBrake:   zoneSpeed.some((_, k) => throttle[zoneStart + k] > 0.05 && brake[zoneStart + k] > 0.05),
        });
      }
      inBrake = false;
    }
  }

  const THROTTLE_THRESH = 0.95;
  const MIN_STRAIGHT_PTS = 10;
  const straights = [];
  let inStraight = false, stStart = 0;

  for (let i = 0; i <= numPoints; i++) {
    const flat = i < numPoints && throttle[i] > THROTTLE_THRESH;
    if (!inStraight && flat) { inStraight = true; stStart = i; }
    else if (inStraight && !flat) {
      if (i - stStart >= MIN_STRAIGHT_PTS) {
        const stSpeed = speed.slice(stStart, i);
        straights.push({
          index:      straights.length + 1,
          posStart:   Math.round(position[stStart] * 1000) / 1000,
          posEnd:     Math.round(position[i - 1] * 1000) / 1000,
          speedStart: Math.round(speed[stStart] * 10) / 10,
          speedMax:   Math.round(Math.max(...stSpeed) * 10) / 10,
          duration:   Math.round((toTime(i) - toTime(stStart)) * 10) / 10,
          timeStart:  Math.round(toTime(stStart) * 10) / 10,
        });
      }
      inStraight = false;
    }
  }

  const topSpeed       = Math.round(Math.max(...speed) * 10) / 10;
  const avgSpeed       = Math.round(speed.reduce((a, b) => a + b, 0) / numPoints * 10) / 10;
  const throttlePct    = Math.round(throttle.filter(v => v > 0.95).length / numPoints * 100);
  const brakePct       = Math.round(brake.filter(v => v > 0.05).length / numPoints * 100);
  const coastPct       = Math.round(throttle.filter((v, i) => v < 0.05 && brake[i] < 0.05).length / numPoints * 100);
  const maxGear        = Math.max(...gear);

  return {
    brakingZones,
    straights,
    stats: { topSpeed, avgSpeed, throttlePct, brakePct, coastPct, maxGear, numBrakingZones: brakingZones.length },
  };
}

// Compare two lap analyses — match braking zones by track position
function compareLaps(analysisA, analysisB, tcA, tcB) {
  const zonesA = analysisA.brakingZones;
  const zonesB = analysisB.brakingZones;

  const matchedZones = zonesA.map(zA => {
    const best = zonesB.reduce((prev, zB) => {
      const dist = Math.abs(zB.brakePoint - zA.brakePoint);
      return dist < Math.abs((prev?.brakePoint || 999) - zA.brakePoint) ? zB : prev;
    }, null);
    const matched = best && Math.abs(best.brakePoint - zA.brakePoint) < 0.05 ? best : null;
    return {
      zone:       zA.index,
      brakePoint: zA.brakePoint,
      lap1: { speedIn: zA.speedIn, speedApex: zA.speedApex, peakBrake: zA.peakBrake, duration: zA.duration, timeIn: zA.timeIn, trailBrake: zA.trailBrake },
      lap2: matched ? { speedIn: matched.speedIn, speedApex: matched.speedApex, peakBrake: matched.peakBrake, duration: matched.duration, timeIn: matched.timeIn, trailBrake: matched.trailBrake } : null,
      deltaSpeedIn:   matched ? Math.round((zA.speedIn - matched.speedIn) * 10) / 10 : null,
      deltaSpeedApex: matched ? Math.round((zA.speedApex - matched.speedApex) * 10) / 10 : null,
      deltaTime:      matched ? Math.round((zA.timeIn - matched.timeIn) * 10) / 10 : null,
    };
  });

  const DELTA_PTS = 200;
  const deltaTime = [];
  for (let i = 0; i < DELTA_PTS; i++) {
    const pos = i / DELTA_PTS;
    const idxA = tcA.position.reduce((best, p, j) => Math.abs(p - pos) < Math.abs(tcA.position[best] - pos) ? j : best, 0);
    const idxB = tcB.position.reduce((best, p, j) => Math.abs(p - pos) < Math.abs(tcB.position[best] - pos) ? j : best, 0);
    const timeA = (idxA / tcA.numPoints) * (tcA.lapTimeMs / 1000);
    const timeB = (idxB / tcB.numPoints) * (tcB.lapTimeMs / 1000);
    deltaTime.push({
      pos: Math.round(pos * 1000) / 1000,
      delta: Math.round((timeA - timeB) * 1000) / 1000,
    });
  }

  return { matchedZones, deltaTime };
}

function handleTelemetry(url, res) {
  const track      = url.searchParams.get('track')      || '';
  const lapNum     = parseInt(url.searchParams.get('lap') || '0');
  const lapTimeMs  = parseInt(url.searchParams.get('lapTime') || '0');
  const sessionDate = url.searchParams.get('sessionDate') || null;
  const driver     = url.searchParams.get('driver')     || '';

  console.log(`\n📡 Telemetry: track="${track}" lap=${lapNum} lapTime=${lapTimeMs}ms`);

  if (!track || isNaN(lapNum) || lapNum < 0 || !lapTimeMs) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'track, lap, and lapTime params required' }));
    return;
  }

  const captured = findCapturedLap(track, lapTimeMs, lapNum);
  if (captured) {
    console.log(`  Using captured lap ${captured.lap} (${captured.numPoints} pts)`);
    captured.gear = cleanGear(captured.gear);
    const analysis = analyseLap(captured);
    const MAX_PTS = 500;
    const lapDurS = captured.lapTimeMs / 1000;
    const timeAxis = Array.from({ length: Math.min(captured.numPoints, MAX_PTS) }, (_, i) =>
      Math.round(i / Math.min(captured.numPoints, MAX_PTS) * lapDurS * 10) / 10);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      lap: { lap: lapNum, time: captured.lapTimeMs, sectors: [], cuts: 0, tyre: '' },
      beacons: [], sampleRateHz: captured.sampleHz, totalSamples: captured.numPoints,
      lapDurationS: lapDurS, timeAxis, tcFile: `captured_lap${captured.lap}`,
      driver: captured.driver, car: captured.car, analysis,
      position: downsample(captured.position, 500),
      channels: {
        speed:    downsample(captured.speed.map(v => Math.round(v * 10) / 10), MAX_PTS),
        throttle: downsample(captured.throttle.map(v => Math.round(v * 100) / 100), MAX_PTS),
        brake:    downsample(captured.brake.map(v => Math.round(v * 100) / 100), MAX_PTS),
        gear:     downsample(captured.gear, MAX_PTS),
        rpm: null,
      },
    }));
    return;
  }

  const candidates = findTcFiles(track, lapTimeMs, sessionDate, driver);
  console.log(`  Found ${candidates.length} matching .tc file(s)`);

  if (!candidates.length) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: `No .tc telemetry file found for track "${track}" with lap time ${lapTimeMs}ms. ` +
             `Check that ctelemetry files exist in: ${CTELEMETRY_PATH}`,
      ctelemetryPath: CTELEMETRY_PATH,
    }));
    return;
  }

  const { filePath, tc } = candidates[0];
  console.log(`  Using: ${path.basename(filePath)} (${tc.numPoints} points, ${tc.lapTimeMs}ms)`);

  const MAX_PTS = 500;
  const lapDurationS = tc.lapTimeMs / 1000;
  const timeAxis = Array.from({ length: Math.min(tc.numPoints, MAX_PTS) }, (_, i) =>
    Math.round((i / Math.min(tc.numPoints, MAX_PTS) * lapDurationS) * 10) / 10
  );

  const gearClamped = tc.gear.map(g => Math.max(0, Math.min(8, g)));
  const analysis = analyseLap(tc);
  console.log(`  Analysis: ${analysis.brakingZones.length} braking zones, ${analysis.straights.length} straights`);

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    lap: { lap: lapNum, time: tc.lapTimeMs, sectors: [], cuts: 0, tyre: '' },
    beacons: [],
    sampleRateHz: Math.round(tc.numPoints / lapDurationS),
    totalSamples: tc.numPoints,
    lapDurationS,
    timeAxis,
    tcFile: path.basename(filePath),
    driver: tc.driver,
    car: tc.car,
    analysis,
    position: downsample(Array.from(tc.position), 500),
    channels: {
      speed:    downsample(tc.speed.map(v => Math.round(v * 10) / 10), MAX_PTS),
      throttle: downsample(tc.throttle.map(v => Math.round(v * 100) / 100), MAX_PTS),
      brake:    downsample(tc.brake.map(v => Math.round(v * 100) / 100), MAX_PTS),
      gear:     downsample(gearClamped, MAX_PTS),
      rpm:      null,
    },
  }));
}

// ─── SECTOR COMPARISON ────────────────────────────────────────────────────────

function getSectorComparison(track, lapTime1, lapTime2, sessionDate) {
  try {
    const sessions = loadAllSessions();
    const trackSlug = (track || '').toLowerCase().replace(/[^a-z0-9]/g, '');

    let target = null;
    if (sessionDate) {
      const sessionMs = new Date(sessionDate).getTime();
      let closestDt = Infinity;
      for (const s of sessions) {
        if (!s.date) continue;
        const sSlug = (s.track || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        if (!sSlug.includes(trackSlug) && !trackSlug.includes(sSlug)) continue;
        const dt = Math.abs(new Date(s.date).getTime() - sessionMs);
        if (dt < closestDt) { closestDt = dt; target = s; }
      }
    }
    if (!target) {
      target = sessions.find(s => {
        const sSlug = (s.track || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        return sSlug.includes(trackSlug) || trackSlug.includes(sSlug);
      });
    }
    if (!target) return null;

    const allLaps = target.sessions.flatMap(s => s.laps || []);
    const findLap = t => allLaps.find(l => Math.abs(l.time - t) <= 100);
    const l1 = findLap(lapTime1);
    const l2 = findLap(lapTime2);
    if (!l1 && !l2) return null;

    return {
      lap1: l1 ? { lap: l1.lap, time: l1.time, sectors: l1.sectors || [] } : null,
      lap2: l2 ? { lap: l2.lap, time: l2.time, sectors: l2.sectors || [] } : null,
    };
  } catch {
    return null;
  }
}

// ─── COMPARE API ──────────────────────────────────────────────────────────────

function handleCompare(url, res) {
  const track      = url.searchParams.get('track')       || '';
  const lapTime1   = parseInt(url.searchParams.get('lapTime1')  || '0');
  const lapTime2   = parseInt(url.searchParams.get('lapTime2')  || '0');
  const sessionDate= url.searchParams.get('sessionDate') || null;
  const driver     = url.searchParams.get('driver')      || '';

  console.log(`\n📊 Compare: track="${track}" lap1=${lapTime1}ms lap2=${lapTime2}ms`);

  const sendComparison = (data1, data2, label1, label2) => {
    const analysis1 = analyseLap(data1);
    const analysis2 = analyseLap(data2);
    const comparison = compareLaps(analysis1, analysis2, data1, data2);
    console.log(`  Matched ${comparison.matchedZones.filter(z => z.lap2).length}/${comparison.matchedZones.length} braking zones (${label1}+${label2})`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      lap1: { time: data1.lapTimeMs, file: label1, analysis: analysis1 },
      lap2: { time: data2.lapTimeMs, file: label2, analysis: analysis2 },
      comparison,
    }));
  };

  const cap1 = findCapturedLap(track, lapTime1);
  const cap2 = findCapturedLap(track, lapTime2);
  if (cap1) cap1.gear = cleanGear(cap1.gear);
  if (cap2) cap2.gear = cleanGear(cap2.gear);

  if (cap1 && cap2 && cap1.capturedAt !== cap2.capturedAt) {
    sendComparison(cap1, cap2, `captured_lap${cap1.lap}`, `captured_lap${cap2.lap}`);
    return;
  }

  const cands1 = findTcFiles(track, lapTime1, sessionDate, driver);
  const cands2 = findTcFiles(track, lapTime2, sessionDate, driver);

  if (cap1 && cands2.length) {
    sendComparison(cap1, cands2[0].tc, `captured_lap${cap1.lap}`, path.basename(cands2[0].filePath));
    return;
  }
  if (cap2 && cands1.length) {
    sendComparison(cands1[0].tc, cap2, path.basename(cands1[0].filePath), `captured_lap${cap2.lap}`);
    return;
  }

  if (!cands1.length || !cands2.length || cands1[0].filePath === cands2[0].filePath) {
    const sectors = getSectorComparison(track, lapTime1, lapTime2, sessionDate);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'no_separate_telemetry',
      message: 'AC only saves the best lap as a .tc file — full telemetry comparison is unavailable.',
      sectors,
    }));
    return;
  }

  sendComparison(cands1[0].tc, cands2[0].tc, path.basename(cands1[0].filePath), path.basename(cands2[0].filePath));
}

// ─── CAPTURED LAP TELEMETRY ───────────────────────────────────────────────────

function cleanGear(gear) {
  if (!gear || gear.length < 3) return gear;
  const g = gear.slice();
  for (let i = 1; i < g.length - 1; i++) {
    if (g[i] < g[i - 1] - 2 && g[i] < g[i + 1] - 2) g[i] = g[i - 1];
  }
  return g;
}

function resolveCaptureDir(track) {
  const trackSlug = (track || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!fs.existsSync(CAPTURE_PATH)) return null;
  try {
    const dirs = fs.readdirSync(CAPTURE_PATH).filter(d => {
      try { return fs.statSync(path.join(CAPTURE_PATH, d)).isDirectory(); } catch { return false; }
    });
    const scored = dirs.map(d => {
      const dSlug = d.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (dSlug === trackSlug) return { d, score: 1000 };
      if (trackSlug.includes(dSlug) || dSlug.includes(trackSlug)) return { d, score: dSlug.length };
      return { d, score: -1 };
    }).filter(x => x.score >= 0).sort((a, b) => b.score - a.score);
    return scored.length ? path.join(CAPTURE_PATH, scored[0].d) : null;
  } catch { return null; }
}

function findCapturedLap(track, lapTimeMs, lapNum) {
  const trackDir = resolveCaptureDir(track);
  if (!trackDir || !fs.existsSync(trackDir)) return null;

  let best = null, bestDt = 500;
  let bestExact = null, bestExactDt = 500;
  try {
    fs.readdirSync(trackDir).filter(f => f.endsWith('.json')).forEach(f => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(trackDir, f)));
        const dt = Math.abs(data.lapTimeMs - lapTimeMs);
        if (dt < bestDt) { bestDt = dt; best = data; }
        if (lapNum != null && data.lap === lapNum && dt < bestExactDt) {
          bestExactDt = dt; bestExact = data;
        }
      } catch {}
    });
  } catch {}
  return bestExact || best;
}

function handleCapture(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    try {
      const raw = JSON.parse(body);
      const { track, car, driver, lap, lapTimeMs, capturedAt, sampleHz, points } = raw;
      if (!track || !lapTimeMs || !points?.length) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing track, lapTimeMs, or points' }));
        return;
      }

      const rawGear = points.map(p => p.gear);
      const captured = {
        driver: driver || '', track, car: car || '', lap: lap || 0,
        lapTimeMs, capturedAt: capturedAt || Date.now(),
        sampleHz: sampleHz || 10,
        numPoints: points.length,
        position: points.map(p => p.pos),
        speed:    points.map(p => p.spd),
        throttle: points.map(p => p.thr),
        brake:    points.map(p => p.brk),
        gear:     cleanGear(rawGear),
      };

      if (!fs.existsSync(CAPTURE_PATH)) fs.mkdirSync(CAPTURE_PATH, { recursive: true });
      const trackDir = resolveCaptureDir(track) ||
        path.join(CAPTURE_PATH, track.toLowerCase().replace(/[^a-z0-9]/g, '_'));
      if (!fs.existsSync(trackDir)) fs.mkdirSync(trackDir);

      const filename = `lap${lap}_${lapTimeMs}_${Date.now()}.json`;
      fs.writeFileSync(path.join(trackDir, filename), JSON.stringify(captured));
      console.log(`\n💾 Captured: lap ${lap} ${lapTimeMs}ms (${points.length} pts) → ${filename}`);

      bus.emit('update');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, file: filename }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
}

// ─── SECTORS API ──────────────────────────────────────────────────────────────

function handleSectors(url, res) {
  const track       = url.searchParams.get('track') || '';
  const sessionDate = url.searchParams.get('sessionDate') || null;
  const trackSlug   = track.toLowerCase().replace(/[^a-z0-9]/g, '');

  const sessions = loadAllSessions();
  let target = null;
  if (sessionDate) {
    const sessionMs = new Date(sessionDate).getTime();
    let closest = Infinity;
    for (const s of sessions) {
      if (!s.date) continue;
      const sSlug = (s.track || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!sSlug.includes(trackSlug) && !trackSlug.includes(sSlug)) continue;
      const dt = Math.abs(new Date(s.date).getTime() - sessionMs);
      if (dt < closest) { closest = dt; target = s; }
    }
  }
  if (!target) target = sessions.find(s => {
    const sSlug = (s.track || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return sSlug.includes(trackSlug) || trackSlug.includes(sSlug);
  });

  if (!target) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Session not found' }));
    return;
  }

  const laps = target.sessions.flatMap(s => s.validLaps || []);
  const numSectors = laps.find(l => l.sectors?.length)?.sectors?.length || 0;

  const bestSectors = numSectors > 0
    ? Array.from({ length: numSectors }, (_, i) =>
        Math.min(...laps.map(l => l.sectors?.[i]).filter(t => t > 0 && t < 120000)))
    : [];

  const theoretical = bestSectors.reduce((a, b) => a + b, 0);
  const actualBest  = Math.min(...laps.map(l => l.time));

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    laps: laps.map(l => ({ lap: l.lap, time: l.time, sectors: l.sectors || [] })),
    bestSectors,
    theoreticalBest: theoretical,
    actualBest,
    available: actualBest - theoretical,
  }));
}

// ─── DRIVING COACH ───────────────────────────────────────────────────────────

function loadTrackKnowledge() {
  const dir = path.join(__dirname, 'trackKnowledge');
  if (!fs.existsSync(dir)) return {};
  const knowledge = {};
  try {
    fs.readdirSync(dir).filter(f => f.endsWith('.txt')).forEach(f => {
      knowledge[path.basename(f, '.txt')] = fs.readFileSync(path.join(dir, f), 'utf8').trim();
    });
    console.log(`📚 Loaded ${Object.keys(knowledge).length} track knowledge files`);
  } catch (e) {
    console.warn('Could not load track knowledge:', e.message);
  }
  return knowledge;
}

const TRACK_KNOWLEDGE = loadTrackKnowledge();

function getTrackKnowledge(track) {
  const slug = (track || '').toLowerCase();
  for (const key of Object.keys(TRACK_KNOWLEDGE)) {
    if (slug.includes(key)) return TRACK_KNOWLEDGE[key];
  }
  return null;
}

const COACH_SYSTEM_PROMPT = `You are an expert motorsport driving coach specialising in data-driven lap analysis.
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
  "trackSummary": "2-3 sentence overview of the session",
  "bestLap": { "lap": <int>, "timeMs": <int> },
  "theoreticalBestMs": <int>,
  "zones": [
    {
      "name": "<corner or zone name>",
      "position": <float 0-1>,
      "type": "braking | throttle | consistency | track-tip",
      "priority": <int 1-5, 1 = highest>,
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

Zones should be ordered by priority (1 = most time to gain). Return 5-7 zones maximum.
Keep each observation under 20 words with specific numbers. Keep each instruction under 12 words.
Respond with JSON only — no markdown, no preamble, no trailing text.`;

function loadAllCapturedLaps(track) {
  const trackDir = resolveCaptureDir(track);
  if (!trackDir || !fs.existsSync(trackDir)) return [];
  const laps = [];
  try {
    fs.readdirSync(trackDir).filter(f => f.endsWith('.json')).forEach(f => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(trackDir, f)));
        if (data.lapTimeMs && data.position?.length) laps.push(data);
      } catch {}
    });
  } catch {}
  return laps;
}

function buildSpeedTrace(lap) {
  const result = [];
  for (let i = 0; i < 20; i++) {
    const pos = i / 20;
    let bestIdx = 0, bestDt = Infinity;
    for (let j = 0; j < lap.position.length; j++) {
      const dt = Math.abs(lap.position[j] - pos);
      if (dt < bestDt) { bestDt = dt; bestIdx = j; }
    }
    result.push({ pos: pos.toFixed(2), spd: Math.round(lap.speed[bestIdx]) });
  }
  return result;
}

function buildCoachMessage(track, capturedLaps, sectorData) {
  const laps = [...capturedLaps].sort((a, b) => a.lapTimeMs - b.lapTimeMs);
  const best = laps[0];
  const bestMs = best.lapTimeMs;

  const fmtMs = ms => {
    const m = Math.floor(ms / 60000);
    const s = ((ms % 60000) / 1000).toFixed(3);
    return `${m}:${s.padStart(6, '0')}`;
  };

  const analysisCache = new Map();
  const getAnalysis = lap => {
    if (!analysisCache.has(lap)) analysisCache.set(lap, analyseLap(lap));
    return analysisCache.get(lap);
  };

  const bestAnalysis = getAnalysis(best);
  const topZones = [...bestAnalysis.brakingZones]
    .sort((a, b) => b.speedLoss - a.speedLoss)
    .slice(0, 8);

  const speedTrace = buildSpeedTrace(best);
  const lines = [];

  lines.push(`SESSION DATA — ${track}, ${new Date().toISOString().slice(0, 10)}`);
  lines.push(`Car: ${best.car || 'unknown'} | Driver: ${best.driver || 'unknown'}`);
  lines.push(`Laps driven: ${laps.length} | Best lap: ${fmtMs(bestMs)} (Lap ${best.lap})`);
  if (sectorData?.theoreticalBest) {
    lines.push(`Theoretical best (sum of best sectors): ${fmtMs(sectorData.theoreticalBest)}`);
  }

  lines.push('', '--- LAP SUMMARY ---');
  for (const lap of laps) {
    const lapSector = sectorData?.laps?.find(l => Math.abs(l.time - lap.lapTimeMs) <= 200);
    const s = lapSector?.sectors || [];
    const sStr = s.length >= 3
      ? `S1=${fmtMs(s[0])} S2=${fmtMs(s[1])} S3=${fmtMs(s[2])}`
      : 'sectors: n/a';
    const delta = lap.lapTimeMs === bestMs ? 'BEST' : `+${((lap.lapTimeMs - bestMs) / 1000).toFixed(3)}s`;
    lines.push(`Lap ${lap.lap}: ${fmtMs(lap.lapTimeMs)} | ${sStr} | vs best: ${delta}`);
  }

  lines.push('', '--- BRAKING ZONES (from best lap) ---');
  topZones.forEach((z, i) => {
    lines.push(`Zone ${i + 1} pos=${z.brakePoint} | entry=${z.speedIn}km/h apex=${z.speedApex}km/h | peak brake=${z.peakBrake}% | duration=${z.duration}s | trail=${z.trailBrake ? 'yes' : 'no'}`);
  });

  lines.push('', '--- SPEED TRACE SUMMARY (best lap, sampled at key positions) ---');
  lines.push(speedTrace.map(pt => `pos=${pt.pos} spd=${pt.spd}`).join(' | '));

  if (laps.length > 1) {
    lines.push('', '--- LAP-TO-LAP BRAKING DELTAS ---');
    const otherLaps = laps.slice(1);
    topZones.forEach((z, i) => {
      const parts = otherLaps.map(other => {
        const match = getAnalysis(other).brakingZones.find(
          oz => Math.abs(oz.brakePoint - z.brakePoint) < 0.05
        );
        if (!match) return null;
        const d = (match.duration - z.duration).toFixed(1);
        return `Lap${other.lap}=${match.duration}s Δ=${d > 0 ? '+' : ''}${d}s`;
      }).filter(Boolean);
      if (parts.length) {
        lines.push(`Zone ${i + 1} (pos=${z.brakePoint}): best=${z.duration}s ${parts.join(' ')}`);
      }
    });
  }

  lines.push('', '--- THROTTLE STATS (per lap) ---');
  for (const lap of laps) {
    const a = getAnalysis(lap).stats;
    lines.push(`Lap ${lap.lap}: full-throttle=${a.throttlePct}% | coasting=${a.coastPct}% | avg-speed=${a.avgSpeed}km/h | top-speed=${a.topSpeed}km/h`);
  }

  lines.push('', 'Analyse this data and return the JSON coaching report.');
  return lines.join('\n');
}

function extractJsonObject(text) {
  try { return JSON.parse(text.trim()); } catch {}
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\' && inStr) { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') { if (depth === 0) start = i; depth++; }
    else if (ch === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        try { return JSON.parse(text.substring(start, i + 1)); } catch {}
        start = -1;
      }
    }
  }
  return null;
}

// BYOK — call Claude directly with the user's own key
function callClaudeDirect(apiKey, userMessage, callback) {
  const body = JSON.stringify({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: [{ type: 'text', text: COACH_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: userMessage }],
  });

  const opts = {
    hostname: 'api.anthropic.com',
    path: '/v1/messages',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'prompt-caching-2024-07-31',
      'Content-Length': Buffer.byteLength(body),
    },
  };

  const req = https.request(opts, apiRes => {
    let data = '';
    apiRes.on('data', chunk => { data += chunk; });
    apiRes.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        if (parsed.error) { callback(new Error(parsed.error.message || 'API error')); return; }
        if (parsed.stop_reason === 'max_tokens') {
          callback(new Error('Coach response was truncated — too many tokens. Try again.'));
          return;
        }
        const text = parsed.content?.[0]?.text || '';
        const report = extractJsonObject(text);
        if (!report) { callback(new Error('No valid JSON found in Coach response')); return; }
        callback(null, report);
      } catch (e) { callback(e); }
    });
  });
  req.on('error', callback);
  req.write(body);
  req.end();
}

// Token mode — proxy through the hosted backend
function callClaudeViaBackend(backendUrl, accessToken, userMessage, callback) {
  const payload = JSON.stringify({ userContent: userMessage });
  const parsed = new URL('/.netlify/functions/coach', backendUrl);

  const req = https.request({
    hostname: parsed.hostname,
    path: parsed.pathname,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
      'Content-Length': Buffer.byteLength(payload),
    },
  }, apiRes => {
    let data = '';
    apiRes.on('data', chunk => { data += chunk; });
    apiRes.on('end', () => {
      try {
        const body = JSON.parse(data);
        if (apiRes.statusCode === 402) {
          callback(new Error(`insufficient_tokens:${body.balance ?? 0}`));
          return;
        }
        if (apiRes.statusCode !== 200) {
          callback(new Error(body.error || `Backend error ${apiRes.statusCode}`));
          return;
        }
        callback(null, body);
      } catch (e) { callback(e); }
    });
  });
  req.on('error', callback);
  req.write(payload);
  req.end();
}

function handleCoach(url, res) {
  const track = url.searchParams.get('track') || '';
  const cfg   = loadConfig();

  let capturedLaps = loadAllCapturedLaps(track);
  if (!capturedLaps.length) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `No captured telemetry found for track "${track}". Drive some laps first.` }));
    return;
  }

  if (capturedLaps.length > 2) {
    const sorted = capturedLaps.map(l => l.lapTimeMs).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const racing = capturedLaps.filter(l => l.lapTimeMs <= median * 1.5);
    if (racing.length >= 2) capturedLaps = racing;
  }
  capturedLaps.forEach(l => { l.gear = cleanGear(l.gear); });

  const sessions  = loadAllSessions();
  const trackSlug = (track || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const session   = sessions.find(s => {
    const sSlug = (s.track || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return sSlug.includes(trackSlug) || trackSlug.includes(sSlug);
  });
  const allLaps    = session ? session.sessions.flatMap(s => s.validLaps || []) : [];
  const numSectors = allLaps.find(l => l.sectors?.length)?.sectors?.length || 0;
  const bestSectors = numSectors > 0
    ? Array.from({ length: numSectors }, (_, i) =>
        Math.min(...allLaps.map(l => l.sectors?.[i]).filter(t => t > 0 && t < 120000)))
    : [];
  const sectorData = {
    laps: allLaps.map(l => ({ lap: l.lap, time: l.time, sectors: l.sectors || [] })),
    theoreticalBest: bestSectors.length ? bestSectors.reduce((a, b) => a + b, 0) : null,
  };

  const trackKnowledge = getTrackKnowledge(track);
  const userContent = (trackKnowledge ? trackKnowledge + '\n\n' : '') +
    buildCoachMessage(track, capturedLaps, sectorData);

  console.log(`\n🎓 Coach [${cfg.mode}]: track="${track}" laps=${capturedLaps.length} msg=${userContent.length} chars`);

  const done = (err, report) => {
    if (err) {
      console.error('  Coach error:', err.message);
      if (err.message.startsWith('insufficient_tokens:')) {
        const balance = parseInt(err.message.split(':')[1]) || 0;
        res.writeHead(402, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'insufficient_tokens', balance }));
        return;
      }
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
      return;
    }
    console.log(`  Coach: ${report.zones?.length || 0} zones returned`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(report));
  };

  if (cfg.mode === 'token') {
    if (!cfg.backendUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Backend URL not set. Open ⚙ Settings to configure.' }));
      return;
    }
    if (!cfg.account?.accessToken) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not signed in. Open ⚙ Settings to log in.' }));
      return;
    }
    callClaudeViaBackend(cfg.backendUrl, cfg.account.accessToken, userContent, done);
  } else {
    const apiKey = cfg.apiKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'No API key set. Open ⚙ Settings → API Key to add your Anthropic key.' }));
      return;
    }
    callClaudeDirect(apiKey, userContent, done);
  }
}

// ─── CONFIG API ───────────────────────────────────────────────────────────────

function handleConfigGet(res) {
  const cfg = loadConfig();
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    mode:         cfg.mode,
    hasApiKey:    !!(cfg.apiKey || process.env.ANTHROPIC_API_KEY),
    apiKeyMasked: cfg.apiKey
      ? cfg.apiKey.slice(0, 10) + '…'
      : (process.env.ANTHROPIC_API_KEY ? '(from environment)' : ''),
    backendUrl: cfg.backendUrl || '',
    account: {
      email:    cfg.account?.email    || '',
      loggedIn: !!(cfg.account?.accessToken),
    },
  }));
}

function handleConfigPost(req, res) {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    try {
      const updates = JSON.parse(body);
      const cfg = loadConfig();
      if (updates.mode       !== undefined) cfg.mode       = updates.mode;
      if (updates.apiKey     !== undefined) cfg.apiKey     = updates.apiKey;
      if (updates.backendUrl !== undefined) cfg.backendUrl = updates.backendUrl;
      if (updates.account    !== undefined) cfg.account    = { ...cfg.account, ...updates.account };
      saveConfig(cfg);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
}

function handleTokenBalance(res) {
  const cfg = loadConfig();
  if (cfg.mode !== 'token' || !cfg.backendUrl || !cfg.account?.accessToken) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ balance: null, mode: cfg.mode }));
    return;
  }
  const url = new URL('/.netlify/functions/tokens', cfg.backendUrl);
  const req = https.request({
    hostname: url.hostname,
    path:     url.pathname,
    method:   'GET',
    headers:  { 'Authorization': `Bearer ${cfg.account.accessToken}` },
  }, apiRes => {
    let data = '';
    apiRes.on('data', c => { data += c; });
    apiRes.on('end', () => {
      res.writeHead(apiRes.statusCode, { 'Content-Type': 'application/json' });
      res.end(data);
    });
  });
  req.on('error', e => {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
  });
  req.end();
}

// ─── FILE WATCHER ─────────────────────────────────────────────────────────────

function startWatcher() {
  if (!fs.existsSync(SESSIONS_PATH)) {
    console.warn(`⚠  Sessions folder not found: ${SESSIONS_PATH}`);
    return;
  }
  fs.watch(SESSIONS_PATH, (event, filename) => {
    if (filename?.endsWith('.json')) setTimeout(() => bus.emit('update'), 300);
  });
  console.log(`👀 Watching: ${SESSIONS_PATH}`);
}

// ─── HTTP SERVER ──────────────────────────────────────────────────────────────

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript',
  '.css': 'text/css',   '.json': 'application/json', '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache',
      'Connection': 'keep-alive', 'Access-Control-Allow-Origin': '*',
    });
    res.write('data: connected\n\n');
    const onUpdate = () => res.write('data: update\n\n');
    bus.on('update', onUpdate);
    req.on('close', () => bus.off('update', onUpdate));
    return;
  }

  if (url.pathname === '/api/sessions')      { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(loadAllSessions())); return; }
  if (url.pathname === '/api/telemetry')     { handleTelemetry(url, res); return; }
  if (url.pathname === '/api/compare')       { handleCompare(url, res);   return; }
  if (url.pathname === '/api/sectors')       { handleSectors(url, res);   return; }
  if (url.pathname === '/api/coach')         { handleCoach(url, res);     return; }
  if (url.pathname === '/api/tokens/balance') { handleTokenBalance(res);  return; }

  if (url.pathname === '/api/capture' && req.method === 'POST') {
    handleCapture(req, res); return;
  }
  if (url.pathname === '/api/config') {
    if (req.method === 'GET')  { handleConfigGet(res);      return; }
    if (req.method === 'POST') { handleConfigPost(req, res); return; }
  }

  let filePath = path.join(__dirname, 'public', url.pathname === '/' ? 'index.html' : url.pathname);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'text/plain' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  const cfg = loadConfig();
  console.log(`\n🏎  AC Dashboard  →  http://localhost:${PORT}`);
  console.log(`📁 Sessions:    ${SESSIONS_PATH}`);
  console.log(`📡 Telemetry:   ${CTELEMETRY_PATH}`);
  console.log(`⚙  Coach mode:  ${cfg.mode === 'token' ? 'Token (hosted backend)' : 'BYOK (your API key)'}\n`);
  startWatcher();
});
