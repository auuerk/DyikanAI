"""
filter_engine.py  —  AgriControl, Kalman Filter Engine
========================================================
Subscribes to the same MQTT telemetry topic as mqtt_to_influx.py
and automation_engine.py. For each incoming sensor payload, applies
an independent 1-D Kalman filter to each sensor channel and writes
the filtered estimates to a separate InfluxDB measurement:

    sensor_readings_filt  (within bucket: gh_sensor_data)

Architecture
─────────────
    Arduino → MQTT → mqtt_to_influx.py   → sensor_readings      (raw, calibrated)
                   → filter_engine.py    → sensor_readings_filt  (filtered)
                   → automation_engine.py → actuator commands    (from raw)

Automation reads raw values deliberately — filter latency must not
affect time-critical relay decisions. Filtered values are consumed
by the dashboard and reporting layer for cleaner trend visualisation.

Kalman filter — 1-D scalar implementation
──────────────────────────────────────────
State: x_hat  — current estimate of the true physical value
Covariance: P — estimate uncertainty

Predict:
    x_hat_prior = x_hat                  (no dynamics model — assume constant)
    P_prior     = P + Q                  (uncertainty grows between measurements)

Update:
    K      = P_prior / (P_prior + R)     (Kalman gain)
    x_hat  = x_hat_prior + K * (z - x_hat_prior)   (fuse measurement z)
    P      = (1 - K) * P_prior

Parameters
──────────
    Q  —  process noise covariance. Represents how much the true value
          is expected to change between measurements. Higher Q = filter
          trusts new measurements more = less smoothing.

    R  —  measurement noise covariance. Represents sensor noise variance.
          Higher R = filter trusts measurements less = more smoothing.

    The ratio R/Q controls the smoothing strength:
        High R/Q  → heavy smoothing, slow to follow real changes
        Low  R/Q  → light smoothing, fast to follow real changes

Tuning rationale (documented for Progress Report #9)
──────────────────────────────────────────────────────
    air_temp_c:
        DHT11 resolution: 0.1°C steps. Typical reading-to-reading jitter
        from quantisation and thermal lag: ±0.2°C. R = 0.04 (0.2²).
        True temperature changes slowly in a greenhouse — Q = 0.01.
        R/Q = 4 → moderate smoothing. Preserves genuine temperature trends
        while suppressing quantisation noise.

    air_humidity_pct:
        DHT11 humidity resolution: 1% RH steps. Jitter: ±1–2%.
        R = 1.0 (1.0²). Humidity changes slowly — Q = 0.1.
        R/Q = 10 → heavier smoothing than temperature.

    soil_moisture_pct:
        Capacitive sensor ADC jitter converts to ±1–2% at the calibrated
        output. Soil moisture is the slowest-changing variable — between
        readings it barely moves. R = 1.0, Q = 0.01.
        R/Q = 100 → strong smoothing. Removes pump-trigger noise.

    soil_moisture_raw:
        Raw ADC value — not clamped, unlike soil_moisture_pct.
        Jitter: ±3–5 ADC counts. Q=1.0 allows slow drift tracking.
        R=9.0 suppresses noise. Stored as int in InfluxDB.
        Useful for calibration audit and debugging without the 0% clamp.

    light_raw:
        TEMT6000 ADC jitter: ±3–5 counts at stable illumination.
        Light can change quickly (cloud shadow, lamp switch). R = 9.0 (3²).
        Q = 2.0 — higher than other sensors to allow rapid tracking.
        R/Q = 4.5 → light smoothing, responsive to real changes.

    soil_temp_c:
        DS18B20 resolution: 0.0625°C. Noise is very low. Soil temperature
        is the most stable of all channels. R = 0.01, Q = 0.001.
        R/Q = 10 → moderate smoothing on an already clean signal.
"""

import os
import json
from datetime import datetime, timezone

import paho.mqtt.client as mqtt
from influxdb_client import InfluxDBClient, Point, WritePrecision
from influxdb_client.client.write_api import SYNCHRONOUS
from dotenv import load_dotenv

load_dotenv()

# ── Configuration ─────────────────────────────────────────────────────────────
MQTT_HOST  = os.getenv('MQTT_HOST',  'localhost')
MQTT_PORT  = int(os.getenv('MQTT_PORT', '1883'))
MQTT_TOPIC = os.getenv('MQTT_TOPIC_TELEMETRY', 'greenhouse/mega1/telemetry')

INFLUX_URL    = os.getenv('INFLUX_URL',    'http://localhost:8086')
INFLUX_TOKEN  = os.getenv('INFLUX_TOKEN')
INFLUX_ORG    = os.getenv('INFLUX_ORG')
INFLUX_BUCKET = os.getenv('INFLUX_BUCKET', 'gh_sensor_data')
DEVICE_ID     = os.getenv('DEVICE_ID',     'mega-1')
SITE          = os.getenv('SITE',          'lab')

OUTPUT_MEASUREMENT = 'sensor_readings_filt'

# ── Kalman filter parameters ──────────────────────────────────────────────────
# Each entry: (Q, R, initial_P)
# Q: process noise  — how much the true value changes between readings
# R: measurement noise — sensor noise variance
# initial_P: starting estimate uncertainty (set high = trust first reading less)
#
# Tuning rationale documented in module docstring above.
KALMAN_PARAMS = {
    'air_temp_c':        {'Q': 0.01,  'R': 0.04, 'P0': 1.0},
    'air_humidity_pct':  {'Q': 0.1,   'R': 1.0,  'P0': 1.0},
    'soil_moisture_pct': {'Q': 0.01,  'R': 1.0,  'P0': 1.0},
    'soil_moisture_raw': {'Q': 1.0,   'R': 9.0,  'P0': 10.0},  # ADC counts
    'soil_temp_c':       {'Q': 0.001, 'R': 0.01, 'P0': 1.0},
    'light_raw':         {'Q': 2.0,   'R': 9.0,  'P0': 10.0},
}

