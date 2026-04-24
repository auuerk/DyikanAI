#!/usr/bin/env python3
"""
=============================================================================
  MICROGREENHOUSE FROST DETECTION — STEP 4: DEPLOYMENT SCRIPT
  Naryn & Mountainous Regions, Kyrgyzstan
=============================================================================

  TARGET HARDWARE : Raspberry Pi (any model with Python 3.8+)
  DATABASE        : InfluxDB 2.x
  MODEL           : XGBoost (trained in frost_detection_pipeline.py)

  SYSTEM FLOW (this script handles steps 2–4):
    [1] Sensor → Pi  ← your existing data collection
    [2] Pi → InfluxDB (bucket: greenhouse_raw)       ← existing
    [3] THIS SCRIPT: pulls latest raw data            ← NEW
    [4] THIS SCRIPT: runs XGBoost prediction          ← NEW
    [5] THIS SCRIPT: writes results to InfluxDB       ← NEW
         (bucket: greenhouse_predictions)
    [6] Teammate reads predictions → if-logic → actuators

  INFLUXDB DEFAULTS (edit in .env or SECTION 1 below):
    Input  bucket      : greenhouse_raw
    Input  measurement : sensor_data
    Output bucket      : greenhouse_predictions
    Output measurement : frost_detection

  OUTPUT FIELDS WRITTEN BACK TO INFLUXDB:
    frost_risk          int     0 or 1   (primary actuator trigger)
    frost_probability   float   0.0–1.0  (confidence score)
    frost_alert_level   string  "NONE" / "WATCH" / "WARNING" / "CRITICAL"
    model_version       string  model identifier tag

  RUNNING MODES:
    python deploy_frost_detector.py            → runs once then exits
    python deploy_frost_detector.py --loop     → runs every POLL_INTERVAL_S
    python deploy_frost_detector.py --backfill → re-predict last 24 h of data

  INSTALLATION:
    pip install influxdb-client joblib pandas numpy scikit-learn xgboost python-dotenv
    cp .env.example .env && nano .env          → fill in your token & org
    python deploy_frost_detector.py --loop     → test interactively
    sudo cp frost_detector.service /etc/systemd/system/
    sudo systemctl enable --now frost_detector → run as background service

=============================================================================
"""

# =============================================================================
# SECTION 0 — IMPORTS
# =============================================================================

import os
import sys
import time
import signal
import logging
import argparse
import traceback
from datetime import datetime, timezone, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
import joblib

# InfluxDB 2.x official client
try:
    from influxdb_client import InfluxDBClient, Point, WritePrecision
    from influxdb_client.client.write_api import SYNCHRONOUS
    from influxdb_client.client.exceptions import InfluxDBError
    from influxdb_client.client.flux_table import FluxStructureEncoder
except ImportError:
    print("ERROR: influxdb-client not installed.")
    print("       Run: pip install influxdb-client")
    sys.exit(1)

# .env file support — checks for frost-detector.env first, then .env
try:
    from dotenv import load_dotenv
    _env_file = next(
        (p for p in [
            Path(__file__).parent / "frost-detector.env",
            Path(__file__).parent / ".env",
        ] if p.exists()),
        None
    )
    if _env_file:
        load_dotenv(_env_file)
        print(f"  ✅ .env loaded ({_env_file.name})")
    else:
        print("  ⚠️  No .env file found — falling back to environment variables")
except ImportError:
    pass  # python-dotenv not installed; fall back to env vars or config below

# =============================================================================
# SECTION 1 — CONFIGURATION
#   Priority: .env file > environment variables > hardcoded defaults below.
#   Edit .env for all secrets; hardcoded values here are safe defaults only.
# =============================================================================

def _env(key: str, default: str) -> str:
    """Read from environment, fall back to default."""
    return os.environ.get(key, default)

