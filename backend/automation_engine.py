"""
automation_engine.py  —  AgriControl, v3
=========================================
Monitors sensor data via MQTT and controls actuators based on
rule-based thresholds. Runs as a standalone process, independently
of flask_api.py.

Changes from v2
─────────────────────────────
  Pump duration and cooldown
    v2: PUMP_DURATION_S = 30, PUMP_COOLDOWN_MIN = 60.
    v3: PUMP_DURATION_S = 1,  PUMP_COOLDOWN_MIN = 120.

    Rationale: empirical observation during micro-greenhouse assembly
    showed that the 5V submersible pump delivers approximately 55 ml/s
    at upper-bound flow rate (200 L/hr). 30 seconds therefore delivered
    ~440 ml, flooding the bottom sub-irrigation tray. 1 second delivers
    ~20–55 ml, appropriate for a tray of ~270 ml total capacity.
    120-minute cooldown allows capillary wicking from the bottom tray
    to fully equilibrate the soil moisture reading before reconsidering
    irrigation (sub-irrigation wicks slowly; sensor response lags
    physical wetting by 15–30 minutes).

  Pump saturation pre-check (NEW)
    v2: no pre-check — pump triggered whenever pct < SOIL_PCT_DRY,
        even if soil was already at or above saturation.
    v3: check_soil_moisture() skips pump activation if
        soil_moisture_pct >= SOIL_PCT_WET (55 %) and logs a warning.
        This prevents overwatering when the bottom tray is still full
        from a previous cycle.

  Heater hard ceiling (NEW)
    v2: no upper safety limit on temperature.
    v3: if air_temp_c > TEMP_CEILING (35 °C), heater is forced OFF
        unconditionally. Protects sealed micro-greenhouse from runaway
        heating caused by combined heating sheet + phytolamp load.

  Humidity-based fan control (NEW)
    v2: fan controlled by temperature only.
    v3: fan also turns ON if air_humidity_pct > HUMIDITY_HIGH (80 %).
        Fan turns OFF only when BOTH temperature and humidity conditions
        are resolved (temp < TEMP_FAN_OFF AND humidity < HUMIDITY_LOW).
        Rationale: 95 % RH observed during testing poses fungal disease
        risk. DHT11 accuracy degrades above ~80 % RH, so 80 % trigger
        intervenes before the sensor enters its least reliable region.
        Consistent with greenhouse best practice: ventilation is the
        primary mitigation for high humidity in small enclosures.

  Lamp control — schedule only (CHANGED)
    v2: lamp turned OFF during schedule hours when light_raw exceeded
        LIGHT_DARK threshold.
    v3: lamp is schedule-only. Light sensor is too close to the lamp
        inside the 18.5 × 14.5 × 14.5 cm enclosure to provide useful
        control feedback — it saturates when the lamp is on, producing
        circular on/off switching. light_raw continues to be published
        to InfluxDB as a monitoring and ML data channel.
        Consistent with industry practice: photoperiod/schedule control
        is standard for phytolamps; point sensors are used for DLI
        monitoring, not single-lamp switching.

  Fan/heater interlock (PRESERVED from v2)
    Heater ON → fan forced OFF (no point cooling while heating).
    Fan ON → heater forced OFF (no point heating while ventilating).
"""

import os
import json
import time
import threading
from datetime import datetime, timezone, timedelta

import paho.mqtt.client as mqtt
from dotenv import load_dotenv

load_dotenv()

# ── Configuration ─────────────────────────────────────────────────────────────
MQTT_HOST             = os.getenv('MQTT_HOST',             'localhost')
MQTT_PORT             = int(os.getenv('MQTT_PORT',         '1883'))
MQTT_TOPIC_TELEMETRY  = os.getenv('MQTT_TOPIC_TELEMETRY',  'greenhouse/mega1/telemetry')
MQTT_TOPIC_COMMAND    = os.getenv('MQTT_TOPIC_COMMAND',    'greenhouse/mega1/command')
MQTT_TOPIC_AUTOMATION = os.getenv('MQTT_TOPIC_AUTOMATION', 'greenhouse/automation/status')