SENSOR_FIELDS = set(KALMAN_PARAMS.keys())


# ── Kalman filter state ───────────────────────────────────────────────────────
class KalmanChannel:
    """
    1-D scalar Kalman filter for a single sensor channel.
    Initialised on first measurement — no prior assumption about the
    true value is needed. P0 controls how quickly the filter converges
    from the first reading.
    """
    def __init__(self, Q: float, R: float, P0: float):
        self.Q        = Q
        self.R        = R
        self.P        = P0
        self.x_hat    = None   # None until first measurement arrives
        self.n_updates = 0

    def update(self, z: float) -> float:
        """
        Fuse a new measurement z and return the updated filtered estimate.
        On the first call, initialises the state to z (cold start).
        """
        if self.x_hat is None:
            # Cold start: set estimate to first measurement
            self.x_hat = z
            self.n_updates = 1
            return self.x_hat

        # Predict
        x_prior = self.x_hat
        P_prior = self.P + self.Q

        # Update (Kalman gain)
        K          = P_prior / (P_prior + self.R)
        self.x_hat = x_prior + K * (z - x_prior)
        self.P     = (1.0 - K) * P_prior
        self.n_updates += 1

        return self.x_hat

    @property
    def gain(self) -> float:
        """Current Kalman gain — useful for diagnostics."""
        P_prior = self.P + self.Q
        return P_prior / (P_prior + self.R)


# Initialise one filter channel per sensor
filters: dict[str, KalmanChannel] = {
    field: KalmanChannel(**params)
    for field, params in KALMAN_PARAMS.items()
}


# ── InfluxDB ──────────────────────────────────────────────────────────────────
if not INFLUX_TOKEN or not INFLUX_ORG:
    raise RuntimeError("Missing INFLUX_TOKEN or INFLUX_ORG in .env")

influx    = InfluxDBClient(url=INFLUX_URL, token=INFLUX_TOKEN, org=INFLUX_ORG)
write_api = influx.write_api(write_options=SYNCHRONOUS)


def write_filtered(estimates: dict, ts: datetime) -> None:
    """Write filtered sensor estimates to sensor_readings_filt measurement."""
    p = (
        Point(OUTPUT_MEASUREMENT)
        .tag('device', DEVICE_ID)
        .tag('site',   SITE)
        .time(ts, WritePrecision.NS)
    )
    for field, value in estimates.items():
        if value is not None:
            if field == 'soil_moisture_raw':
                # Store as int — raw ADC value, no clamping applied
                p = p.field(field, int(round(float(value))))
            elif field == 'soil_moisture_pct':
                # Clamp: filter can drift slightly outside 0–60% range
                p = p.field(field, round(max(0.0, min(60.0, float(value))), 1))
            elif field in ('soil_temp_c', 'light_raw'):
                p = p.field(field, float(value))
            else:
                p = p.field(field, round(float(value), 2))

    write_api.write(bucket=INFLUX_BUCKET, org=INFLUX_ORG, record=p)


# ── MQTT ──────────────────────────────────────────────────────────────────────
def on_connect(client, userdata, flags, rc, properties=None):
    if rc == 0:
        print(f'[MQTT] Connected. Subscribing to: {MQTT_TOPIC}')
        client.subscribe(MQTT_TOPIC, qos=0)
    else:
        print(f'[MQTT] Connection failed rc={rc}')


def on_message(client, userdata, msg):
    try:
        data = json.loads(msg.payload.decode('utf-8', errors='strict'))
        ts   = datetime.now(timezone.utc)

        # Only process messages that contain at least one sensor field
        present = SENSOR_FIELDS & data.keys()
        if not present:
            return

        estimates = {}
        log_parts = []

        for field in SENSOR_FIELDS:
            raw_val = data.get(field)
            if raw_val is None:
                continue
            try:
                z        = float(raw_val)
                filtered = filters[field].update(z)
                estimates[field] = filtered

                # Compact log: show raw → filtered for each channel
                log_parts.append(
                    f'{field}={z:.1f}→{filtered:.2f}'
                    f'(K={filters[field].gain:.3f})'
                )
            except (ValueError, TypeError) as e:
                print(f'[WARN] {field}: {e}')

        if estimates:
            write_filtered(estimates, ts)
            print(f'[FILT] {" | ".join(log_parts)}')

    except json.JSONDecodeError as e:
        print(f'[ERR] JSON decode: {e}')
    except Exception as e:
        print(f'[ERR] {e}')


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    print('=' * 60)
    print(' AgriControl — Kalman Filter Engine')
    print('=' * 60)
    print(f'  MQTT:        {MQTT_HOST}:{MQTT_PORT}')
    print(f'  Topic:       {MQTT_TOPIC}')
    print(f'  InfluxDB:    {INFLUX_URL} / {INFLUX_BUCKET}')
    print(f'  Output:      {OUTPUT_MEASUREMENT}')
    print()
    print('  Filter parameters (Q / R / R÷Q):')
    for field, params in KALMAN_PARAMS.items():
        ratio = params['R'] / params['Q']
        print(f'    {field:<22} Q={params["Q"]}  R={params["R"]}  '
              f'R/Q={ratio:.0f}  ({"heavy" if ratio > 20 else "moderate" if ratio > 5 else "light"} smoothing)')
    print('=' * 60)

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2,
                         client_id='filter_engine')
    client.on_connect = on_connect
    client.on_message = on_message

    client.connect(MQTT_HOST, MQTT_PORT, keepalive=60)
    client.loop_forever()


if __name__ == '__main__':
    main()