# ── InfluxDB connection ────────────────────────────────────────────────────
INFLUX_URL        = _env("INFLUX_URL",        "http://localhost:8086")
INFLUX_TOKEN      = _env("INFLUX_TOKEN",      "REPLACE_WITH_YOUR_TOKEN")   # ← set in .env
INFLUX_ORG        = _env("INFLUX_ORG",        "iot-org")
INFLUX_TIMEOUT_MS = int(_env("INFLUX_TIMEOUT_MS", "10000"))

# ── Buckets & measurements ─────────────────────────────────────────────────
INPUT_BUCKET         = _env("INPUT_BUCKET",         "greenhouse_raw")
INPUT_MEASUREMENT    = _env("INPUT_MEASUREMENT",    "sensor_data")
OUTPUT_BUCKET        = _env("OUTPUT_BUCKET",        "greenhouse_predictions")
OUTPUT_MEASUREMENT   = _env("OUTPUT_MEASUREMENT",   "frost_detection")

# ── Model ──────────────────────────────────────────────────────────────────
MODEL_PATH = Path(_env(
    "MODEL_PATH",
    str(Path(__file__).parent / "models" / "XGBoost.joblib")
))
MODEL_VERSION = _env("MODEL_VERSION", "xgb_v1")

# ── Prediction thresholds ──────────────────────────────────────────────────
FROST_THRESHOLD_HIGH     = float(_env("FROST_THRESHOLD_HIGH",    "0.70"))  # → frost_risk=1
FROST_THRESHOLD_WARNING  = float(_env("FROST_THRESHOLD_WARNING", "0.50"))  # → ALERT level up
FROST_THRESHOLD_WATCH    = float(_env("FROST_THRESHOLD_WATCH",   "0.30"))

# ── Timing ─────────────────────────────────────────────────────────────────
POLL_INTERVAL_S  = int(_env("POLL_INTERVAL_S",  "30"))    # match sensor write rate
QUERY_WINDOW_MIN = int(_env("QUERY_WINDOW_MIN", "60"))     # fetch last N minutes
BACKFILL_HOURS   = int(_env("BACKFILL_HOURS",   "24"))

# ── Retry ──────────────────────────────────────────────────────────────────
MAX_RETRIES      = int(_env("MAX_RETRIES",    "3"))
RETRY_DELAY_S    = int(_env("RETRY_DELAY_S",  "5"))

# ── Naryn geographic constants (copied from training pipeline) ─────────────
NARYN_LATITUDE_DEG = 41.43
NARYN_ALTITUDE_M   = 2044

# =============================================================================
# SECTION 2 — LOGGING
# =============================================================================

LOG_FILE = Path(__file__).parent / "frost_detector.log"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(LOG_FILE, mode="a", encoding="utf-8"),
    ],
)
logger = logging.getLogger("FrostDetector")

# =============================================================================
# SECTION 3 — FEATURE ENGINEERING
#   Must exactly mirror frost_detection_pipeline.py  →  engineer_features()
#   The model was trained on these columns; any mismatch will break inference.
# =============================================================================

def _dew_point(temp_c: pd.Series, rh_pct: pd.Series) -> pd.Series:
    a, b  = 17.625, 243.04
    alpha = np.log(rh_pct / 100.0) + a * temp_c / (b + temp_c)
    return (b * alpha) / (a - alpha)

def _wind_chill(temp_c: pd.Series, wind_kmh: pd.Series) -> pd.Series:
    v016 = np.power(np.maximum(wind_kmh, 0.001), 0.16)
    wc   = 13.12 + 0.6215 * temp_c - 11.37 * v016 + 0.3965 * temp_c * v016
    mask = (temp_c <= 10) & (wind_kmh >= 5)
    out  = temp_c.astype(float).copy()
    out[mask] = wc[mask]
    return out

