# DyikanAI — Edge Node & Backend Layer

> **DyikanAI Smart Greenhouse System**  
> University of Central Asia · Naryn, Kyrgyzstan · 2026  
> Author: Aruuke Sanzharbekova (edge/backend layer)  
> Supervisors: Dr. Dmytro Zubov · Dr. Muhammad Fayaz

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [System Architecture](#2-system-architecture)
3. [Hardware](#3-hardware)
4. [Sensor Calibration](#4-sensor-calibration)
5. [Data Pipeline](#5-data-pipeline)
6. [Kalman Filter](#6-kalman-filter)
7. [Flask REST API](#7-flask-rest-api)
8. [Automation Engine](#8-automation-engine)
9. [Cybersecurity](#9-cybersecurity)
10. [Performance Results](#10-performance-results)
11. [Setup & Deployment](#11-setup--deployment)
12. [Repository Structure](#12-repository-structure)

---

## 1. Project Overview

AgriControl / DyikanAI is a low-cost, open-source smart greenhouse monitoring and control system designed for small-scale greenhouse operators in Central Asia and other resource-constrained regions. Most commercial greenhouse automation systems cost $50,000–$500,000 USD, require cloud subscriptions, and are not adapted to local climate conditions. This system runs entirely on local hardware for under $100 USD, works without internet connectivity, and was designed and tested in Naryn, Kyrgyzstan.

The project is a three-person collaboration, split into three layers:

| Layer | Owner | Scope |
|-------|-------|-------|
| **Edge / Backend** | Aruuke (this repository) | Hardware, sensors, MQTT pipeline, InfluxDB, Kalman filtering, calibration, Flask API, cybersecurity |
| Fog / Control | Saadat | Mamdani fuzzy logic controller (FLC), actuator decision logic |
| AI / Interface | Alfiia | XGBoost frost detection, ML analytics, dashboard, AI chatbot |

**This repository covers the edge and backend layer only.** The frost detector and FLC engine are included here because they integrate directly with this layer's infrastructure, but their internal logic belongs to their respective authors.

---

## 2. System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        RASPBERRY PI 400                             │
│                    192.168.1.101  ·  smartgreenhouse                │
│                                                                     │
│  ┌──────────────┐   ┌──────────────┐   ┌───────────────────────┐   │
│  │   Mosquitto  │   │  InfluxDB 2.x│   │     Flask API v2      │   │
│  │  MQTT Broker │   │  port 8086   │   │     port 5000         │   │
│  │  port 1883   │   │              │   │     11 endpoints      │   │
│  │  auth + ACLs │   │ gh_sensor_   │   │                       │   │
│  └──────┬───────┘   │    data      │   └───────────┬───────────┘   │
│         │           └──────┬───────┘               │               │
│    ┌────┴──────────────────┼───────────────────┐   │               │
│    │                       │                   │   │               │
│  ┌─▼──────────────┐  ┌────▼────────┐  ┌───────▼───────────────┐   │
│  │mqtt_to_influx  │  │filter_engine│  │  automation_engine    │   │
│  │    .py         │  │    .py      │  │  .py (v3 threshold)   │   │
│  │                │  │             │  │  ── or ──             │   │
│  │ Routes payloads│  │ Kalman 5ch  │  │  automation_engine    │   │
│  │ Calibrates soil│  │ Writes _filt│  │  _flc.py (Saadat FLC) │   │
│  │ Writes InfluxDB│  │             │  │  switched via .sh     │   │
│  └────────────────┘  └─────────────┘  └───────────────────────┘   │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │       frost-detector.service  (Alfiia — integrated here)     │  │
│  │  XGBoost · reads sensor_readings_filt · writes               │  │
│  │  frost_probability to gh_frost_predictions bucket            │  │
│  └──────────────────────────────────────────────────────────────┘  │
└───────────────────────────┬─────────────────────────────────────────┘
                            │ MQTT over Ethernet
                            │ username + password auth
                            │
            ┌───────────────▼────────────────┐
            │       ARDUINO MEGA 2560         │
            │    192.168.1.102  ·  fw v1.3    │
            │                                 │
            │  Publishes → telemetry (30s)    │
            │  Publishes → actuator state (2s)│
            │  Subscribes ← commands          │
            │                                 │
            │  SENSORS          ACTUATORS     │
            │  DHT11  D42       Pump   D39    │
            │  DS18B20 D48      Lamp   D47    │
            │  Soil   A12       Heater D41    │
            │  Light  A13       Fan    D43    │
            └─────────────────────────────────┘
```

### Data Flow

```
Sensor reading (hardware)
        │
        ▼
Arduino firmware
  · 10-sample ADC averaging
  · DHT11 offset correction (−0.3°C)
  · Soil moisture piecewise calibration
        │
        ▼  MQTT publish  greenhouse/mega1/telemetry
        │
        ├──► mqtt_to_influx.py ──► sensor_readings    (InfluxDB, every 30s)
        │                      ──► actuator_states    (InfluxDB, every 2s)
        │
        └──► filter_engine.py  ──► sensor_readings_filt (InfluxDB, every 30s)
                                              │
                                              ▼
                                  Flask API /api/sensors/latest
                                  Flask API /api/sensors/comparison
                                  Flask API /api/actuators/gantt
                                              │
                                              ▼
                                         Dashboard
```

### MQTT Topic Schema

```
greenhouse/
└── mega1/
    ├── telemetry    Arduino → Pi  (sensor payload 30s, actuator payload 2s)
    └── command      Pi → Arduino  (actuator control commands)

greenhouse/
└── automation/
    └── status       automation_engine → flask_api (state synchronisation)
```

---

## 3. Hardware

### Microcontroller — Arduino Mega 2560

The Arduino Mega was selected over smaller boards (ESP8266, Uno) for three reasons: it provides sufficient analog input pins for multiple sensors simultaneously, stable 5V logic compatible with all connected components, and enough digital I/O for 4 relay channels alongside the Ethernet shield pins.

| Component | Detail |
|-----------|--------|
| Board | Arduino Mega 2560 |
| Network | W5100 Ethernet Shield — wired LAN preferred over WiFi for 24/7 reliability |
| Firmware | v1.3 |
| IP address | 192.168.1.102 (static) |
| MQTT library | PubSubClient |

### Sensor Suite

| Sensor | Measured parameter | Pin | Key notes |
|--------|-------------------|-----|-----------|
| DHT11 | Air temperature, humidity | D42 | Factory ±2°C, ±5%RH. Fixed offset −0.3°C applied in firmware. |
| DS18B20 | Soil temperature | D48 | Digital 1-Wire. ±0.5°C factory spec. No correction needed. |
| Capacitive v1.2 | Soil moisture | A12 | Preferred over resistive sensors — longer lifespan, no corrosion in wet soil. 4-point piecewise calibration applied. |
| TEMT6000 | Ambient light | A13 | Raw ADC published to InfluxDB as monitoring channel only. Not used for lamp control — sensor saturates when proximal to phytolamp. |

### Actuator Suite

| Actuator | Relay pin | Control notes |
|----------|-----------|---------------|
| Water pump | D39 | 4s activation, 120min cooldown, 10s firmware safety cutoff |
| Phytolamp | D47 | Schedule only: 06:00–22:00 |
| Heater | D41 | Threshold: ON below 20°C, OFF above 22°C |
| Fan | D43 | Threshold: ON above 26°C or above 85% humidity |

> **Relay logic throughout this codebase:** `HIGH = ON`, `LOW = OFF`

### Firmware Design Decisions

**Split MQTT payloads:** The firmware publishes two separate JSON payloads on the same telemetry topic — a sensor payload every 30 seconds and an actuator state payload every 2 seconds. This design keeps the dashboard responsive to actuator changes without flooding InfluxDB with redundant sensor readings. All backend services handle both payload types independently and never overwrite one with the other.

**10-second hardware pump cutoff:** The firmware implements a hardware-level pump safety timer independent of any Pi-side logic. Even if the Pi fails to send an OFF command, the pump stops after 10 seconds. This is the innermost safety layer of a four-layer pump protection stack.

**ADC averaging:** Each analog reading is the mean of 10 rapid samples to reduce ADC jitter before calibration and publishing.

---

## 4. Sensor Calibration

Full calibration methodology is documented in Progress Reports #5 (soil moisture) and #6 (temperature). All calibration used gravimetric reference methods.

### DHT11 Temperature Offset

The specific DHT11 unit used reads +0.3°C above a calibrated stirring thermometer reference (−10 to +110°C, ISO-traceable). A fixed correction of −0.3°C is applied in firmware. The uncorrected raw value is never stored or published anywhere in the system.

```cpp
#define DHT11_TEMP_OFFSET  -0.3f
lastAirTemp = dht.readTemperature() + DHT11_TEMP_OFFSET;
```

### Soil Moisture — 4-Point Piecewise Linear Calibration

Capacitive sensors produce a raw ADC value that decreases non-linearly as moisture increases. The relationship is soil-type dependent and cannot be generalised across different soils or sensor units.

**Calibration method:** Four peat soil samples were prepared at known moisture levels (0%, 20%, 40%, 60% gravimetric water content). Each level was measured with an ISO analytical balance and graduated cylinder. The mean of 10 ADC readings was recorded per level per sensor unit.

**Calibration results:**

| Moisture % | Sensor 1 ADC (primary) | Sensor 2 ADC (cross-validation) | Δ between units |
|------------|------------------------|----------------------------------|-----------------|
| 0% (dry)   | 427                    | 443                              | 16              |
| 20%        | 402                    | 349                              | 53              |
| 40%        | 313                    | 204                              | 109             |
| 60% (sat.) | 199                    | 146                              | 53              |

**Key findings from calibration:**

**1. Saturation at 60%** — peat soil reaches physical water saturation at 60% gravimetric moisture content. The ADC does not meaningfully change above this point. The calibration range is 0–60%, not 0–100%. The automation engine uses 55% as the saturation lockout threshold (slightly below the physical limit) to prevent over-irrigation.

**2. Inter-sensor variability is large** — the two units differ by up to 109 ADC counts at the same moisture level (at 40%). A single universal calibration curve cannot represent both sensors accurately. Individual unit calibration is mandatory.

**3. Non-linear response** — the ADC drop per percentage point is largest in the 20–40% range. Arduino's `map()` function assumes linearity and would introduce significant error. Piecewise linear interpolation between the four measured points is used instead.

**Implementation (identical in firmware, mqtt_to_influx.py, and both automation engines):**

```python
SOIL_CAL_POINTS = [(427, 0.0), (402, 20.0), (313, 40.0), (199, 60.0)]

def raw_to_pct(raw):
    if raw >= 427: return 0.0
    if raw <= 199: return 60.0
    for i in range(len(SOIL_CAL_POINTS) - 1):
        adc_hi, pct_lo = SOIL_CAL_POINTS[i]
        adc_lo, pct_hi = SOIL_CAL_POINTS[i + 1]
        if adc_lo <= raw <= adc_hi:
            fraction = (adc_hi - raw) / (adc_hi - adc_lo)
            return round(pct_lo + fraction * (pct_hi - pct_lo), 1)
```

Using the identical calibration function across all components ensures that a `soil_moisture_pct` value means the same thing everywhere — from the Arduino sensor read through the automation threshold comparison to the dashboard display.

---

## 5. Data Pipeline

### mqtt_to_influx.py

The MQTT-to-InfluxDB bridge. Subscribes to the telemetry topic, routes the split payloads to separate InfluxDB measurements, and applies soil moisture calibration before writing.

**Payload routing:**

```
Incoming telemetry on greenhouse/mega1/telemetry
        │
        ├── contains {air_temp_c, air_humidity_pct, ...}?
        │   YES → write to sensor_readings measurement
        │         fields: air_temp_c, air_humidity_pct, soil_moisture_raw,
        │                 soil_moisture_pct, soil_temp_c, light_raw
        │         tags:   device=mega-1
        │
        └── contains {pump, lamp, heater, fan}?
            YES → write to actuator_states measurement
                  fields: pump, lamp, heater, fan (int 0/1)
                  tags:   device=mega-1, source=manual|automation
```

The separation ensures that the high-frequency actuator publishes (every 2s) do not create null-filled rows in the sensor_readings measurement, and that slow sensor reads (every 30s) do not appear as gaps in the actuator timeline.

### filter_engine.py

Runs as a separate systemd service. Subscribes to the same telemetry topic, maintains Kalman filter state for 5 channels, and writes smoothed estimates to the `sensor_readings_filt` measurement. See [Section 6](#6-kalman-filter) for full detail.

### InfluxDB Schema

**Bucket: `gh_sensor_data`**

```
measurement: sensor_readings
  tags:   device=mega-1
  fields: air_temp_c (float)       — DHT11, offset-corrected
          air_humidity_pct (float)  — DHT11, uncorrected
          soil_moisture_raw (int)   — ADC counts, 10-sample average
          soil_moisture_pct (float) — calibrated, 0–60% range
          soil_temp_c (float)       — DS18B20, no correction
          light_raw (int)           — TEMT6000, raw ADC
  interval: ~30 seconds

measurement: sensor_readings_filt
  tags:   device=mega-1
  fields: same 6 fields — Kalman-filtered estimates
  interval: ~30 seconds

measurement: actuator_states
  tags:   device=mega-1
          source=manual|automation
  fields: pump (int 0/1), lamp (int 0/1),
          heater (int 0/1), fan (int 0/1)
  interval: ~2 seconds
```

**Bucket: `gh_frost_predictions`** *(written by Alfiia's frost detector service)*

```
measurement: frost_detection
  tags:   alert_level=none|watch|warning|critical
          model_version
  fields: frost_risk (int 0/1)
          frost_probability (float 0.0–1.0)
```

---

## 6. Kalman Filter

### Motivation

A moving average smooths noise by averaging recent samples. It works but introduces lag — it responds slowly to genuine rapid changes because it blends new values with old ones. In greenhouse control this matters: a moving average might delay detecting a genuine temperature spike, causing the heater to overshoot before the controller responds.

A Kalman filter is a recursive state estimator that maintains a probabilistic model of the true state. It distinguishes noise (random variation around the true state) from signal (genuine state change) by tracking two quantities:

- **Process noise Q** — how much the true state is expected to change between measurements
- **Measurement noise R** — how much the sensor measurement is expected to deviate from the true state

When R is high (noisy sensor), the filter trusts the model more and smooths heavily. When Q is high (rapidly changing environment), the filter tracks changes more closely. The ratio Q/R determines the filtering aggressiveness.

### Per-Channel Parameters

| Channel | Q (process noise) | R (measurement noise) | Rationale |
|---------|------------------|-----------------------|-----------|
| air_temp_c | Low | Medium | Temperature changes slowly; DHT11 has moderate noise |
| air_humidity_pct | Medium | High | DHT11 humidity is noisier, especially above 70% RH |
| soil_moisture_pct | Low | High | Soil moisture is physically stable; ADC is electrically noisy |
| soil_moisture_raw | Low | High | Same sensor, raw ADC — same reasoning |
| light_raw | Medium | Medium | Light can change quickly (clouds, shadows) |

Q and R are set independently per channel. The filter is not a one-size-fits-all smoother — it is tuned to the actual noise characteristics of each sensor.

### Measured Noise Reduction

Measured over a 1-hour window on 22 April 2026. Standard deviation computed from 9 samples per channel retrieved from InfluxDB:

| Channel | Raw σ | Filtered σ | Noise reduction |
|---------|-------|------------|-----------------|
| Soil moisture (ADC) | 8.9069 | 2.5386 | **71.5%** |
| Air humidity (%) | 9.7623 | 3.3430 | **65.8%** |
| Light (ADC) | 5.3943 | 4.8875 | 9.4% |
| Air temperature (°C) | 0.2847 | 0.2854 | ~0% |

**Result interpretation:**

- **Soil moisture (71.5%):** Raw σ of 8.9 ADC ≈ ±2.7% moisture. This is large enough to cause false pump triggers at a 35% threshold. Filtered σ of 2.5 ADC ≈ ±0.8% makes the reading reliable for control.
- **Humidity (65.8%):** Raw σ of 9.76% caused the fan to cycle rapidly during early testing (observed empirically — fan toggling on and off every few minutes). Filtered σ of 3.34% stabilised fan control decisions.
- **Light (9.4%):** Modest reduction because the sensor was in a stable indoor environment during this measurement. The filter correctly applies minimal smoothing when the signal is already stable — it does not over-filter.
- **Temperature (~0%):** The DHT11 temperature output is digitally quantised to 0.1°C steps. Sample-to-sample variation is minimal and the filter has nothing to remove. Correct behaviour — the filter is not degrading a clean signal.

The central finding is that the Kalman filter applies **adaptive smoothing proportional to the actual noise level of each channel.** This is the key advantage over a moving average, which applies uniform smoothing regardless of whether the signal is noisy or clean.

---

## 7. Flask REST API

`flask_api.py` serves the interface between the dashboard and the backend. It runs on port 5000, subscribes to the MQTT telemetry topic to maintain live system state, and queries InfluxDB for historical data.

### Complete Endpoint Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | API version, endpoint list |
| GET | `/api/health` | MQTT connected, InfluxDB available, last sensor update |
| GET | `/api/status` | Full system state including all sensor and actuator values |
| GET | `/api/automation` | Current automation mode and per-actuator active flags |
| POST | `/api/automation` | `{"enabled": true\|false}` — enable or disable automation |
| POST | `/api/actuator/<n>` | `{"state": 0\|1}` — manual relay control |
| GET | `/api/sensors/latest` | Live raw + filtered values for all channels, staleness flag, soil status |
| GET | `/api/sensors/sparkline?sensor=<f>` | Last 30 min filtered values as float array (for mini trend charts) |
| GET | `/api/sensors/comparison?sensor=<f>` | Raw vs Kalman time-aligned for overlay chart |
| GET | `/api/sensors/history` | Historical raw data from sensor_readings |
| GET | `/api/sensors/history/filtered` | Historical Kalman data from sensor_readings_filt |
| GET | `/api/actuators/history` | Historical relay states from actuator_states |
| GET | `/api/actuators/gantt` | Actuator ON/OFF periods as Gantt segments |

### /api/sensors/latest

Designed for the dashboard sensor cards. Returns live values from MQTT state (updated every 2–30s) and the most recent Kalman-filtered values from InfluxDB. Also returns a `stale` flag when the last sensor update is more than 90 seconds old.

```json
{
  "success": true,
  "stale": false,
  "last_sensor_update": "2026-04-22T10:45:27Z",
  "data": {
    "air_temp_c":        { "raw": 22.1,  "filtered": 22.0,  "unit": "C",   "stale": false },
    "air_humidity_pct":  { "raw": 78.0,  "filtered": 76.4,  "unit": "%",   "stale": false },
    "soil_moisture_pct": { "raw": 44.7,  "filtered": 44.2,  "unit": "%",   "status": "ideal", "stale": false },
    "soil_moisture_raw": { "raw": 285,   "filtered": 283,   "unit": "ADC", "stale": false },
    "soil_temp_c":       { "raw": 20.8,  "filtered": 20.7,  "unit": "C",   "stale": false },
    "light_raw":         { "raw": 106,   "filtered": 104,   "unit": "ADC", "stale": false }
  }
}
```

Soil moisture status labels derived from calibration thresholds:

| Status | Range | Meaning |
|--------|-------|---------|
| `dry` | < 20% | Irrigation urgently needed |
| `getting_dry` | 20–35% | Approaching irrigation threshold |
| `ideal` | 35–50% | Good moisture level for most crops |
| `wet` | 50–58% | High — pump locked out |
| `saturated` | > 58% | At physical saturation — no irrigation |

### /api/actuators/gantt

Returns actuator ON/OFF periods as Gantt-style timeline segments. Accepts `?minutes=` (preferred, supports sub-hour windows) or `?hours=` parameters.

```json
{
  "success": true,
  "minutes": 60,
  "domain": { "start": "2026-04-22T09:45:00Z", "end": "2026-04-22T10:45:00Z" },
  "segments": [
    { "actuator": "lamp",   "start": "2026-04-22T09:45:00Z", "end": "2026-04-22T10:45:00Z", "duration_s": 3600 },
    { "actuator": "fan",    "start": "2026-04-22T10:12:00Z", "end": "2026-04-22T10:19:00Z", "duration_s": 420 },
    { "actuator": "pump",   "start": "2026-04-22T10:30:00Z", "end": "2026-04-22T10:30:04Z", "duration_s": 4 }
  ],
  "count": 3
}
```

### Input Validation

All `POST /api/actuator/<n>` requests are validated:

| Condition | Response |
|-----------|----------|
| Unknown actuator name | HTTP 400 + list of valid names |
| State not 0 or 1 | HTTP 400 |
| Manual control while automation active for that actuator | HTTP 403 |
| Missing JSON body | HTTP 400 |
| MQTT not connected | HTTP 503 |

---

## 8. Automation Engines (Saadat's Layer)

Two automation engines are included in this repository because they run on the edge infrastructure and share the MQTT pipeline and InfluxDB storage defined in this layer. Their internal control logic is authored by Saadat.

- `automation_engine.py` — threshold-based rule engine (default, starts on boot)
- `automation_engine_flc.py` — Mamdani fuzzy logic controller

The `switch_automation.sh` script is part of the edge layer — it enforces mutual exclusion between the two engines so only one publishes actuator commands at a time:

```bash
./switch_automation.sh threshold   # start threshold engine (default)
./switch_automation.sh flc         # start Mamdani FLC
./switch_automation.sh status      # show which is running
```

For documentation of the control logic, membership functions, rule base, and actuator decisions, refer to Saadat's documentation.

---

## 9. Cybersecurity

Three active security layers plus one documented known limitation.

### Threat Model

The system operates on a local campus network with no internet exposure. Primary threats:

- Unauthorised MQTT clients subscribing to sensor data or publishing spoofed actuator commands
- The command topic (`greenhouse/mega1/command`) directly activates physical hardware — unauthorised commands could run the pump continuously, overheat the greenhouse, or damage the relay hardware
- Malformed HTTP requests to the Flask API causing unintended relay activation
- Plaintext MQTT traffic readable by any device on the local network

### Layer 1 — MQTT Password Authentication

```ini
# /etc/mosquitto/mosquitto.conf
password_file /etc/mosquitto/passwd
allow_anonymous false
```

Anonymous connections are refused at the broker before any message is processed. All Python services call `username_pw_set()` before connecting. The Arduino firmware passes credentials in `mqttClient.connect()`.

```bash
# Verification — any unauthenticated connection attempt:
$ mosquitto_pub -t 'test' -m 'hello'
Connection error: Connection Refused: not authorised.
```

### Layer 2 — MQTT Topic ACLs

```
# /etc/mosquitto/acls
user mqttuser
topic readwrite greenhouse/#
topic readwrite $SYS/#
```

Restricts the authenticated user to only the greenhouse topic namespace. Prevents credential abuse to access or inject data into unrelated topics.

### Layer 3 — Flask API Input Validation

All `POST /api/actuator/<n>` requests are validated before any MQTT command is published:

- Unknown actuator names → HTTP 400
- State values other than 0 or 1 → HTTP 400
- Manual control while automation is active → HTTP 403
- Missing JSON body → HTTP 400

This prevents malformed or out-of-range commands from ever reaching the physical relay hardware.

### Known Limitation — TLS

MQTT traffic is plaintext. Mosquitto supports TLS natively. All Python clients use paho-mqtt which has full TLS support. The authentication layer above provides the credential foundation that TLS would complement.

TLS was not implemented due to: (1) certificate authority and per-client certificate management not feasible within the project timeline; (2) local-network deployment scope reduces eavesdropping risk; (3) the primary threat (unauthorised broker access) is already mitigated by password authentication and ACLs.

TLS is the recommended next step for any production or internet-facing deployment.

### Security Verification Results

| Test | Expected | Result |
|------|----------|--------|
| Anonymous MQTT connection | Refused | `Connection Refused: not authorised` ✅ |
| Authenticated connection | Connected | All 5 clients connected ✅ |
| Flask — invalid actuator name | HTTP 400 | HTTP 400 + valid names list ✅ |
| Flask — state = 2 | HTTP 400 | `state must be 0 or 1` ✅ |
| Flask — manual during automation | HTTP 403 | `automation controlling actuator` ✅ |
| Security config survives reboot | Persistent | Confirmed — 46 seconds boot ✅ |

---

## 10. Performance Results

All measurements taken on the live production system, 16–22 April 2026.

### MQTT Pipeline Reliability

| Metric | Value | Notes |
|--------|-------|-------|
| Measurement period | 16h 18min | Broker uptime since last restart |
| Messages received | 45,035 | Arduino + all Python clients |
| Messages sent | 144,920 | Fan-out to ~3 subscribers per message |
| Sent/received ratio | 3.2× | Expected for 1 publisher, 3 subscribers |
| Messages received/min | ~47 | From $SYS 1-minute load average |
| Messages sent/min | ~135 | From $SYS 1-minute load average |
| **Dropped messages** | **0** | publish/dropped = 0.00 across all windows |
| **Packet loss** | **0%** | Zero drops over 16+ hours, 45,000+ messages |
| Connected clients | 5 | All stable, 0 disconnections |

### API Response Latency

Ten sequential requests to `/api/sensors/latest` (includes MQTT state lookup + InfluxDB query):

| Sample | Latency |
|--------|---------|
| First (cold) | 74–102 ms |
| 2–10 (steady state) | 45–54 ms |
| **Average** | **~50 ms** |
| Target | < 3000 ms |

### Actuator Command Latency

| Stage | Measured | All actuators |
|-------|----------|---------------|
| Flask → MQTT publish confirmation | 27–54 ms | pump, fan, heater, lamp |
| Full round-trip: HTTP → relay → telemetry confirmed | 114 ms | representative measurement |
| **Target** | **< 500 ms** | |

### System Boot Time

All 7 enabled services active within **46 seconds** of reboot. No manual intervention required. Verified 31 March 2026 and again 22 April 2026 (post-cybersecurity changes).

### Kalman Filter Noise Reduction

| Channel | Raw σ | Filtered σ | Reduction |
|---------|-------|------------|-----------|
| Soil moisture (ADC) | 8.9069 | 2.5386 | **71.5%** |
| Air humidity (%) | 9.7623 | 3.3430 | **65.8%** |
| Light (ADC) | 5.3943 | 4.8875 | 9.4% |
| Air temperature (°C) | 0.2847 | 0.2854 | ~0% (clean signal) |

### Complete Evaluation Table

| Metric | Target | Measured | Status |
|--------|--------|----------|--------|
| MQTT packet loss | < 5% | **0%** | ✅ PASS |
| API response latency | < 3000ms | 45–74ms | ✅ PASS |
| Actuator command delivery | < 500ms | 27–54ms | ✅ PASS |
| Full round-trip latency | < 500ms | 114ms | ✅ PASS |
| System boot time | < 120s | 46s | ✅ PASS |
| Services surviving reboot | All 7 | All 7 | ✅ PASS |
| Kalman — soil moisture | Noise reduction | 71.5% σ reduction | ✅ PASS |
| Kalman — humidity | Noise reduction | 65.8% σ reduction | ✅ PASS |
| Automation — humidity trigger | Fan ON > 85% | 88%, 87% → fan ON | ✅ PASS |
| Automation — pump trigger | Pump ON < 35% soil | 32.1% → pump ON, 4s | ✅ PASS |
| Pump safety timer | Auto-off at 4s | Timer fired at 4s | ✅ PASS |
| Pump cooldown | 120min lockout | Subsequent triggers blocked | ✅ PASS |
| Pump saturation pre-check | Skip if >= 55% | 60% → pump skipped | ✅ PASS |
| MQTT anonymous access | Blocked | Connection Refused | ✅ PASS |
| Flask input validation | HTTP 400/403 | All invalid inputs rejected | ✅ PASS |
| MQTT topic ACLs | greenhouse/# restricted | ACL active and verified | ✅ PASS |

---

## 11. Setup & Deployment

### Prerequisites

- Raspberry Pi 400 running Debian Bookworm
- Python 3.10+
- Mosquitto MQTT broker (`sudo apt install mosquitto mosquitto-clients`)
- InfluxDB 2.x ([installation guide](https://docs.influxdata.com/influxdb/v2/install/))

### Installation

**1. Clone the repository**
```bash
git clone https://github.com/auuerk/DyikanAI.git
cd DyikanAI
```

**2. Python environment**
```bash
python3 -m venv venv
source venv/bin/activate
pip install paho-mqtt influxdb-client flask flask-cors python-dotenv
```

**3. Configure environment**
```bash
cp .env.example .env
nano .env   # add your InfluxDB token, MQTT credentials, and adjust thresholds
```

**4. Configure Mosquitto authentication**
```bash
sudo mosquitto_passwd -c /etc/mosquitto/passwd mqttuser
sudo chown mosquitto:mosquitto /etc/mosquitto/passwd
sudo chmod 640 /etc/mosquitto/passwd
sudo cp mosquitto/mosquitto.conf /etc/mosquitto/mosquitto.conf
sudo cp mosquitto/acls /etc/mosquitto/acls
sudo chown mosquitto:mosquitto /etc/mosquitto/acls
sudo chmod 640 /etc/mosquitto/acls
sudo systemctl restart mosquitto
```

**5. Install systemd services**
```bash
sudo cp services/*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable agricontrol-mqtt agricontrol-automation \
                       agricontrol-filter agricontrol-flask
sudo systemctl start  agricontrol-mqtt agricontrol-automation \
                       agricontrol-filter agricontrol-flask
```

**6. Verify**
```bash
./switch_automation.sh status
curl -s http://localhost:5000/api/health | python3 -m json.tool
```

Expected output:
```json
{
  "influxdb_available": true,
  "mqtt_connected": true,
  "service": "agricontrol-api",
  "success": true
}
```

### Environment Variables

See `.env.example` for the full list. Most important:

| Variable | Default | Description |
|----------|---------|-------------|
| `MQTT_USERNAME` | — | MQTT broker username |
| `MQTT_PASSWORD` | — | MQTT broker password |
| `INFLUX_TOKEN` | — | InfluxDB API token |
| `INFLUX_ORG` | iot-org | InfluxDB organisation |
| `INFLUX_BUCKET` | gh_sensor_data | InfluxDB bucket |
| `TEMP_HEATER_ON` | 20.0 | Heater ON threshold (°C) |
| `TEMP_HEATER_OFF` | 22.0 | Heater OFF threshold (°C) |
| `TEMP_FAN_ON` | 26.0 | Fan ON temperature threshold (°C) |
| `HUMIDITY_HIGH` | 85.0 | Fan ON humidity threshold (%) |
| `HUMIDITY_LOW` | 65.0 | Fan OFF humidity threshold (%) |
| `SOIL_PCT_DRY` | 35.0 | Pump trigger threshold (%) |
| `SOIL_PCT_WET` | 55.0 | Pump saturation lockout (%) |
| `PUMP_DURATION` | 4 | Pump on-time per activation (seconds) |
| `PUMP_COOLDOWN` | 120 | Pump cooldown period (minutes) |
| `MAX_PUMP_RUNS` | 10 | Maximum pump activations per day |

### Useful Commands

```bash
# Check system status
./switch_automation.sh status
curl -s http://localhost:5000/api/health | python3 -m json.tool

# Switch automation engines
./switch_automation.sh threshold    # default
./switch_automation.sh flc          # Mamdani FLC

# Watch live logs
tail -f ~/iot-backend/auto.log      # automation decisions
tail -f ~/iot-backend/filter.log    # Kalman filter
tail -f ~/iot-backend/flask.log     # API requests
tail -f ~/iot-backend/mqtt.log      # MQTT bridge

# Manual actuator control (turn automation off first)
curl -X POST http://localhost:5000/api/automation \
  -H 'Content-Type: application/json' -d '{"enabled": false}'
curl -X POST http://localhost:5000/api/actuator/pump \
  -H 'Content-Type: application/json' -d '{"state": 1}'
curl -X POST http://localhost:5000/api/actuator/pump \
  -H 'Content-Type: application/json' -d '{"state": 0}'
curl -X POST http://localhost:5000/api/automation \
  -H 'Content-Type: application/json' -d '{"enabled": true}'

# Verify MQTT authentication
mosquitto_pub -t 'test' -m 'hello'
# → Connection Refused: not authorised  (correct — anonymous blocked)
mosquitto_sub -t 'greenhouse/mega1/telemetry' \
  -u mqttuser -P <password> -C 1
# → receives one telemetry message (correct — auth works)

# Check live sensor data
curl -s http://localhost:5000/api/sensors/latest | python3 -m json.tool

# Check actuator timeline (last hour)
curl -s 'http://localhost:5000/api/actuators/gantt?minutes=60' | python3 -m json.tool
```

---

## 12. Repository Structure

```
DyikanAI/                                  ← single repository for the full project
│
├── README.md                              ← this file (edge/backend layer focus)
├── .gitignore
│
├── backend/                               ← Aruuke — edge node & backend
│   ├── mqtt_to_influx.py                  ← MQTT→InfluxDB bridge, soil calibration
│   ├── automation_engine.py               ← threshold automation engine v3 (Saadat)
│   ├── automation_engine_flc.py           ← Mamdani FLC engine (Saadat)
│   ├── filter_engine.py                   ← Kalman filter, 5 channels
│   ├── flask_api.py                       ← REST API v2, 11 endpoints, port 5000
│   ├── switch_automation.sh               ← mutual exclusion automation switcher
│   ├── deploy_frost_detector.py           ← XGBoost frost detection (Alfiia)
│   ├── .env.example                       ← environment variable template
│   ├── mosquitto/
│   │   ├── mosquitto.conf                 ← broker config: auth, ACLs, logging
│   │   └── acls                           ← topic access control list
│   └── services/
│       ├── agricontrol-mqtt.service
│       ├── agricontrol-automation.service
│       ├── agricontrol-automation-flc.service
│       ├── agricontrol-filter.service
│       ├── agricontrol-flask.service
│       └── frost-detector.service
│
├── firmware/                              ← Aruuke — Arduino firmware
│   └── greenhouse_firmware_v1.3/
│       └── greenhouse_firmware_v1.3.ino   ← Arduino Mega 2560, firmware v1.3
│
├── dashboard/                             ← Alfiia + Aruuke (SensorsPage, AgriControlPage)
│   ├── src/
│   │   ├── components/
│   │   │   ├── pages/
│   │   │   │   ├── SensorsPage.tsx        ← Aruuke — live sensor monitor
│   │   │   │   ├── AgriControlPage.tsx    ← Aruuke — actuator control panel
│   │   │   │   ├── DashboardPage.tsx      ← Alfiia
│   │   │   │   ├── AnalyticsPage.tsx      ← Alfiia
│   │   │   │   ├── AIChatPage.tsx         ← Alfiia
│   │   │   │   └── ...
│   │   │   └── ...
│   │   ├── api/boxApi.ts
│   │   ├── types/index.ts
│   │   └── App.tsx
│   ├── package.json
│   ├── vite.config.js
│   ├── tailwind.config.js
│   └── index.html
│
└── frost-detector/                        ← Alfiia — frost detection service
    └── deploy_frost_detector.py
```

---

## Acknowledgements

Developed as a Final Year Project at the University of Central Asia, Department of Computer Science, School of Arts & Sciences, Naryn, Kyrgyzstan.

**Team:** Aruuke Sanzharbekova (edge/backend layer) · Saadat (fog/control layer) · Alfiia (AI/interface layer)  
**Supervisors:** Dr. Dmytro Zubov · Dr. Muhammad Fayaz

---

*AgriControl / DyikanAI · University of Central Asia · 2026*
