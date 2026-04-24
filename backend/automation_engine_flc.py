"""
automation_engine_flc.py  —  AgriControl, v3 FLC edition
=========================================================
Drop-in replacement for automation_engine.py that replaces the
hard-threshold decision logic with a Mamdani Fuzzy Inference System.

Architecture
────────────
  automation_engine.py (v2)   →  check_temperature / check_soil / check_light
  automation_engine_flc.py    →  FLC.run(sensors) → heater/pump/lamp outputs

Everything else is identical to v2:
  - Same MQTT topics, client_id, QoS, command format
  - Same split-payload handling (firmware v1.3)
  - Same pump safety limits (cooldown, daily cap)
  - Same enable/disable via MQTT_TOPIC_AUTOMATION
  - Same status publish format so flask_api.py needs zero changes

Mode handling
─────────────
  Automation ON  (state['enabled'] = True)
    The FLC runs every CHECK_INTERVAL_S seconds. It reads the latest
    Kalman-filtered sensor values and publishes actuator commands.
    /api/actuator/<n> returns 403 for any actuator the FLC is actively
    controlling (same behaviour as v2 — flask_api.py enforces this via
    automation_active flags that this engine publishes in the status msg).

  Manual mode  (state['enabled'] = False)
    The FLC loop idles. No commands are sent by this engine.
    The dashboard can send commands freely via /api/actuator/<n>.
    Switching from AUTO → MANUAL immediately sets all active_controls
    to False so flask_api unblocks manual control without any delay.

FLC inputs
──────────
  air_temp_c        — from firmware (DHT11, offset applied in fw v1.3)
  soil_moisture_pct — from firmware v1.3 or computed from raw ADC via
                      the same 4-point calibration curve as v2
  light_raw         — raw ADC from light sensor
  outdoor_temp_c    — from MQTT_TOPIC_WEATHER or fallback default
  vpd_hpa           — computed from air_temp_c and air_humidity_pct
                      (no extra sensor required)
  frost_risk        — from MQTT_TOPIC_FROST_RISK or fallback 0

FLC outputs → actuator commands
────────────────────────────────
  heater_intensity  0–100  → heater ON if > HEATER_ON_THRESHOLD (40)
                           → fan ON   if > FAN_ON_THRESHOLD (70) AND
                             heater output is LOW (< 20)
  pump_duration_s   0–120  → pump ON for N seconds if N > 5
                             (pump safety limits still applied)
  lamp_power        0–100  → lamp ON if > LAMP_ON_THRESHOLD (30)

Dependencies
────────────
  pip install scikit-fuzzy paho-mqtt python-dotenv
"""

import os
import json
import time
import threading
from datetime import datetime, timezone, timedelta
import math

import numpy as np
import skfuzzy as fuzz
import paho.mqtt.client as mqtt
from dotenv import load_dotenv

load_dotenv()

# ── Configuration ─────────────────────────────────────────────────────────────
MQTT_HOST             = os.getenv('MQTT_HOST',             'localhost')
MQTT_PORT             = int(os.getenv('MQTT_PORT',         '1883'))
MQTT_TOPIC_TELEMETRY  = os.getenv('MQTT_TOPIC_TELEMETRY',  'greenhouse/mega1/telemetry')
MQTT_TOPIC_COMMAND    = os.getenv('MQTT_TOPIC_COMMAND',    'greenhouse/mega1/command')
MQTT_TOPIC_AUTOMATION = os.getenv('MQTT_TOPIC_AUTOMATION', 'greenhouse/automation/status')

# Optional: publish weather/frost topics from a separate ML prediction process.
# If not available the engine falls back to safe defaults (see FLC.DEFAULT_*).
MQTT_TOPIC_WEATHER    = os.getenv('MQTT_TOPIC_WEATHER',    'greenhouse/weather/outdoor')
MQTT_TOPIC_FROST      = os.getenv('MQTT_TOPIC_FROST',      'greenhouse/weather/frost_risk')

# FLC → actuator decision thresholds
HEATER_ON_THRESHOLD   = float(os.getenv('FLC_HEATER_ON',   '40'))  # heater ON above this
FAN_ON_THRESHOLD      = float(os.getenv('FLC_FAN_ON',      '60'))  # fan ON when lamp/heater low
LAMP_ON_THRESHOLD     = float(os.getenv('FLC_LAMP_ON',     '30'))  # lamp ON above this
PUMP_MIN_DURATION_S   = float(os.getenv('FLC_PUMP_MIN',    '5'))   # ignore pump < this

# Pump safety (identical to v2)
PUMP_COOLDOWN_MIN     = int(os.getenv('PUMP_COOLDOWN',     '60'))
MAX_PUMP_RUNS         = int(os.getenv('MAX_PUMP_RUNS',     '10'))

# Loop
CHECK_INTERVAL_S      = int(os.getenv('AUTO_CHECK_INTERVAL', '10'))

# Soil calibration (identical to v2 / mqtt_to_influx.py)
SOIL_CAL_POINTS = [(427, 0.0), (402, 20.0), (313, 40.0), (199, 60.0)]