def _solar_elevation(timestamps: pd.Series,
                     lat: float = NARYN_LATITUDE_DEG) -> pd.Series:
    doy      = timestamps.dt.dayofyear
    hour_lst = timestamps.dt.hour + timestamps.dt.minute / 60.0
    decl     = 23.45 * np.sin(np.radians(360 / 365 * (doy - 81)))
    ha       = 15 * (hour_lst - 12)
    lat_r, dec_r, ha_r = (np.radians(lat),
                           np.radians(decl),
                           np.radians(ha))
    elev = np.degrees(np.arcsin(
        np.sin(lat_r) * np.sin(dec_r) +
        np.cos(lat_r) * np.cos(dec_r) * np.cos(ha_r)
    ))
    return elev.clip(-90, 90)

def engineer_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Replicate the exact feature engineering from the training pipeline.
    Input df must have at minimum these raw columns:
        timestamp, air_temp_c, air_humidity_pct, soil_moisture_raw,
        soil_moisture_pct, soil_temp_c, light_raw,
        outdoor_temp_c (estimated or measured),
        wind_speed_ms, wind_speed_kmh, cloud_cover_pct
    """
    df = df.copy()

    # ── Temporal ──────────────────────────────────────────────────────────────
    df['hour']        = df['timestamp'].dt.hour
    df['minute']      = df['timestamp'].dt.minute
    df['day_of_year'] = df['timestamp'].dt.dayofyear
    df['month']       = df['timestamp'].dt.month
    df['day_of_week'] = df['timestamp'].dt.dayofweek

    df['hour_sin'] = np.sin(2 * np.pi * df['hour'] / 24)
    df['hour_cos'] = np.cos(2 * np.pi * df['hour'] / 24)
    df['doy_sin']  = np.sin(2 * np.pi * df['day_of_year'] / 365)
    df['doy_cos']  = np.cos(2 * np.pi * df['day_of_year'] / 365)

    df['is_night']   = ((df['hour'] >= 17) | (df['hour'] < 7)).astype(int)
    df['is_predawn'] = ((df['hour'] >= 3) & (df['hour'] < 6)).astype(int)

    season_map = {1:0,2:0,3:1,4:1,5:1,6:2,7:2,8:2,9:3,10:3,11:0,12:0}
    df['season_code'] = df['month'].map(season_map).fillna(0).astype(int)

    # ── Solar ─────────────────────────────────────────────────────────────────
    df['solar_elevation_deg'] = _solar_elevation(df['timestamp'])
    df['is_daylight']         = (df['solar_elevation_deg'] > 0).astype(int)
    df['light_lux']           = df['light_raw'] * 48.0

    # ── Thermodynamic ─────────────────────────────────────────────────────────
    df['dew_point_c']     = _dew_point(df['air_temp_c'], df['air_humidity_pct'])
    df['temp_dew_gap_c']  = df['air_temp_c'] - df['dew_point_c']
    df['sat_vp_hpa']      = 6.1078 * np.exp(17.27 * df['air_temp_c'] / (df['air_temp_c'] + 237.3))
    df['actual_vp_hpa']   = (df['air_humidity_pct'] / 100.0) * df['sat_vp_hpa']
    df['vpd_hpa']         = df['sat_vp_hpa'] - df['actual_vp_hpa']
    df['wind_chill_c']    = _wind_chill(df['outdoor_temp_c'], df['wind_speed_kmh'])

    # ── Rate-of-change ────────────────────────────────────────────────────────
    df['air_temp_delta_c_min']  = df['air_temp_c'].diff().clip(-5, 5) / 0.5
    df['soil_temp_delta_c_min'] = df['soil_temp_c'].diff().clip(-5, 5) / 0.5
    df['humidity_delta']        = df['air_humidity_pct'].diff()

    # ── Rolling statistics ─────────────────────────────────────────────────────
    WINDOWS = {'5min': 10, '15min': 30, '30min': 60}
    for label, w in WINDOWS.items():
        df[f'air_temp_mean_{label}']  = df['air_temp_c'].rolling(w, min_periods=1).mean()
        df[f'air_temp_std_{label}']   = df['air_temp_c'].rolling(w, min_periods=1).std().fillna(0)
        df[f'humidity_mean_{label}']  = df['air_humidity_pct'].rolling(w, min_periods=1).mean()

    df['temp_trend_15min'] = df['air_temp_c'] - df['air_temp_mean_15min']

    # ── Soil ──────────────────────────────────────────────────────────────────
    df['soil_air_temp_diff'] = df['air_temp_c'] - df['soil_temp_c']
    df['soil_moisture_norm'] = ((df['soil_moisture_raw'] - 300) / 400 * 100).clip(0, 100)

    df = df.ffill().bfill().fillna(0)
    return df


def estimate_outdoor_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    If outdoor_temp_c / wind_speed_ms are not available from a real outdoor
    sensor, estimate them from indoor readings.
    Replace with real sensor reads as soon as you have an outdoor probe.
    """
    df = df.copy()
    if 'outdoor_temp_c' not in df.columns or df['outdoor_temp_c'].isnull().all():
        now   = datetime.now()
        month = now.month
        # Rough heating offset by season
        heat_offset = {1:20, 2:20, 3:18, 4:14, 5:10, 6:6,
                       7:4,  8:4,  9:8,  10:13, 11:17, 12:19}.get(month, 15)
        df['outdoor_temp_c'] = df['air_temp_c'] - heat_offset
        logger.debug("  outdoor_temp_c estimated from indoor (no outdoor sensor)")

    if 'wind_speed_ms' not in df.columns or df['wind_speed_ms'].isnull().all():
        # Naryn monthly mean wind
        month = datetime.now().month
        mean_wind = {1:5.5,2:5.0,3:4.5,4:4.0,5:3.5,6:3.0,
                     7:2.5,8:2.5,9:3.0,10:4.0,11:5.0,12:5.5}.get(month, 4.0)
        df['wind_speed_ms']  = mean_wind
        df['wind_speed_kmh'] = mean_wind * 3.6
        logger.debug("  wind_speed estimated from Naryn monthly mean (no wind sensor)")

    if 'wind_speed_kmh' not in df.columns:
        df['wind_speed_kmh'] = df['wind_speed_ms'] * 3.6

    if 'cloud_cover_pct' not in df.columns or df['cloud_cover_pct'].isnull().all():
        df['cloud_cover_pct'] = 50.0

    return df


