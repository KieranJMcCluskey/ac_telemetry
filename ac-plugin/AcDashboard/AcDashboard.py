import ac
import acsys
import json
import os

APP_NAME    = "AcDashboard"
SAMPLE_HZ   = 10

# Debug log file — written directly so it flushes immediately (ac.log is buffered)
_DEBUG_FILE = os.path.join(os.path.expanduser("~"), "Documents", "Assetto Corsa", "logs", "acdashboard_debug.txt")

def _dlog(msg):
    try:
        with open(_DEBUG_FILE, "a") as f:
            f.write(msg + "\n")
    except Exception:
        pass
    ac.log("[AcDashboard] " + msg)

_app_window   = None
_status_lbl   = None
_points       = []
_last_lap_ms  = -1   # monitors acsys.CS.LastLap for changes
_lap_num      = 0
_last_sample  = 0.0
_track        = ""
_car          = ""
_driver       = ""
_tick         = 0    # counts acUpdate calls for periodic logging


def acMain(ac_version):
    global _app_window, _status_lbl, _track, _car, _driver

    # Clear debug log at start
    try:
        with open(_DEBUG_FILE, "w") as f:
            f.write("[AcDashboard] Started\n")
    except Exception:
        pass

    _app_window = ac.newApp(APP_NAME)
    ac.setSize(_app_window, 220, 30)
    ac.setTitle(_app_window, "")
    ac.setIconPosition(_app_window, 0, -10000)

    _status_lbl = ac.addLabel(_app_window, "REC  waiting…")
    ac.setPosition(_status_lbl, 6, 6)
    ac.setFontSize(_status_lbl, 12)
    ac.setFontColor(_status_lbl, 0.9, 0.3, 0.3, 1.0)

    try:
        _track  = ac.getTrackName(0)
        _car    = ac.getCarName(0)
        _driver = ac.getDriverName(0)
    except Exception as e:
        _dlog("acMain meta error: {}".format(e))

    _dlog("Loaded — track='{}' car='{}'".format(_track, _car))
    return APP_NAME


def acUpdate(deltaT):
    global _points, _last_lap_ms, _lap_num, _last_sample
    global _track, _car, _driver, _tick

    try:
        _tick += 1

        # Resolve track/car/driver if still empty
        if not _track:
            try:
                _track  = ac.getTrackName(0)
                _car    = ac.getCarName(0)
                _driver = ac.getDriverName(0)
                if _track:
                    _dlog("Track resolved: '{}'".format(_track))
            except Exception:
                pass

        # Periodic state log every ~300 ticks (~5 s at 60fps)
        if _tick % 300 == 0:
            try:
                lc   = ac.getCarState(0, acsys.CS.LapCount)
                ll   = int(ac.getCarState(0, acsys.CS.LastLap))
                spd  = round(float(ac.getCarState(0, acsys.CS.SpeedKMH)), 1)
                _dlog("tick={} LapCount={} LastLap={}ms pts={} spd={} track='{}'".format(
                    _tick, lc, ll, len(_points), spd, _track))
            except Exception as e:
                _dlog("periodic log error: {}".format(e))

        # ── Lap completion detection via LastLap changing ─────────────────────
        # LastLap returns the time of the most recently completed lap (ms).
        # It stays at -1 until the first lap is done, then changes each lap.
        try:
            current_last_lap = int(ac.getCarState(0, acsys.CS.LastLap))
        except Exception:
            current_last_lap = -1

        if current_last_lap > 0 and current_last_lap != _last_lap_ms:
            # A new lap just completed
            _lap_num += 1
            _dlog("Lap complete: lapTime={}ms pts={} lapNum={}".format(
                current_last_lap, len(_points), _lap_num))
            if current_last_lap > 10000 and len(_points) >= 20:
                _send_lap(current_last_lap, _lap_num)
            else:
                _dlog("Lap skipped: time={}ms pts={}".format(current_last_lap, len(_points)))
            _points = []
            _last_lap_ms = current_last_lap

        # ── Update status label ───────────────────────────────────────────────
        if _status_lbl is not None:
            try:
                lc = ac.getCarState(0, acsys.CS.LapCount)
                ac.setText(_status_lbl, "REC  Lap {}  |  {} pts".format(int(lc), len(_points)))
            except Exception:
                pass

        # ── Sample at SAMPLE_HZ ───────────────────────────────────────────────
        _last_sample += deltaT
        if _last_sample < 1.0 / SAMPLE_HZ:
            return
        _last_sample = 0.0

        _points.append({
            'pos':  round(float(ac.getCarState(0, acsys.CS.NormalizedSplinePosition)), 4),
            'spd':  round(float(ac.getCarState(0, acsys.CS.SpeedKMH)), 1),
            'thr':  round(float(ac.getCarState(0, acsys.CS.Gas)), 3),
            'brk':  round(float(ac.getCarState(0, acsys.CS.Brake)), 3),
            'gear': int(ac.getCarState(0, acsys.CS.Gear)),
        })

    except Exception as e:
        _dlog("acUpdate error: {}".format(e))


def _send_lap(lap_time_ms, lap_num):
    try:
        import re
        import time as _time

        track_slug = re.sub(r'[^a-z0-9]', '_', _track.lower()) if _track else 'unknown'

        captured = {
            'driver':    _driver,
            'track':     _track,
            'car':       _car,
            'lap':       lap_num,
            'lapTimeMs': lap_time_ms,
            'capturedAt': int(_time.time() * 1000),
            'sampleHz':  SAMPLE_HZ,
            'numPoints': len(_points),
            'position':  [p['pos'] for p in _points],
            'speed':     [p['spd'] for p in _points],
            'throttle':  [p['thr'] for p in _points],
            'brake':     [p['brk'] for p in _points],
            'gear':      [p['gear'] for p in _points],
        }

        # Write directly to the dashboard's capture folder — no network, no running
        # server needed. This path MUST match the dashboard server's CAPTURE_PATH
        # (ac-dashboard/ac-dashboard/server.js):
        #   %USERPROFILE%\Documents\AC Dashboard\captured\<track_slug>
        base = os.path.join(
            os.path.expanduser("~"), "Documents",
            "AC Dashboard", "captured", track_slug
        )
        if not os.path.exists(base):
            os.makedirs(base)

        filename = "lap{}_{}_{}_{}.json".format(
            lap_num, lap_time_ms, int(_time.time()), len(_points))
        filepath = os.path.join(base, filename)

        with open(filepath, 'w') as f:
            json.dump(captured, f)

        _dlog("Lap {} saved — {}ms {} pts -> {}".format(
            lap_num, lap_time_ms, len(_points), filename))
    except Exception as e:
        _dlog("Save failed: {}".format(e))


def acShutdown():
    _dlog("Shutdown")