# ── Calibration helpers ───────────────────────────────────────────────────────
def raw_to_pct(raw: int) -> float:
    """4-point piecewise linear — mirrors automation_engine.py v2."""
    pts = SOIL_CAL_POINTS
    if raw >= pts[0][0]:
        return pts[0][1]
    if raw <= pts[-1][0]:
        return pts[-1][1]
    for i in range(len(pts) - 1):
        adc_hi, pct_lo = pts[i]
        adc_lo, pct_hi = pts[i + 1]
        if adc_lo <= raw <= adc_hi:
            fraction = (adc_hi - raw) / (adc_hi - adc_lo)
            return round(pct_lo + fraction * (pct_hi - pct_lo), 1)
    return 0.0


def calc_vpd(temp_c: float, humidity_pct: float) -> float:
    """
    Compute vapor pressure deficit (hPa) from temperature and relative humidity.
    Uses the Magnus formula.  No extra sensor required.
    """
    sat_vp = 6.1078 * math.exp((17.269 * temp_c) / (237.3 + temp_c))  # hPa
    actual_vp = sat_vp * (humidity_pct / 100.0)
    return round(max(sat_vp - actual_vp, 0.0), 2)


# ── Mamdani FIS definition ────────────────────────────────────────────────────
class FLC:
    """
    Mamdani Fuzzy Inference System for greenhouse actuator control.

    Three independent controllers share some input universes:
      - Heater controller  : air_temp × outdoor_temp × frost_risk → heater_intensity
      - Pump controller    : soil_moisture × vpd × air_temp       → pump_duration_s
      - Lamp controller    : light × air_temp                     → lamp_power

    All membership functions and rules are documented in:
      mamdani_fis_greenhouse.ipynb  (Sections 3–6)

    Breakpoints are grounded in:
      - sensor_data_march30.csv  (504 real greenhouse readings)
      - predicted_data_march30.csv  (35 545 samples, Naryn climate context)
      - FAO greenhouse guidelines (optimal temp 18–26 °C, VPD 8–14 hPa)
      - Sensor 1 calibration curve (Progress Report #5)
    """

    # Safe fallback values when optional MQTT inputs are unavailable
    DEFAULT_OUTDOOR_TEMP = 2.0    # °C — close to Naryn annual mean (1.9 °C)
    DEFAULT_FROST_RISK   = 0.5    # conservative — assume moderate frost risk
    DEFAULT_VPD          = 13.7   # hPa — median from predicted_data_march30

    def __init__(self):
        self._build_universes()
        self._build_input_mfs()
        self._build_output_mfs()

    # ── Universes ─────────────────────────────────────────────────────────────
    def _build_universes(self):
        # Inputs
        self.u_temp     = np.arange(-5,  46, 0.5)   # °C  indoor
        self.u_out_temp = np.arange(-35, 36, 0.5)   # °C  outdoor (Naryn)
        self.u_soil     = np.arange(0,  101, 1.0)   # %   soil moisture
        self.u_vpd      = np.arange(0,   51, 0.5)   # hPa
        self.u_light    = np.arange(0, 2401, 10.0)  # raw lux ADC
        self.u_frost    = np.arange(0,  1.1, 0.1)   # 0–1

        # Outputs
        self.u_heater   = np.arange(0, 101, 1.0)    # intensity  0–100
        self.u_pump     = np.arange(0, 121, 1.0)    # seconds    0–120
        self.u_lamp     = np.arange(0, 101, 1.0)    # power      0–100

    # ── Input membership functions ────────────────────────────────────────────
    def _build_input_mfs(self):
        # air_temp_c — 5 terms
        # Breakpoints: optimal range 18–26 °C, frost below 8 °C, stress above 36 °C
        self.mf_temp = {
            'cold':  fuzz.trapmf(self.u_temp, [-5, -5,  8, 15]),
            'cool':  fuzz.trimf( self.u_temp, [10, 16, 22]),
            'ideal': fuzz.trimf( self.u_temp, [18, 23, 28]),
            'warm':  fuzz.trimf( self.u_temp, [24, 29, 35]),
            'hot':   fuzz.trapmf(self.u_temp, [31, 36, 45, 45]),
        }

        # outdoor_temp_c — 4 terms
        # Naryn climate: mean 1.9 °C, p5 = −18.7 °C, max = 34.4 °C
        self.mf_out_temp = {
            'very_cold': fuzz.trapmf(self.u_out_temp, [-35, -35, -15,  -5]),
            'cold':      fuzz.trimf( self.u_out_temp, [-10,  -2,   8]),
            'mild':      fuzz.trimf( self.u_out_temp, [  3,  12,  22]),
            'warm':      fuzz.trapmf(self.u_out_temp, [ 18,  25,  35,  35]),
        }

        # soil_moisture_pct — 4 terms
        # Calibrated range 0–60 %; pump triggers below 35 % (v2 SOIL_PCT_DRY)
        self.mf_soil = {
            'dry':      fuzz.trapmf(self.u_soil, [ 0,  0, 15, 28]),
            'low':      fuzz.trimf( self.u_soil, [20, 32, 45]),
            'adequate': fuzz.trimf( self.u_soil, [38, 52, 65]),
            'wet':      fuzz.trapmf(self.u_soil, [58, 72, 100, 100]),
        }

        # vpd_hpa — 4 terms
        # Ideal greenhouse VPD: 8–14 hPa (FAO); > 20 hPa = plant stress
        self.mf_vpd = {
            'low':       fuzz.trapmf(self.u_vpd, [ 0,  0,  6, 10]),
            'optimal':   fuzz.trimf( self.u_vpd, [ 7, 12, 17]),
            'high':      fuzz.trimf( self.u_vpd, [13, 18, 25]),
            'very_high': fuzz.trapmf(self.u_vpd, [21, 28, 50, 50]),
        }

        # light_raw — 3 terms
        # Sensor data (nighttime): 3–6 raw; predicted p50 = 729, p95 = 1 809
        self.mf_light = {
            'dark':   fuzz.trapmf(self.u_light, [   0,    0,   50,  200]),
            'dim':    fuzz.trimf( self.u_light, [ 100,  400,  800]),
            'bright': fuzz.trapmf(self.u_light, [ 600, 1000, 2400, 2400]),
        }

        # frost_risk — 2 terms (binary ML output)
        self.mf_frost = {
            'no_frost': fuzz.trapmf(self.u_frost, [0.0, 0.0, 0.3, 0.5]),
            'frost':    fuzz.trapmf(self.u_frost, [0.4, 0.6, 1.0, 1.0]),
        }

    # ── Output membership functions ───────────────────────────────────────────
    def _build_output_mfs(self):
        self.mf_heater = {
            'off':    fuzz.trapmf(self.u_heater, [ 0,  0, 10, 25]),
            'low':    fuzz.trimf( self.u_heater, [15, 35, 55]),
            'medium': fuzz.trimf( self.u_heater, [45, 62, 78]),
            'high':   fuzz.trapmf(self.u_heater, [68, 82, 100, 100]),
        }

        self.mf_pump = {
            'none':   fuzz.trapmf(self.u_pump, [ 0,  0,  5, 15]),
            'short':  fuzz.trimf( self.u_pump, [10, 30, 55]),
            'medium': fuzz.trimf( self.u_pump, [45, 65, 85]),
            'long':   fuzz.trapmf(self.u_pump, [75, 95, 120, 120]),
        }

        self.mf_lamp = {
            'off':  fuzz.trapmf(self.u_lamp, [ 0,  0, 10, 25]),
            'dim':  fuzz.trimf( self.u_lamp, [15, 40, 60]),
            'full': fuzz.trapmf(self.u_lamp, [50, 70, 100, 100]),
        }

    # ── Core inference engine ─────────────────────────────────────────────────
    @staticmethod
    def _fuzzify(universe, mf_dict, crisp_value):
        """Return {label: membership_degree} for a crisp input."""
        return {
            label: float(fuzz.interp_membership(universe, mf, crisp_value))
            for label, mf in mf_dict.items()
        }

    @staticmethod
    def _aggregate_and_defuzz(universe, mf_dict, rules_fired):
        """
        Aggregate clipped output MFs (max) and defuzzify (centroid).
        rules_fired: list of (output_label, firing_strength)
        Returns crisp float, or 0.0 if nothing fired.
        """
        agg = np.zeros_like(universe, dtype=float)
        for out_label, strength in rules_fired:
            if strength > 0:
                clipped = np.fmin(strength, mf_dict[out_label])
                agg = np.fmax(agg, clipped)
        if agg.sum() == 0:
            return 0.0
        return float(fuzz.defuzz(universe, agg, 'centroid'))

    # ── Heater controller ─────────────────────────────────────────────────────
    def infer_heater(self, air_temp: float, outdoor_temp: float,
                     frost_risk: float) -> float:
        """
        Rules (16 total) — IF air_temp AND outdoor_temp AND frost_risk
                           THEN heater_intensity.

        Key agronomic principles:
          - frost_risk=1 from ML model always triggers HIGH regardless of temp
          - outdoor very_cold + cold inside → HIGH (Naryn winter scenario)
          - ideal temp + mild outdoor → OFF (no heating needed)
          - warm/hot indoor → OFF unconditionally
        """
        mu_t = self._fuzzify(self.u_temp,     self.mf_temp,     air_temp)
        mu_o = self._fuzzify(self.u_out_temp, self.mf_out_temp, outdoor_temp)
        mu_f = self._fuzzify(self.u_frost,    self.mf_frost,    frost_risk)

        rules = [
            # (temp_term, outdoor_term, frost_term, output_term)
            ('cold',  'very_cold', 'frost',    'high'),
            ('cold',  'very_cold', 'no_frost', 'high'),
            ('cold',  'cold',      'frost',    'high'),
            ('cold',  'cold',      'no_frost', 'medium'),
            ('cold',  'mild',      'no_frost', 'medium'),
            ('cool',  'very_cold', 'frost',    'high'),
            ('cool',  'cold',      'frost',    'high'),
            ('cool',  'cold',      'no_frost', 'medium'),
            ('cool',  'mild',      'no_frost', 'low'),
            ('ideal', 'very_cold', 'frost',    'medium'),
            ('ideal', 'cold',      'no_frost', 'low'),
            ('ideal', 'mild',      'no_frost', 'off'),
            ('warm',  'mild',      'no_frost', 'off'),
            ('warm',  'warm',      'no_frost', 'off'),
            ('hot',   'mild',      'no_frost', 'off'),
            ('hot',   'warm',      'no_frost', 'off'),
        ]

        fired = [
            (out, min(mu_t[t], mu_o[o], mu_f[f]))
            for t, o, f, out in rules
        ]
        return self._aggregate_and_defuzz(self.u_heater, self.mf_heater, fired)

    # ── Pump controller ───────────────────────────────────────────────────────
    def infer_pump(self, soil_moisture: float, vpd: float,
                   air_temp: float) -> float:
        """
        Rules (18 total) — IF soil AND vpd AND air_temp → pump_duration_s.

        Key principles:
          - wet soil → never water regardless of VPD/temp
          - dry soil + very_high VPD + hot → maximum duration
          - adequate soil + any VPD → no watering
          - low temp reduces evapotranspiration → shorter duration
        """
        mu_s = self._fuzzify(self.u_soil, self.mf_soil, soil_moisture)
        mu_v = self._fuzzify(self.u_vpd,  self.mf_vpd,  vpd)
        mu_t = self._fuzzify(self.u_temp, self.mf_temp, air_temp)

        rules = [
            # (soil_term, vpd_term, temp_term, output_term)
            ('dry',      'very_high', 'hot',   'long'),
            ('dry',      'very_high', 'warm',  'long'),
            ('dry',      'high',      'warm',  'long'),
            ('dry',      'high',      'ideal', 'medium'),
            ('dry',      'optimal',   'ideal', 'medium'),
            ('dry',      'optimal',   'cool',  'short'),
            ('dry',      'low',       'cool',  'short'),
            ('low',      'very_high', 'hot',   'medium'),
            ('low',      'high',      'warm',  'medium'),
            ('low',      'optimal',   'ideal', 'short'),
            ('low',      'low',       'cool',  'none'),
            ('adequate', 'very_high', 'hot',   'short'),
            ('adequate', 'high',      'warm',  'none'),
            ('adequate', 'optimal',   'ideal', 'none'),
            ('adequate', 'low',       'cool',  'none'),
            ('wet',      'very_high', 'hot',   'none'),
            ('wet',      'optimal',   'ideal', 'none'),
            ('wet',      'low',       'cool',  'none'),
        ]

        fired = [
            (out, min(mu_s[s], mu_v[v], mu_t[t]))
            for s, v, t, out in rules
        ]
        return self._aggregate_and_defuzz(self.u_pump, self.mf_pump, fired)

    # ── Lamp controller ───────────────────────────────────────────────────────
    def infer_lamp(self, light: float, air_temp: float) -> float:
        """
        Rules (14 total) — IF light AND air_temp → lamp_power.

        Key principles:
          - dark/dim + cold/cool/ideal → full lamp (photosynthesis + mild heat)
          - bright → lamp off regardless of temp
          - hot → lamp off regardless of light (avoid adding heat load)
        """
        mu_l = self._fuzzify(self.u_light, self.mf_light, light)
        mu_t = self._fuzzify(self.u_temp,  self.mf_temp,  air_temp)

        rules = [
            # (light_term, temp_term, output_term)
            ('dark',   'cold',  'full'),
            ('dark',   'cool',  'full'),
            ('dark',   'ideal', 'full'),
            ('dark',   'warm',  'dim'),
            ('dark',   'hot',   'off'),
            ('dim',    'cold',  'full'),
            ('dim',    'cool',  'full'),
            ('dim',    'ideal', 'dim'),
            ('dim',    'warm',  'dim'),
            ('dim',    'hot',   'off'),
            ('bright', 'cold',  'off'),
            ('bright', 'ideal', 'off'),
            ('bright', 'warm',  'off'),
            ('bright', 'hot',   'off'),
        ]

        fired = [
            (out, min(mu_l[l], mu_t[t]))
            for l, t, out in rules
        ]
        return self._aggregate_and_defuzz(self.u_lamp, self.mf_lamp, fired)

    # ── Combined inference ────────────────────────────────────────────────────
    def run(self, air_temp: float, soil_moisture: float, light: float,
            outdoor_temp: float, vpd: float, frost_risk: float) -> dict:
        """
        Run all three controllers and return crisp outputs.

        Returns
        -------
        dict with keys:
            heater_out  float 0–100
            pump_out    float 0–120  (seconds)
            lamp_out    float 0–100
        """
        return {
            'heater_out': self.infer_heater(air_temp, outdoor_temp, frost_risk),
            'pump_out':   self.infer_pump(soil_moisture, vpd, air_temp),
            'lamp_out':   self.infer_lamp(light, air_temp),
        }