# =============================================================================
# SECTION 4 — MODEL LOADER
# =============================================================================

class FrostModel:
    """
    Wrapper around the joblib model bundle.
    Handles feature alignment, scaling (if MLP was selected), and prediction.
    """

    def __init__(self, model_path: Path):
        if not model_path.exists():
            raise FileNotFoundError(
                f"Model not found: {model_path}\n"
                f"  Run frost_detection_pipeline.py first, then copy the\n"
                f"  .joblib file from frost_detection_outputs/models/ here."
            )
        bundle = joblib.load(model_path)
        self.model        = bundle['model']
        self.scaler       = bundle.get('scaler')        # None for tree models
        self.feature_cols = bundle['features']
        logger.info(f"  Model loaded: {model_path.name}")
        logger.info(f"  Features expected: {len(self.feature_cols)}")

    def predict(self, df: pd.DataFrame) -> tuple:
        """
        Returns (frost_risk_array, frost_prob_array) for each row in df.
        Automatically aligns columns to training feature order.
        Missing columns are filled with 0.
        """
        # Align to training columns — zero-fill any missing
        X = df.reindex(columns=self.feature_cols, fill_value=0).values

        if self.scaler is not None:
            X = self.scaler.transform(X)

        probs = self.model.predict_proba(X)[:, 1]
        risks = (probs >= FROST_THRESHOLD_HIGH).astype(int)
        return risks, probs