# ── Automation rules ──────────────────────────────────────────────────────────
class Rules:
    # ── Temperature (°C) ──────────────────────────────────────────────────────
    # air_temp_c arrives from firmware v1.3 already offset-corrected
    # (-0.3 °C DHT11 calibration offset applied in firmware, Report #6).
    # No further correction needed here.
    AIR_TEMP_BIAS_C   = 0.0

    TEMP_HEATER_ON    = float(os.getenv('TEMP_HEATER_ON',  '20.0'))  # heater ON below this
    TEMP_HEATER_OFF   = float(os.getenv('TEMP_HEATER_OFF', '22.0'))  # heater OFF above this
    TEMP_FAN_ON       = float(os.getenv('TEMP_FAN_ON',     '26.0'))  # fan ON above this
    TEMP_FAN_OFF      = float(os.getenv('TEMP_FAN_OFF',    '24.0'))  # fan OFF below this
    TEMP_CEILING      = float(os.getenv('TEMP_CEILING',    '35.0'))  # hard heater cutoff

    # ── Humidity (%) ──────────────────────────────────────────────────────────
    # DHT11 accuracy degrades above ~80 % RH. Fan trigger set at 80 %
    # to intervene before the sensor enters its least reliable region.
    HUMIDITY_HIGH     = float(os.getenv('HUMIDITY_HIGH',   '80.0'))  # fan ON above this
    HUMIDITY_LOW      = float(os.getenv('HUMIDITY_LOW',    '70.0'))  # fan OFF below this (only if temp also OK)

    # ── Soil moisture (calibrated %) ──────────────────────────────────────────
    # Uses soil_moisture_pct from firmware v1.3.
    # Falls back to computing pct from raw ADC if firmware sends raw only.
    # Threshold derivation: ADC 380 ≈ 36 % via piecewise interpolation
    # (Report #5). SOIL_PCT_DRY = 35 % matches historical behaviour while
    # remaining in the reliable 20–60 % calibration segment.
    SOIL_PCT_DRY      = float(os.getenv('SOIL_PCT_DRY',   '35.0'))  # pump ON below this
    SOIL_PCT_WET      = float(os.getenv('SOIL_PCT_WET',   '55.0'))  # saturation lockout above this

    # 4-point calibration curve — used only for raw ADC fallback
    # Source: Report #5, Sensor 1, peat soil, gravimetric method
    SOIL_CAL_POINTS   = [(427, 0.0), (402, 20.0), (313, 40.0), (199, 60.0)]

    # ── Lamp schedule ─────────────────────────────────────────────────────────
    # Schedule-only control. Light sensor is too close to the lamp in the
    # micro-greenhouse enclosure to be used for threshold control — it
    # saturates when the lamp is on. light_raw is logged to InfluxDB
    # as a monitoring/ML channel only.
    LIGHT_ON_HOUR     = int(os.getenv('LIGHT_ON_HOUR',    '6'))
    LIGHT_OFF_HOUR    = int(os.getenv('LIGHT_OFF_HOUR',   '22'))

    # ── Pump safety ───────────────────────────────────────────────────────────
    # Duration: 1 second ≈ 20–55 ml at observed pump flow rate (200 L/hr
    # upper bound). Sufficient for sub-irrigation tray top-up without flooding.
    # Cooldown: 120 minutes allows capillary wicking to equilibrate before
    # the next irrigation decision.
    PUMP_DURATION_S   = int(os.getenv('PUMP_DURATION',    '1'))
    PUMP_COOLDOWN_MIN = int(os.getenv('PUMP_COOLDOWN',    '120'))
    MAX_PUMP_RUNS     = int(os.getenv('MAX_PUMP_RUNS',    '10'))

    # ── Loop interval ─────────────────────────────────────────────────────────
    CHECK_INTERVAL_S  = int(os.getenv('AUTO_CHECK_INTERVAL', '10'))