# ── Global state ──────────────────────────────────────────────────────────────
state = {
    'enabled':       True,           # controlled via MQTT_TOPIC_AUTOMATION
    'mqtt_connected': False,

    # Updated from firmware telemetry (split payload, firmware v1.3)
    'sensors': {
        'air_temp_c':         None,
        'air_humidity_pct':   None,
        'soil_temp_c':        None,
        'soil_moisture_raw':  None,
        'soil_moisture_pct':  None,   # preferred; falls back to raw_to_pct()
        'light_raw':          None,
        'last_sensor_update': None,
    },

    # Updated from actuator telemetry payloads
    'actuators': {
        'pump':   0,
        'fan':    0,
        'heater': 0,
        'lamp':   0,
        'last_actuator_update': None,
    },

    # Flags that tell flask_api.py which actuators this engine controls.
    # Set True when a command is sent; False when automation is disabled.
    # flask_api uses these to block conflicting manual commands (403).
    'active_controls': {
        'pump': False, 'fan': False, 'heater': False, 'lamp': False,
    },

    # Optional inputs from ML prediction process
    'weather': {
        'outdoor_temp_c': None,   # None → uses FLC.DEFAULT_OUTDOOR_TEMP
        'frost_risk':     None,   # None → uses FLC.DEFAULT_FROST_RISK
        'last_update':    None,
    },

    # Pump safety
    'pump_history':      [],
    'last_pump_time':    None,
    'last_command_sent': {},
}