def alert_level(prob: float) -> str:
    """Translate raw probability to a human-readable alert string."""
    if prob >= FROST_THRESHOLD_HIGH:
        return "CRITICAL"
    elif prob >= FROST_THRESHOLD_WARNING:
        return "WARNING"
    elif prob >= FROST_THRESHOLD_WATCH:
        return "WATCH"
    else:
        return "NONE"


# =============================================================================
# SECTION 5 — INFLUXDB CLIENT WRAPPER
# =============================================================================

class InfluxManager:
    """
    Manages the InfluxDB 2.x connection, Flux queries, and line-protocol writes.
    """

    def __init__(self):
        self.client   = None
        self.query_api = None
        self.write_api = None
        self._connect()

    def _connect(self):
        """Open connection and verify it with a ping."""
        logger.info(f"  Connecting to InfluxDB: {INFLUX_URL}")
        self.client    = InfluxDBClient(
            url     = INFLUX_URL,
            token   = INFLUX_TOKEN,
            org     = INFLUX_ORG,
            timeout = INFLUX_TIMEOUT_MS,
        )
        self.query_api = self.client.query_api()
        self.write_api = self.client.write_api(write_options=SYNCHRONOUS)

        # Ping check
        health = self.client.health()
        if health.status == "pass":
            logger.info(f"  InfluxDB healthy ✅  (version {health.version})")
        else:
            raise ConnectionError(f"InfluxDB health check failed: {health.message}")

    def fetch_latest_sensors(self, window_minutes: int = QUERY_WINDOW_MIN) -> pd.DataFrame:
        """
        Pull the last `window_minutes` of sensor data from InfluxDB.

        Flux query structure:
          from(bucket: "greenhouse_raw")
            |> range(start: -Xm)
            |> filter(fn: (r) => r._measurement == "sensor_data")
            |> pivot(...)

        Returns a DataFrame with columns matching the raw sensor CSV schema.
        Raises RuntimeError if no data is found.
        """
        flux = f"""
from(bucket: "{INPUT_BUCKET}")
  |> range(start: -{window_minutes}m)
  |> filter(fn: (r) => r._measurement == "{INPUT_MEASUREMENT}")
  |> filter(fn: (r) =>
      r._field == "air_temp_c"         or
      r._field == "air_humidity_pct"   or
      r._field == "soil_moisture_raw"  or
      r._field == "soil_moisture_pct"  or
      r._field == "soil_temp_c"        or
      r._field == "light_raw"          or
      r._field == "outdoor_temp_c"     or
      r._field == "wind_speed_ms"      or
      r._field == "cloud_cover_pct"
  )
  |> pivot(
      rowKey: ["_time"],
      columnKey: ["_field"],
      valueColumn: "_value"
  )
  |> sort(columns: ["_time"])
"""
        tables = self.query_api.query(flux)
        if not tables:
            raise RuntimeError(
                f"No data returned from '{INPUT_BUCKET}/{INPUT_MEASUREMENT}' "
                f"in the last {window_minutes} minutes.\n"
                f"  Check that your sensor collection script is writing to InfluxDB."
            )

        rows = []
        for table in tables:
            for record in table.records:
                row = dict(record.values)
                row['timestamp'] = record.get_time()
                rows.append(row)

        if not rows:
            raise RuntimeError("Query returned empty records.")

        df = pd.DataFrame(rows)
        df['timestamp'] = pd.to_datetime(df['timestamp'], utc=True).dt.tz_localize(None)
        df = df.sort_values('timestamp').reset_index(drop=True)

        # Ensure expected numeric columns exist (fill with NaN if sensor not yet wired)
        EXPECTED = ['air_temp_c', 'air_humidity_pct', 'soil_moisture_raw',
                    'soil_moisture_pct', 'soil_temp_c', 'light_raw',
                    'outdoor_temp_c', 'wind_speed_ms', 'cloud_cover_pct']
        for col in EXPECTED:
            if col not in df.columns:
                df[col] = np.nan
            df[col] = pd.to_numeric(df[col], errors='coerce')

        logger.info(f"  Fetched {len(df)} sensor records  "
                    f"({df['timestamp'].min()} → {df['timestamp'].max()})")
        return df

    def fetch_range(self, start: datetime, stop: datetime) -> pd.DataFrame:
        """Fetch sensor data for a specific time window (used for backfill)."""
        start_str = start.strftime("%Y-%m-%dT%H:%M:%SZ")
        stop_str  = stop.strftime("%Y-%m-%dT%H:%M:%SZ")
        flux = f"""
from(bucket: "{INPUT_BUCKET}")
  |> range(start: {start_str}, stop: {stop_str})
  |> filter(fn: (r) => r._measurement == "{INPUT_MEASUREMENT}")
  |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
  |> sort(columns: ["_time"])
"""
        tables = self.query_api.query(flux)
        rows   = []
        for table in tables:
            for record in table.records:
                row = dict(record.values)
                row['timestamp'] = record.get_time()
                rows.append(row)

        if not rows:
            return pd.DataFrame()

        df = pd.DataFrame(rows)
        df['timestamp'] = pd.to_datetime(df['timestamp'], utc=True).dt.tz_localize(None)
        return df.sort_values('timestamp').reset_index(drop=True)

    def write_predictions(self, df: pd.DataFrame,
                          risks: np.ndarray,
                          probs: np.ndarray):
        """
        Write prediction results back to InfluxDB.

        Each written point contains:
          Fields:
            frost_risk         int    0 or 1
            frost_probability  float  0.000 – 1.000
          Tags:
            alert_level        str    NONE / WATCH / WARNING / CRITICAL
            model_version      str    e.g. "xgb_v1"

        One point is written per input sensor timestamp.
        """
        points = []
        for ts, risk, prob in zip(df['timestamp'], risks, probs):
            # Convert to UTC-aware datetime for InfluxDB
            if hasattr(ts, 'to_pydatetime'):
                ts_dt = ts.to_pydatetime().replace(tzinfo=timezone.utc)
            else:
                ts_dt = pd.Timestamp(ts).to_pydatetime().replace(tzinfo=timezone.utc)

            point = (
                Point(OUTPUT_MEASUREMENT)
                .tag("model_version", MODEL_VERSION)
                .tag("alert_level",   alert_level(prob))
                .tag("location",      "naryn_greenhouse")
                .field("frost_risk",        int(risk))
                .field("frost_probability", float(round(prob, 4)))
                .time(ts_dt, WritePrecision.S)
            )
            points.append(point)

        self.write_api.write(bucket=OUTPUT_BUCKET, record=points)
        logger.info(f"  ✅ Wrote {len(points)} prediction points "
                    f"→ {OUTPUT_BUCKET}/{OUTPUT_MEASUREMENT}")

    def close(self):
        if self.client:
            self.client.close()