# ── Global state ──────────────────────────────────────────────────────────────
state = {
    'enabled': True,
    'mqtt_connected': False,
    # Sensor values — updated only when a sensor payload arrives
    'sensors': {
        'air_temp_c':         None,
        'air_humidity_pct':   None,
        'soil_temp_c':        None,
        'soil_moisture_raw':  None,
        'soil_moisture_pct':  None,
        'light_raw':          None,
        'last_sensor_update': None,
    },
    # Actuator states — updated only when an actuator payload arrives
    'actuators': {
        'pump':   0,
        'fan':    0,
        'heater': 0,
        'lamp':   0,
        'last_actuator_update': None,
    },
    # Tracks which actuators this engine is currently controlling
    'active_controls': {
        'pump': False, 'fan': False, 'heater': False, 'lamp': False,
    },
    'pump_history':      [],
    'last_pump_time':    None,
    'last_command_sent': {},
}

SENSOR_KEYS   = {'air_temp_c', 'air_humidity_pct', 'soil_temp_c',
                 'soil_moisture_raw', 'soil_moisture_pct', 'light_raw'}
ACTUATOR_KEYS = {'pump', 'lamp', 'heater', 'fan'}


# ── Calibration helper (raw ADC fallback) ─────────────────────────────────────
def raw_to_pct(raw: int) -> float:
    """
    4-point piecewise linear interpolation — mirrors mqtt_to_influx.py.
    Used only when firmware does not include soil_moisture_pct in the payload.
    """
    pts = Rules.SOIL_CAL_POINTS
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


# ── MQTT ──────────────────────────────────────────────────────────────────────
mqtt_client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2,
                          client_id='automation_engine')


def on_connect(client, userdata, flags, rc, properties=None):
    if rc == 0:
        print(f'[MQTT] Connected to {MQTT_HOST}:{MQTT_PORT}')
        state['mqtt_connected'] = True
        client.subscribe(MQTT_TOPIC_TELEMETRY)
        client.subscribe(MQTT_TOPIC_COMMAND)
        client.subscribe(MQTT_TOPIC_AUTOMATION)
    else:
        print(f'[MQTT] Connection failed rc={rc}')
        state['mqtt_connected'] = False


def on_disconnect(client, userdata, flags, rc, properties=None):
    print(f'[MQTT] Disconnected rc={rc}')
    state['mqtt_connected'] = False


def on_message(client, userdata, msg):
    """
    Handle incoming MQTT messages.

    Firmware v1.3 sends split payloads on the same topic:
      - sensor payload  (every 30 s): sensor keys only
      - actuator payload (every 2 s): actuator keys only
    Both are handled independently so neither overwrites the other's state.
    """
    try:
        data  = json.loads(msg.payload.decode())
        topic = msg.topic

        if topic == MQTT_TOPIC_TELEMETRY:
            has_sensors   = bool(SENSOR_KEYS   & data.keys())
            has_actuators = bool(ACTUATOR_KEYS & data.keys())

            if has_sensors:
                s = state['sensors']
                s['air_temp_c']        = data.get('air_temp_c')
                s['air_humidity_pct']  = data.get('air_humidity_pct')
                s['soil_temp_c']       = data.get('soil_temp_c')
                s['soil_moisture_raw'] = data.get('soil_moisture_raw')
                # Prefer pct from firmware; fall back to computing from raw
                pct = data.get('soil_moisture_pct')
                if pct is None and s['soil_moisture_raw'] is not None:
                    pct = raw_to_pct(int(s['soil_moisture_raw']))
                s['soil_moisture_pct']  = pct
                s['light_raw']          = data.get('light_raw')
                s['last_sensor_update'] = datetime.now(timezone.utc)

            if has_actuators:
                a = state['actuators']
                a['pump']   = data.get('pump',   a['pump'])
                a['fan']    = data.get('fan',    a['fan'])
                a['heater'] = data.get('heater', a['heater'])
                a['lamp']   = data.get('lamp',   a['lamp'])
                a['last_actuator_update'] = datetime.now(timezone.utc)

        elif topic == MQTT_TOPIC_COMMAND:
            print(f'[MQTT-CMD] Observed: {data.get("actuator")} → {data.get("state")}')

        elif topic == MQTT_TOPIC_AUTOMATION:
            # Flask publishes here when /api/automation is called.
            enabled = data.get('enabled')
            if enabled is not None:
                state['enabled'] = bool(enabled)
                print(f'[AUTO] Automation {"ENABLED" if enabled else "DISABLED"} via MQTT')

    except Exception as e:
        print(f'[ERROR] on_message: {e}')