SENSOR_KEYS   = {'air_temp_c', 'air_humidity_pct', 'soil_temp_c',
                 'soil_moisture_raw', 'soil_moisture_pct', 'light_raw'}
ACTUATOR_KEYS = {'pump', 'lamp', 'heater', 'fan'}


# ── MQTT ──────────────────────────────────────────────────────────────────────
mqtt_client = mqtt.Client(
    mqtt.CallbackAPIVersion.VERSION2, client_id='automation_engine_flc'
)


def on_connect(client, userdata, flags, rc, properties=None):
    if rc == 0:
        print(f'[MQTT] Connected to {MQTT_HOST}:{MQTT_PORT}')
        state['mqtt_connected'] = True
        client.subscribe(MQTT_TOPIC_TELEMETRY)
        client.subscribe(MQTT_TOPIC_COMMAND)
        client.subscribe(MQTT_TOPIC_AUTOMATION)
        client.subscribe(MQTT_TOPIC_WEATHER)
        client.subscribe(MQTT_TOPIC_FROST)
    else:
        print(f'[MQTT] Connection failed rc={rc}')
        state['mqtt_connected'] = False


def on_disconnect(client, userdata, flags, rc, properties=None):
    print(f'[MQTT] Disconnected rc={rc}')
    state['mqtt_connected'] = False