# =============================================================================
# SECTION 6 — MAIN PREDICTION LOOP
# =============================================================================

def run_once(influx: InfluxManager,
             model:  FrostModel,
             window_minutes: int = QUERY_WINDOW_MIN) -> dict:
    """
    Execute one full prediction cycle:
      1. Pull latest sensor data
      2. Estimate missing outdoor features
      3. Engineer features
      4. Run model
      5. Write results back to InfluxDB
      6. Return summary dict for logging
    """
    # ── 1. Fetch raw sensor data ───────────────────────────────────────────────
    raw_df = influx.fetch_latest_sensors(window_minutes)

    # ── 2. Estimate outdoor features if no outdoor sensor is installed ─────────
    raw_df = estimate_outdoor_features(raw_df)
    if 'wind_speed_kmh' not in raw_df.columns:
        raw_df['wind_speed_kmh'] = raw_df['wind_speed_ms'] * 3.6

    # ── 3. Feature engineering (mirrors training pipeline exactly) ─────────────
    feat_df = engineer_features(raw_df)

    # ── 4. Predict ────────────────────────────────────────────────────────────
    risks, probs = model.predict(feat_df)

    # ── 5. Write results ──────────────────────────────────────────────────────
    influx.write_predictions(feat_df, risks, probs)

    # ── 6. Summary for logging ────────────────────────────────────────────────
    latest_prob  = float(probs[-1])
    latest_risk  = int(risks[-1])
    latest_alert = alert_level(latest_prob)
    frost_count  = int(risks.sum())

    summary = {
        'records':        len(feat_df),
        'frost_count':    frost_count,
        'frost_pct':      round(frost_count / len(feat_df) * 100, 1),
        'latest_prob':    latest_prob,
        'latest_risk':    latest_risk,
        'latest_alert':   latest_alert,
        'latest_ts':      str(feat_df['timestamp'].iloc[-1]),
    }

    # Console alert banner for high-severity events
    if latest_alert in ("WARNING", "CRITICAL"):
        border = "⚠️  " * 20
        logger.warning(border)
        logger.warning(f"  🚨 FROST {latest_alert}: P(frost)={latest_prob:.3f} "
                       f"at {summary['latest_ts']}")
        logger.warning(f"     Actuators should be activated by if-logic layer.")
        logger.warning(border)
    else:
        logger.info(f"  Latest: {latest_alert} | P(frost)={latest_prob:.3f} | "
                    f"frost_risk={latest_risk} | records={len(feat_df)}")

    return summary