mqtt_client.on_connect    = on_connect
mqtt_client.on_disconnect = on_disconnect
mqtt_client.on_message    = on_message


# ── Command publishing ────────────────────────────────────────────────────────
def send_command(actuator: str, cmd_state: int) -> bool:
    """Publish an actuator command. Suppresses duplicates within 5 seconds."""
    last = state['last_command_sent'].get(actuator, {})
    if last.get('state') == cmd_state and time.time() - last.get('time', 0) < 5:
        return True

    command = {
        'actuator':  actuator,
        'state':     cmd_state,
        'source':    'automation',
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
    now = datetime.now(timezone.utc)
    if state['last_pump_time']:
        elapsed = (now - state['last_pump_time']).total_seconds()
        if elapsed < Rules.PUMP_COOLDOWN_MIN * 60:
            remaining_min = (Rules.PUMP_COOLDOWN_MIN * 60 - elapsed) / 60
            print(f'[AUTO] Pump cooldown active — {remaining_min:.0f} min remaining')
            return False
    cutoff = now - timedelta(days=1)
    state['pump_history'] = [t for t in state['pump_history'] if t > cutoff]
    if len(state['pump_history']) >= Rules.MAX_PUMP_RUNS:
        print(f'[WARN] Pump daily limit reached ({Rules.MAX_PUMP_RUNS} runs)')
        return False
    return True


def activate_pump():
    if not can_run_pump():
        return
    send_command('pump', 1)
    now = datetime.now(timezone.utc)
    state['last_pump_time'] = now
    state['pump_history'].append(now)

    def stop_pump():
        time.sleep(Rules.PUMP_DURATION_S)
        send_command('pump', 0)
        state['active_controls']['pump'] = False
        print(f'[AUTO] Pump timer complete ({Rules.PUMP_DURATION_S} s)')

    threading.Thread(target=stop_pump, daemon=True).start()


# ── Control logic ─────────────────────────────────────────────────────────────
def check_temperature():
    raw_temp = state['sensors']['air_temp_c']
    if raw_temp is None:
        return
    temp = raw_temp + Rules.AIR_TEMP_BIAS_C

    heater = state['actuators']['heater']
    fan    = state['actuators']['fan']

    # Hard ceiling — force heater off regardless of all other conditions
    if temp > Rules.TEMP_CEILING:
        if heater:
            print(f'[SAFETY] Temp {temp:.1f}°C > ceiling {Rules.TEMP_CEILING}°C — heater FORCED OFF')
            send_command('heater', 0)
        return  # do not apply normal heater logic when ceiling is breached

    # Normal heater logic
    if temp < Rules.TEMP_HEATER_ON:
        if not heater:
            print(f'[AUTO] Temp {temp:.1f}°C < {Rules.TEMP_HEATER_ON}°C → heater ON')
            send_command('heater', 1)
            # Interlock: heater ON → fan OFF
            if fan:
                print(f'[AUTO] Heater interlock → fan OFF')
                send_command('fan', 0)
    elif temp > Rules.TEMP_HEATER_OFF:
        if heater:
            print(f'[AUTO] Temp {temp:.1f}°C > {Rules.TEMP_HEATER_OFF}°C → heater OFF')
            send_command('heater', 0)

    # Fan temperature trigger (evaluated independently of heater logic)
    if temp > Rules.TEMP_FAN_ON:
        if not fan:
            print(f'[AUTO] Temp {temp:.1f}°C > {Rules.TEMP_FAN_ON}°C → fan ON')
            send_command('fan', 1)
            # Interlock: fan ON → heater OFF
            if heater:
                print(f'[AUTO] Fan interlock → heater OFF')
                send_command('heater', 0)


def check_humidity():
    """
    Fan-based humidity control, independent of temperature.

    Fan turns ON if humidity exceeds HUMIDITY_HIGH (80 %).
    Fan turns OFF due to humidity only when BOTH humidity < HUMIDITY_LOW
    AND temperature is also below TEMP_FAN_ON — temperature control
    takes priority; do not turn fan off if temperature still needs it.

    DHT11 accuracy degrades above ~80 % RH (datasheet ±4–5 % RH),
    so the trigger is placed at 80 % to intervene before the sensor
    enters its least reliable region.
    """
    humidity = state['sensors']['air_humidity_pct']
    if humidity is None:
        return

    fan  = state['actuators']['fan']
    temp = state['sensors']['air_temp_c']

    if humidity > Rules.HUMIDITY_HIGH:
        if not fan:
            print(f'[AUTO] Humidity {humidity:.1f}% > {Rules.HUMIDITY_HIGH}% → fan ON')
            send_command('fan', 1)
            # Interlock: fan ON → heater OFF
            heater = state['actuators']['heater']
            if heater:
                print(f'[AUTO] Fan (humidity) interlock → heater OFF')
                send_command('heater', 0)

    elif humidity < Rules.HUMIDITY_LOW and fan:
        # Only turn fan off from humidity logic if temperature also does not need it
        temp_needs_fan = (temp is not None and temp > Rules.TEMP_FAN_OFF)
        if not temp_needs_fan:
            print(f'[AUTO] Humidity {humidity:.1f}% < {Rules.HUMIDITY_LOW}% and temp OK → fan OFF')
            send_command('fan', 0)


def check_soil_moisture():
    """
    Trigger pump when soil_moisture_pct drops below SOIL_PCT_DRY (35 %).

    Pre-check: skip if soil_moisture_pct >= SOIL_PCT_WET (55 %) —
    soil is already at or approaching saturation; further irrigation
    would push the sub-irrigation tray beyond capacity.

    soil_moisture_pct is preferred (firmware v1.3 includes it directly).
    If not present, it is computed from soil_moisture_raw using the same
    4-point calibration curve as mqtt_to_influx.py (Report #5).

    Using percentage rather than raw ADC ensures the threshold is
    physically meaningful and independent of sensor unit variance
    (Sensor 1 vs Sensor 2 differ by up to 109 ADC counts at 40 %
    moisture — Report #5, Section 3.3).
    """
    pct = state['sensors']['soil_moisture_pct']
    if pct is None:
        return

    # Saturation pre-check — do not irrigate if already wet
    if pct >= Rules.SOIL_PCT_WET:
        if state['active_controls']['pump']:
            pass  # pump is already running from a previous activation; let timer handle it
        else:
            print(f'[WARN] Soil {pct:.1f}% >= {Rules.SOIL_PCT_WET}% (saturated) — pump skipped')
        return

    if pct < Rules.SOIL_PCT_DRY:
        if not state['active_controls']['pump']:
            print(f'[AUTO] Soil {pct:.1f}% < {Rules.SOIL_PCT_DRY}% → pump ON')
            activate_pump()


def check_light():
    """
    Schedule-only lamp control.

    The TEMT6000 light sensor is mounted inside the micro-greenhouse
    enclosure (18.5 × 14.5 × 14.5 cm). At this proximity to the
    phytolamp, the sensor saturates when the lamp is on, making
    threshold-based control unreliable (circular on/off switching).

    Lamp is therefore controlled by photoperiod schedule only:
      ON  during LIGHT_ON_HOUR  (06:00) to LIGHT_OFF_HOUR (22:00)
      OFF outside schedule

    light_raw continues to be published to InfluxDB as a monitoring
    and ML data channel. This is consistent with greenhouse best
    practice where phytolamps are typically scheduled by photoperiod
    rather than driven by a single proximal point sensor.
    """
    hour = datetime.now().hour
    lamp = state['actuators']['lamp']
    in_schedule = Rules.LIGHT_ON_HOUR <= hour < Rules.LIGHT_OFF_HOUR

    if in_schedule and not lamp:
        print(f'[AUTO] Schedule active ({hour}:00) → lamp ON')
        send_command('lamp', 1)
    elif not in_schedule and lamp:
        print(f'[AUTO] Outside schedule ({hour}:00) → lamp OFF')
        send_command('lamp', 0)


# ── Main loop ─────────────────────────────────────────────────────────────────
def run_loop():
    print('[AUTO] Automation loop started')
    while True:
        try:
            if not state['enabled'] or not state['mqtt_connected']:
                time.sleep(Rules.CHECK_INTERVAL_S)
                continue

            last = state['sensors']['last_sensor_update']
            if last is None:
                print('[WARN] No sensor data yet — waiting')
                time.sleep(Rules.CHECK_INTERVAL_S)
                continue

            age = (datetime.now(timezone.utc) - last).total_seconds()
            if age > 90:
                print(f'[WARN] Sensor data stale ({age:.0f} s) — skipping control cycle')
                time.sleep(Rules.CHECK_INTERVAL_S)
                continue

            check_temperature()
            check_humidity()
            check_soil_moisture()
            check_light()

            # Publish status for flask_api to read
            status = {
                'enabled':         state['enabled'],
                'active_controls': state['active_controls'],
                'sensors': {
                    'air_temp_c':        state['sensors']['air_temp_c'],
                    'air_humidity_pct':  state['sensors']['air_humidity_pct'],
                    'soil_moisture_pct': state['sensors']['soil_moisture_pct'],
                    'light_raw':         state['sensors']['light_raw'],
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
            print(f'[ERROR] Loop: {e}')

        time.sleep(Rules.CHECK_INTERVAL_S)


def main():
    print('=' * 60)
    print(' AgriControl — Automation Engine v3')
    print('=' * 60)
    print(f'  MQTT:              {MQTT_HOST}:{MQTT_PORT}')
    print(f'  Heater ON:         < {Rules.TEMP_HEATER_ON} °C')
    print(f'  Heater OFF:        > {Rules.TEMP_HEATER_OFF} °C')
    print(f'  Heater ceiling:    > {Rules.TEMP_CEILING} °C (forced OFF)')
    print(f'  Fan ON (temp):     > {Rules.TEMP_FAN_ON} °C')
    print(f'  Fan OFF (temp):    < {Rules.TEMP_FAN_OFF} °C')
    print(f'  Fan ON (humidity): > {Rules.HUMIDITY_HIGH} %')
    print(f'  Fan OFF (humidity):< {Rules.HUMIDITY_LOW} % (only if temp also OK)')
    print(f'  Pump trigger:      soil_moisture_pct < {Rules.SOIL_PCT_DRY} %')
    print(f'  Pump lockout:      soil_moisture_pct >= {Rules.SOIL_PCT_WET} % (saturated)')
    print(f'  Pump duration:     {Rules.PUMP_DURATION_S} s')
    print(f'  Pump cooldown:     {Rules.PUMP_COOLDOWN_MIN} min')
    print(f'  Lamp schedule:     {Rules.LIGHT_ON_HOUR}:00 – {Rules.LIGHT_OFF_HOUR}:00 (schedule only)')
    print('=' * 60)

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
        print(f'[INIT] Waiting for MQTT... ({i+1}/10)')

    if not state['mqtt_connected']:
        print('[ERROR] MQTT connection timeout — exiting')
        return

    try:
        run_loop()
    except KeyboardInterrupt:
        print('\n[SHUTDOWN] Stopping automation engine')
        mqtt_client.loop_stop()
        mqtt_client.disconnect()


if __name__ == '__main__':
    main()