def on_message(client, userdata, msg):
    """
    Handle incoming MQTT messages.

    Firmware v1.3 split payloads are handled independently:
      - Sensor fields update state['sensors'] only when present.
      - Actuator fields update state['actuators'] only when present.
      - Neither overwrites the other's last-known-good values.

    Optional weather/frost topics update state['weather'].
    Automation enable/disable arrives on MQTT_TOPIC_AUTOMATION.
    """
    try:
        data  = json.loads(msg.payload.decode())
        topic = msg.topic

        # ── Telemetry (firmware split payloads) ───────────────────────────────
        if topic == MQTT_TOPIC_TELEMETRY:
            has_sensors   = bool(SENSOR_KEYS   & data.keys())
            has_actuators = bool(ACTUATOR_KEYS & data.keys())

            if has_sensors:
                s = state['sensors']
                s['air_temp_c']       = data.get('air_temp_c')
                s['air_humidity_pct'] = data.get('air_humidity_pct')
                s['soil_temp_c']      = data.get('soil_temp_c')
                s['soil_moisture_raw'] = data.get('soil_moisture_raw')
                # Prefer calibrated pct from firmware; fall back to raw ADC
                pct = data.get('soil_moisture_pct')
                if pct is None and s['soil_moisture_raw'] is not None:
                    pct = raw_to_pct(int(s['soil_moisture_raw']))
                s['soil_moisture_pct']  = pct
                s['light_raw']          = data.get('light_raw')
                s['last_sensor_update'] = datetime.now(timezone.utc)

            if has_actuators:
                a = state['actuators']
                for key in ('pump', 'fan', 'heater', 'lamp'):
                    if key in data:
                        a[key] = data[key]
                a['last_actuator_update'] = datetime.now(timezone.utc)

        # ── Automation enable / disable (from flask_api /api/automation) ──────
        elif topic == MQTT_TOPIC_AUTOMATION:
            enabled = data.get('enabled')
            if enabled is not None:
                prev = state['enabled']
                state['enabled'] = bool(enabled)
                print(f'[AUTO] Automation {"ENABLED" if enabled else "DISABLED"} via MQTT')

                # Switching OFF: immediately release all active_controls so
                # flask_api unblocks manual commands without any delay.
                if prev and not state['enabled']:
                    for key in state['active_controls']:
                        state['active_controls'][key] = False
                    print('[AUTO] All active_controls released for manual mode')

        # ── Optional: outdoor temperature from weather process ─────────────────
        elif topic == MQTT_TOPIC_WEATHER:
            outdoor = data.get('outdoor_temp_c') or data.get('temperature')
            if outdoor is not None:
                state['weather']['outdoor_temp_c'] = float(outdoor)
                state['weather']['last_update']    = datetime.now(timezone.utc)

        # ── Optional: frost risk from ML prediction process ────────────────────
        elif topic == MQTT_TOPIC_FROST:
            risk = data.get('frost_risk') or data.get('risk')
            if risk is not None:
                state['weather']['frost_risk'] = float(risk)
                state['weather']['last_update'] = datetime.now(timezone.utc)

        # ── Monitor own commands (for debugging) ──────────────────────────────
        elif topic == MQTT_TOPIC_COMMAND:
            source = data.get('source', '?')
            if source != 'automation_flc':   # ignore our own echoes
                print(f'[MQTT-CMD] External: {data.get("actuator")} → '
                      f'{data.get("state")}  source={source}')

    except Exception as e:
        print(f'[ERROR] on_message: {e}')