def run_loop(influx: InfluxManager, model: FrostModel):
    """
    Continuous polling loop. Runs run_once() every POLL_INTERVAL_S seconds.
    Handles transient InfluxDB errors with exponential back-off.
    Clean exit on SIGTERM / Ctrl-C.
    """
    logger.info(f"Starting prediction loop — polling every {POLL_INTERVAL_S}s")
    logger.info(f"  Press Ctrl-C to stop.  Log file: {LOG_FILE}")

    running = True

    def _sigterm_handler(sig, frame):
        nonlocal running
        logger.info("SIGTERM received — shutting down gracefully.")
        running = False

    signal.signal(signal.SIGTERM, _sigterm_handler)

    consecutive_errors = 0

    while running:
        cycle_start = time.time()
        try:
            run_once(influx, model)
            consecutive_errors = 0
        except KeyboardInterrupt:
            logger.info("KeyboardInterrupt — stopping.")
            break
        except Exception as exc:
            consecutive_errors += 1
            wait = min(RETRY_DELAY_S * consecutive_errors, 120)
            logger.error(f"Prediction cycle failed (attempt {consecutive_errors}): {exc}")
            logger.debug(traceback.format_exc())
            if consecutive_errors >= MAX_RETRIES * 3:
                logger.critical("Too many consecutive failures. Check InfluxDB connection.")
            logger.info(f"  Retrying in {wait}s ...")
            time.sleep(wait)
            continue

        elapsed = time.time() - cycle_start
        sleep   = max(0, POLL_INTERVAL_S - elapsed)
        time.sleep(sleep)

    logger.info("Prediction loop stopped.")


def run_backfill(influx: InfluxManager, model: FrostModel):
    """
    Re-predict the last BACKFILL_HOURS of historical sensor data.
    Useful after a service restart or model upgrade.
    """
    logger.info(f"Starting backfill for last {BACKFILL_HOURS} hours ...")
    stop  = datetime.utcnow()
    start = stop - timedelta(hours=BACKFILL_HOURS)

    # Process in 1-hour chunks to stay within memory limits on Pi
    chunk_size = timedelta(hours=1)
    current    = start
    total_rows = 0

    while current < stop:
        chunk_end = min(current + chunk_size, stop)
        try:
            raw_df = influx.fetch_range(current, chunk_end)
            if raw_df.empty:
                logger.info(f"  No data: {current} → {chunk_end}")
                current = chunk_end
                continue

            raw_df   = estimate_outdoor_features(raw_df)
            if 'wind_speed_kmh' not in raw_df.columns:
                raw_df['wind_speed_kmh'] = raw_df['wind_speed_ms'] * 3.6
            feat_df  = engineer_features(raw_df)
            risks, probs = model.predict(feat_df)
            influx.write_predictions(feat_df, risks, probs)
            total_rows += len(feat_df)
            logger.info(f"  Backfilled {len(feat_df)} rows  ({current} → {chunk_end})")
        except Exception as exc:
            logger.error(f"  Backfill chunk failed ({current}): {exc}")

        current = chunk_end

    logger.info(f"Backfill complete — {total_rows} total rows processed.")


