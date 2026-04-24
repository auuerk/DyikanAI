"""
mqtt_to_influx.py  —  AgriControl, Schema v2
=============================================
Subscribes to greenhouse/mega1/telemetry and routes incoming payloads
to two separate InfluxDB measurements:

    sensor_readings  — all environmental sensor fields
    actuator_states  — relay state fields (pump, lamp, heater, fan)

Firmware v1.3 sends split payloads on the same topic:
    - sensor payload  (every 30 s): contains sensor keys only
    - actuator payload (every 2 s): contains actuator keys only
    - mixed payload   (legacy):     both sets in one message

All three payload types are handled correctly. Partial messages are
no longer rejected — each present field set is written independently.

Calibration applied at write time
──────────────────────────────────
  air_temp_c      : stored as-is — DHT11 -0.3 °C offset is applied in
                    firmware v1.3 before publishing (Progress Report #6).
                    AIR_TEMP_BIAS_C = 0.0 here to avoid double-correction.

  soil_moisture_pct: 4-point piecewise linear interpolation using
                    gravimetric calibration curve for Sensor 1 in peat
                    soil (documented in Progress Report #5).
                    Calibration points (ADC → %):
                        600 → 0 %    (dry in air)
                        500 → 20 %
                        380 → 40 %
                        277 → 60 %   (peat saturation limit)
                    Values outside the calibrated range are clamped.
                    Both soil_moisture_raw and soil_moisture_pct are
                    stored: raw for auditability, pct for control logic.
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

DEVICE_ID = os.getenv('DEVICE_ID', 'mega-1')
SITE      = os.getenv('SITE',      'lab')

# ── Calibration constants ─────────────────────────────────────────────────────
# DHT11 offset: correction is applied in firmware v1.3 before publishing.
# air_temp_c arrives at the Pi already offset-corrected (-0.3 °C applied
# in firmware, documented in Progress Report #6). Do NOT apply again here.
# Constant kept at 0.0 to make this decision explicit and auditable.
AIR_TEMP_BIAS_C = 0.0

# 4-point piecewise linear calibration for Sensor 1, peat soil
# Determined by gravimetric method — documented in Progress Report #5
# Format: (ADC_value, moisture_pct)  — must be ordered high-to-low ADC
#
# Raw calibration data (Sensor 1, bag-direct gravimetric method):
#   Point 1:  0 ml →  0%  → ADC 427  (dry baseline)
#   Point 2: 20 ml → 20%  → ADC 402
#   Point 3: 40 ml → 40%  → ADC 313  (largest single drop)
#   Point 4: 60 ml → 60%  → ADC 199  (peat saturation threshold)
#   Point 5: 70 ml → ~80% → ADC 196  (no meaningful change — excluded)
#
# Point 5 excluded: ADC change of 3 counts is within sensor noise floor.
# Peat soil saturates at 60 ml/100 g; additional water produces no
# measurable capacitance change. Maximum reportable moisture is 60%.
SOIL_CAL_POINTS = [
    (427, 0.0),
    (402, 20.0),
    (313, 40.0),
    (199, 60.0),
]

# Field routing
SENSOR_FIELDS   = {'air_temp_c', 'air_humidity_pct', 'soil_moisture_raw',
                   'soil_temp_c', 'light_raw'}
ACTUATOR_FIELDS = {'pump', 'lamp', 'heater', 'fan'}

# ── InfluxDB client ───────────────────────────────────────────────────────────
if not INFLUX_TOKEN or not INFLUX_ORG:
    raise RuntimeError("Missing INFLUX_TOKEN or INFLUX_ORG in .env")

influx    = InfluxDBClient(url=INFLUX_URL, token=INFLUX_TOKEN, org=INFLUX_ORG)
write_api = influx.write_api(write_options=SYNCHRONOUS)


# ── Calibration functions ─────────────────────────────────────────────────────
def calc_soil_moisture_pct(raw: int) -> float:
    """
    Convert raw ADC value to calibrated soil moisture percentage using
    a 4-point piecewise linear interpolation.

    Calibration curve (Sensor 1, peat soil, gravimetric method):
        ADC 427 → 0 %   (dry baseline)
        ADC 402 → 20 %
        ADC 313 → 40 %
        ADC 199 → 60 %  (peat saturation limit — point 5 at 70 ml
                          excluded: only 3 ADC counts change, within
                          noise floor; no meaningful moisture increase)

    Note: ADC decreases as moisture increases (capacitive sensor behaviour).
    Values outside the calibrated ADC range are clamped to 0–60 %.
    """
    # Clamp to calibrated range
    if raw >= SOIL_CAL_POINTS[0][0]:
        return SOIL_CAL_POINTS[0][1]   # 0.0 % — at or above dry-air reading
    if raw <= SOIL_CAL_POINTS[-1][0]:
        return SOIL_CAL_POINTS[-1][1]  # 60.0 % — at or below saturation

    # Find the surrounding segment and interpolate
    for i in range(len(SOIL_CAL_POINTS) - 1):
        adc_hi, pct_lo = SOIL_CAL_POINTS[i]
        adc_lo, pct_hi = SOIL_CAL_POINTS[i + 1]
        if adc_lo <= raw <= adc_hi:
            # Linear interpolation within this segment
            fraction = (adc_hi - raw) / (adc_hi - adc_lo)
            pct = pct_lo + fraction * (pct_hi - pct_lo)
            return round(pct, 1)

    return 0.0  # Should not reach here given the clamp above


# ── InfluxDB write functions ───────────────────────────────────────────────────
def write_sensors(data: dict, ts: datetime) -> None:
    """Write sensor fields to the sensor_readings measurement."""
    p = (
        Point('sensor_readings')
        .tag('device', DEVICE_ID)
        .tag('site',   SITE)
        .time(ts, WritePrecision.NS)
    )

    # air_temp_c: apply DHT11 calibration offset
    raw_temp = data.get('air_temp_c')
    if raw_temp is not None:
        try:
            p = p.field('air_temp_c', round(float(raw_temp) + AIR_TEMP_BIAS_C, 2))
        except (ValueError, TypeError):
            print(f'[WARN] Invalid air_temp_c: {raw_temp}')

    # Remaining sensor fields — stored as-is
    for field, cast in [('air_humidity_pct', float),
                        ('soil_moisture_raw', int),
                        ('soil_temp_c',       float),
                        ('light_raw',         float)]:
        val = data.get(field)
        if val is not None:
            try:
                p = p.field(field, cast(val))
            except (ValueError, TypeError):
                print(f'[WARN] Invalid {field}: {val}')

    # soil_moisture_pct — computed from raw ADC using calibration curve
    raw_soil = data.get('soil_moisture_raw')
    if raw_soil is not None:
        try:
            p = p.field('soil_moisture_pct', calc_soil_moisture_pct(int(raw_soil)))
        except (ValueError, TypeError):
            print(f'[WARN] Could not compute soil_moisture_pct from raw: {raw_soil}')

    write_api.write(bucket=INFLUX_BUCKET, org=INFLUX_ORG, record=p)


def write_actuators(data: dict, ts: datetime) -> None:
    """Write actuator relay states to the actuator_states measurement."""
    p = (
        Point('actuator_states')
        .tag('device', DEVICE_ID)
        .tag('site',   SITE)
        .time(ts, WritePrecision.NS)
    )
    for act in ('pump', 'lamp', 'heater', 'fan'):
        val = data.get(act)
        if val is not None:
            try:
                p = p.field(act, int(val))
            except (ValueError, TypeError):
                print(f'[WARN] Invalid actuator state {act}: {val}')

    write_api.write(bucket=INFLUX_BUCKET, org=INFLUX_ORG, record=p)


# ── MQTT callbacks ────────────────────────────────────────────────────────────
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

        has_sensors   = bool(SENSOR_FIELDS   & data.keys())
        has_actuators = bool(ACTUATOR_FIELDS & data.keys())

        if not has_sensors and not has_actuators:
            print(f'[WARN] Message contains no recognised fields: {list(data.keys())}')
            return

        if has_sensors:
            write_sensors(data, ts)

        if has_actuators:
            write_actuators(data, ts)

        # Compact log line
        parts = []
        if has_sensors:
            temp_raw = data.get('air_temp_c')
            temp_cal = round(float(temp_raw) + AIR_TEMP_BIAS_C, 1) if temp_raw is not None else '—'
            soil_raw = data.get('soil_moisture_raw')
            soil_pct = calc_soil_moisture_pct(int(soil_raw)) if soil_raw is not None else '—'
            parts.append(f'air={temp_cal}°C hum={data.get("air_humidity_pct","—")}% '
                         f'soil_raw={soil_raw} soil_pct={soil_pct}% '
                         f'light={data.get("light_raw","—")}')
        if has_actuators:
            parts.append(f'pump={data.get("pump","—")} lamp={data.get("lamp","—")} '
                         f'heater={data.get("heater","—")} fan={data.get("fan","—")}')

        print(f'[OK] {" | ".join(parts)}')

    except json.JSONDecodeError as e:
        print(f'[ERR] JSON decode failed: {e}')
    except Exception as e:
        print(f'[ERR] {e}')


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    client.on_connect = on_connect
    client.on_message = on_message

    print(f'[INIT] Connecting to MQTT broker at {MQTT_HOST}:{MQTT_PORT}')
    print(f'[INIT] Topic: {MQTT_TOPIC}')
    print(f'[INIT] InfluxDB: {INFLUX_URL} / bucket: {INFLUX_BUCKET}')
    print(f'[INIT] Device: {DEVICE_ID} @ {SITE}')
    print(f'[INIT] Soil calibration: 4-point piecewise (427→0%, 402→20%, 313→40%, 199→60%)')
    print(f'[INIT] DHT11 bias: applied in firmware v1.3 — no correction at write time')
    print('-' * 60)

    client.connect(MQTT_HOST, MQTT_PORT, keepalive=60)
    client.loop_forever()


if __name__ == '__main__':
    main()