mqtt_client.on_connect    = on_connect
mqtt_client.on_disconnect = on_disconnect
mqtt_client.on_message    = on_message


# ── Command publishing ────────────────────────────────────────────────────────
def send_command(actuator: str, cmd_state: int) -> bool:
    """
    Publish actuator command to MQTT_TOPIC_COMMAND.
    Suppresses exact duplicate within 5 seconds to avoid MQTT spam.
    Updates active_controls so flask_api.py can block conflicting manual cmds.
    """
    last = state['last_command_sent'].get(actuator, {})
    if last.get('state') == cmd_state and time.time() - last.get('time', 0) < 5:
        return True   # duplicate suppressed

    command = {
        'actuator':  actuator,
        'state':     cmd_state,
        'source':    'automation_flc',
        'timestamp': datetime.now(timezone.utc).isoformat(),
    }
    try:
        result = mqtt_client.publish(MQTT_TOPIC_COMMAND, json.dumps(command), qos=1)
        result.wait_for_publish(timeout=2.0)
        state['last_command_sent'][actuator] = {'state': cmd_state, 'time': time.time()}
        state['active_controls'][actuator]   = bool(cmd_state)
        print(f'[AUTO] {actuator.upper()} → {"ON" if cmd_state else "OFF"}')
        return True
    except Exception as e:
        print(f'[ERROR] send_command {actuator}: {e}')
        return False


# ── Pump safety ───────────────────────────────────────────────────────────────
def can_run_pump() -> bool:
    """Identical safety check to automation_engine.py v2."""
    now = datetime.now(timezone.utc)
    if state['last_pump_time']:
        elapsed = (now - state['last_pump_time']).total_seconds()
        if elapsed < PUMP_COOLDOWN_MIN * 60:
            remaining = PUMP_COOLDOWN_MIN * 60 - elapsed
            print(f'[AUTO] Pump cooldown active ({remaining:.0f} s remaining)')
            return False
    cutoff = now - timedelta(days=1)
    state['pump_history'] = [t for t in state['pump_history'] if t > cutoff]
    if len(state['pump_history']) >= MAX_PUMP_RUNS:
        print(f'[AUTO] Pump daily limit reached ({MAX_PUMP_RUNS} runs)')
        return False
    return True


def activate_pump(duration_s: int) -> None:
    """
    Turn pump ON for duration_s seconds, then OFF.
    Runs the OFF command in a daemon thread so the main loop is not blocked.
    Safety limits (cooldown, daily cap) are checked before activation.
    """
    if not can_run_pump():
        return

    send_command('pump', 1)
    now = datetime.now(timezone.utc)
    state['last_pump_time'] = now
    state['pump_history'].append(now)

    def stop_pump():
        time.sleep(duration_s)
        send_command('pump', 0)
        state['active_controls']['pump'] = False
        print(f'[AUTO] Pump cycle complete ({duration_s} s)')

    threading.Thread(target=stop_pump, daemon=True).start()