# =============================================================================
# SECTION 7 — ENTRYPOINT
# =============================================================================

def parse_args():
    parser = argparse.ArgumentParser(
        description="AAgriControl Frost Detection — InfluxDB Deployment"
    )
    parser.add_argument(
        "--loop",     action="store_true",
        help="Run continuously every POLL_INTERVAL_S seconds (default: run once)",
    )
    parser.add_argument(
        "--backfill", action="store_true",
        help=f"Re-predict last {BACKFILL_HOURS} h of existing sensor data",
    )
    parser.add_argument(
        "--model",    type=str, default=None,
        help="Override model path (default from .env or config)",
    )
    parser.add_argument(
        "--dry-run",  action="store_true",
        help="Fetch and predict but do NOT write results back to InfluxDB",
    )
    return parser.parse_args()


def main():
    args = parse_args()

    logger.info("=" * 68)
    logger.info("  AgriControl Frost Detector — Step 4: Deployment")
    logger.info(f"  InfluxDB : {INFLUX_URL}  org={INFLUX_ORG}")
    logger.info(f"  Input    : {INPUT_BUCKET}/{INPUT_MEASUREMENT}")
    logger.info(f"  Output   : {OUTPUT_BUCKET}/{OUTPUT_MEASUREMENT}")
    logger.info(f"  Model    : {MODEL_PATH.name}")
    logger.info("=" * 68)

    # Token guard
    if INFLUX_TOKEN == "REPLACE_WITH_YOUR_TOKEN":
        logger.error(
            "InfluxDB token not set!\n"
            "  Option 1: Edit frost-detector.env and set INFLUX_TOKEN=your_actual_token\n"
            "  Option 2: export INFLUX_TOKEN=your_actual_token\n"
            "  Generate a token in InfluxDB UI → Data → API Tokens → Generate."
        )
        sys.exit(1)

    # ── Load model ─────────────────────────────────────────────────────────────
    model_path = Path(args.model) if args.model else MODEL_PATH
    try:
        model = FrostModel(model_path)
    except FileNotFoundError as e:
        logger.error(str(e))
        sys.exit(1)

    # ── Connect to InfluxDB ────────────────────────────────────────────────────
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            influx = InfluxManager()
            break
        except Exception as exc:
            logger.error(f"InfluxDB connection attempt {attempt}/{MAX_RETRIES}: {exc}")
            if attempt == MAX_RETRIES:
                logger.critical("Cannot connect to InfluxDB. Check INFLUX_URL and token.")
                sys.exit(1)
            time.sleep(RETRY_DELAY_S)

    # ── Dry-run monkey-patch ──────────────────────────────────────────────────
    if args.dry_run:
        logger.warning("DRY RUN mode: predictions will NOT be written to InfluxDB.")
        influx.write_predictions = lambda *a, **kw: logger.info("  [dry-run] write skipped")

    # ── Run ───────────────────────────────────────────────────────────────────
    try:
        if args.backfill:
            run_backfill(influx, model)
        elif args.loop:
            run_loop(influx, model)
        else:
            summary = run_once(influx, model)
            logger.info(f"Single run complete: {summary}")
    finally:
        influx.close()
        logger.info("InfluxDB connection closed.")


if __name__ == "__main__":
    main()