# ── FLC decision → actuator commands ─────────────────────────────────────────
def apply_flc_outputs(flc_out: dict) -> None:
    """
    Translate FLC crisp outputs into binary MQTT commands.

    Heater / Fan logic
    ──────────────────
    The heater_out value encodes both heating need (high value) and
    cooling need (low value, which means temp is warm/hot).

      heater_out > HEATER_ON_THRESHOLD (40):  heater ON,  fan OFF
      heater_out > FAN_ON_THRESHOLD    (60)
        AND heater_out < 20             :       fan ON,     heater OFF
        (this condition is unreachable — if heater_out > 60, heater fires)
      heater_out < 20 (temp is warm/hot):  check if fan needed via temp MF

    A separate fan_needed flag is derived directly from the temperature
    membership to keep fan logic explicit and readable.

    Pump logic
    ──────────
    pump_out is the FLC-recommended duration in seconds.
    Safety limits (cooldown, cap) are checked inside activate_pump().

    Lamp logic
    ──────────
    lamp_out > LAMP_ON_THRESHOLD (30) → lamp ON
    """
    heater_out = flc_out['heater_out']
    pump_out   = flc_out['pump_out']
    lamp_out   = flc_out['lamp_out']

    # ── Heater ────────────────────────────────────────────────────────────────
    if heater_out > HEATER_ON_THRESHOLD:
        if not state['actuators']['heater']:
            send_command('heater', 1)
        if state['actuators']['fan']:
            send_command('fan', 0)
    else:
        if state['actuators']['heater']:
            send_command('heater', 0)

    # ── Fan ───────────────────────────────────────────────────────────────────
    # Fan turns on when FLC says heater is very low (temp is warm/hot) AND
    # the heater is currently off. We derive fan need from heater_out < 15
    # (which corresponds to warm/hot temperature MF regions in the rule base).
    if heater_out < 15:   # heater output low = temp is warm or hot
        if not state['actuators']['fan']:
            send_command('fan', 1)
        if state['actuators']['heater']:
            send_command('heater', 0)
    else:
        # Dead zone (15–40) or heater zone (>40): fan should be off
        if state['actuators']['fan']:
            send_command('fan', 0)

    # ── Pump ──────────────────────────────────────────────────────────────────
    duration_s = int(round(pump_out))
    if duration_s > PUMP_MIN_DURATION_S and not state['active_controls']['pump']:
        print(f'[AUTO] FLC → pump {duration_s} s '
              f'(raw output={pump_out:.1f})')
        activate_pump(duration_s)

    # ── Lamp ──────────────────────────────────────────────────────────────────
    if lamp_out > LAMP_ON_THRESHOLD:
        if not state['actuators']['lamp']:
            send_command('lamp', 1)
    else:
        if state['actuators']['lamp']:
            send_command('lamp', 0)


# ── Main automation loop ──────────────────────────────────────────────────────
def run_loop(flc: FLC) -> None:
    print('[AUTO] FLC automation loop started')

    while True:
        try:
            # ── Guard: automation disabled ────────────────────────────────────
            if not state['enabled']:
                time.sleep(CHECK_INTERVAL_S)
                continue

            # ── Guard: MQTT not connected ─────────────────────────────────────
            if not state['mqtt_connected']:
                print('[WARN] MQTT not connected — waiting')
                time.sleep(CHECK_INTERVAL_S)
                continue

            # ── Guard: no sensor data yet ──────────────────────────────────────
            last = state['sensors']['last_sensor_update']
            if last is None:
                print('[WARN] No sensor data yet — waiting')
                time.sleep(CHECK_INTERVAL_S)
                continue

            # ── Guard: stale sensor data (> 90 s) ─────────────────────────────
            age = (datetime.now(timezone.utc) - last).total_seconds()
            if age > 90:
                print(f'[WARN] Sensor data stale ({age:.0f} s) — waiting')
                time.sleep(CHECK_INTERVAL_S)
                continue

            # ── Resolve FLC inputs ─────────────────────────────────────────────
            s = state['sensors']

            air_temp = s['air_temp_c']
            if air_temp is None:
                print('[WARN] air_temp_c missing — skipping cycle')
                time.sleep(CHECK_INTERVAL_S)
                continue

            soil_moisture = s['soil_moisture_pct']
            if soil_moisture is None:
                raw = s['soil_moisture_raw']
                if raw is not None:
                    soil_moisture = raw_to_pct(int(raw))
                else:
                    print('[WARN] soil_moisture unavailable — skipping cycle')
                    time.sleep(CHECK_INTERVAL_S)
                    continue

            light = s['light_raw'] if s['light_raw'] is not None else 500.0

            # VPD is computed locally — no extra sensor
            humidity = s['air_humidity_pct']
            if humidity is not None and air_temp is not None:
                vpd = calc_vpd(air_temp, humidity)
            else:
                vpd = FLC.DEFAULT_VPD

            # Outdoor temp and frost risk: from optional weather topic
            # or safe defaults if the ML prediction process is not running
            w = state['weather']
            outdoor_temp = w['outdoor_temp_c'] if w['outdoor_temp_c'] is not None \
                           else FLC.DEFAULT_OUTDOOR_TEMP
            frost_risk   = w['frost_risk']     if w['frost_risk']     is not None \
                           else FLC.DEFAULT_FROST_RISK

            # Check weather staleness (warn if > 10 minutes old)
            if w['last_update'] is not None:
                weather_age = (datetime.now(timezone.utc) - w['last_update']).total_seconds()
                if weather_age > 600:
                    print(f'[WARN] Weather data stale ({weather_age:.0f} s) '
                          f'— using defaults (outdoor={outdoor_temp}°C, '
                          f'frost={frost_risk})')
            elif w['outdoor_temp_c'] is None:
                print(f'[INFO] No weather data — using defaults '
                      f'(outdoor={outdoor_temp}°C, frost={frost_risk})')

            # ── Run FLC ───────────────────────────────────────────────────────
            flc_out = flc.run(
                air_temp     = air_temp,
                soil_moisture= soil_moisture,
                light        = light,
                outdoor_temp = outdoor_temp,
                vpd          = vpd,
                frost_risk   = frost_risk,
            )

            print(
                f'[FLC] '
                f'temp={air_temp:.1f}°C  '
                f'soil={soil_moisture:.1f}%  '
                f'light={light:.0f}  '
                f'vpd={vpd:.1f}hPa  '
                f'outdoor={outdoor_temp:.1f}°C  '
                f'frost={frost_risk:.1f}  '
                f'→  '
                f'heater={flc_out["heater_out"]:.1f}  '
                f'pump={flc_out["pump_out"]:.1f}s  '
                f'lamp={flc_out["lamp_out"]:.1f}'
            )

            # ── Translate FLC outputs → actuator commands ─────────────────────
            apply_flc_outputs(flc_out)

            # ── Publish status for flask_api ──────────────────────────────────
            status = {
                'enabled':         state['enabled'],
                'mode':            'flc',
                'active_controls': state['active_controls'],
                'flc_outputs': {
                    'heater_intensity': round(flc_out['heater_out'], 1),
                    'pump_duration_s':  round(flc_out['pump_out'],   1),
                    'lamp_power':       round(flc_out['lamp_out'],   1),
                },
                'flc_inputs': {
                    'air_temp_c':     round(air_temp,      2),
                    'soil_moisture':  round(soil_moisture, 1),
                    'light_raw':      light,
                    'vpd_hpa':        round(vpd,           2),
                    'outdoor_temp_c': round(outdoor_temp,  1),
                    'frost_risk':     round(frost_risk,    2),
                },
                'sensors': {
                    'air_temp_c':        s['air_temp_c'],
                    'soil_moisture_pct': s['soil_moisture_pct'],
                    'light_raw':         s['light_raw'],
                },
                'actuators': {
                    'pump':   state['actuators']['pump'],
                    'fan':    state['actuators']['fan'],
                    'heater': state['actuators']['heater'],
                    'lamp':   state['actuators']['lamp'],
                },
                'timestamp': datetime.now(timezone.utc).isoformat(),
            }
            mqtt_client.publish(MQTT_TOPIC_AUTOMATION, json.dumps(status), qos=0)

        except Exception as e:
            import traceback
            print(f'[ERROR] Loop: {e}')
            traceback.print_exc()

        time.sleep(CHECK_INTERVAL_S)


# ── Entry point ───────────────────────────────────────────────────────────────
def main():
    print('=' * 65)
    print(' AgriControl — Automation Engine v3  (Mamdani FLC)')
    print('=' * 65)
    print(f'  MQTT broker:       {MQTT_HOST}:{MQTT_PORT}')
    print(f'  Telemetry topic:   {MQTT_TOPIC_TELEMETRY}')
    print(f'  Command topic:     {MQTT_TOPIC_COMMAND}')
    print(f'  Automation topic:  {MQTT_TOPIC_AUTOMATION}')
    print(f'  Weather topic:     {MQTT_TOPIC_WEATHER}  (optional)')
    print(f'  Frost topic:       {MQTT_TOPIC_FROST}  (optional)')
    print()
    print(f'  FLC thresholds:')
    print(f'    Heater ON:   heater_out > {HEATER_ON_THRESHOLD}')
    print(f'    Fan ON:      heater_out < 15  (warm/hot zone)')
    print(f'    Lamp ON:     lamp_out   > {LAMP_ON_THRESHOLD}')
    print(f'    Pump ON:     pump_out   > {PUMP_MIN_DURATION_S} s')
    print()
    print(f'  Pump safety:')
    print(f'    Cooldown:  {PUMP_COOLDOWN_MIN} min   daily cap: {MAX_PUMP_RUNS} runs')
    print()
    print(f'  FLC defaults when weather topic unavailable:')
    print(f'    outdoor_temp_c = {FLC.DEFAULT_OUTDOOR_TEMP} °C')
    print(f'    frost_risk     = {FLC.DEFAULT_FROST_RISK}')
    print(f'    vpd            = {FLC.DEFAULT_VPD} hPa')
    print(f'  Check interval:  {CHECK_INTERVAL_S} s')
    print('=' * 65)

    # Build FLC (takes < 1 s — numpy array allocations only)
    print('[INIT] Building Mamdani FIS... ', end='', flush=True)
    flc = FLC()
    print('done')

    # Connect MQTT
    try:
        mqtt_client.connect(MQTT_HOST, MQTT_PORT, keepalive=60)
        mqtt_client.loop_start()
    except Exception as e:
        print(f'[ERROR] Cannot connect to MQTT: {e}')
        return

    for i in range(10):
        time.sleep(1)
        if state['mqtt_connected']:
            print('[INIT] MQTT connected')
            break
        print(f'[INIT] Waiting for MQTT... ({i + 1}/10)')

    if not state['mqtt_connected']:
        print('[ERROR] MQTT connection timeout — exiting')
        return

    try:
        run_loop(flc)
    except KeyboardInterrupt:
        print('\n[SHUTDOWN] Stopping FLC automation engine')
        mqtt_client.loop_stop()
        mqtt_client.disconnect()


if __name__ == '__main__':
    main()
