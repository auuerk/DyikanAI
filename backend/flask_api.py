"""
flask_api.py  —  AgriControl, v2
==================================
REST API server for the AgriControl greenhouse system.
Provides endpoints for manual actuator control, automation mode
toggle, system status, and historical data queries.
"""

import os
import json
from datetime import datetime, timezone
from flask import Flask, request, jsonify
from flask_cors import CORS
import paho.mqtt.client as mqtt
from influxdb_client import InfluxDBClient
from dotenv import load_dotenv
import time

load_dotenv()

app = Flask(__name__)
CORS(app)

# ── Configuration ─────────────────────────────────────────────────────────────
MQTT_HOST             = os.getenv('MQTT_HOST',             'localhost')
MQTT_PORT             = int(os.getenv('MQTT_PORT',         '1883'))
MQTT_TOPIC_COMMAND    = os.getenv('MQTT_TOPIC_COMMAND',    'greenhouse/mega1/command')
MQTT_TOPIC_TELEMETRY  = os.getenv('MQTT_TOPIC_TELEMETRY',  'greenhouse/mega1/telemetry')
MQTT_TOPIC_AUTOMATION = os.getenv('MQTT_TOPIC_AUTOMATION', 'greenhouse/automation/status')

INFLUX_URL    = os.getenv('INFLUX_URL',    'http://localhost:8086')
INFLUX_TOKEN  = os.getenv('INFLUX_TOKEN')
INFLUX_ORG    = os.getenv('INFLUX_ORG')
INFLUX_BUCKET = os.getenv('INFLUX_BUCKET', 'gh_sensor_data')
DEVICE_ID     = os.getenv('DEVICE_ID',     'mega-1')

# ── Global state ──────────────────────────────────────────────────────────────
system_state = {
    'automation_mode': False,
    'actuators': {
        'pump': 0, 'fan': 0, 'heater': 0, 'lamp': 0,
    },
    'sensors': {
        'air_temp_c':        None,
        'air_humidity_pct':  None,
        'soil_temp_c':       None,
        'soil_moisture_raw': None,
        'soil_moisture_pct': None,
        'light_raw':         None,
        'last_update':       None,
    },
    'automation_active': {
        'pump': False, 'fan': False, 'heater': False, 'lamp': False,
    },
    'mqtt_connected': False,
}

SENSOR_KEYS   = {'air_temp_c', 'air_humidity_pct', 'soil_temp_c',
                 'soil_moisture_raw', 'soil_moisture_pct', 'light_raw'}
ACTUATOR_KEYS = {'pump', 'lamp', 'heater', 'fan'}

# ── MQTT client ───────────────────────────────────────────────────────────────
mqtt_client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id='flask_api')


def on_connect(client, userdata, flags, rc, properties=None):
    if rc == 0:
        print(f'[MQTT] Connected to broker')
        system_state['mqtt_connected'] = True
        client.subscribe(MQTT_TOPIC_TELEMETRY)
        client.subscribe(MQTT_TOPIC_AUTOMATION)
    else:
        print(f'[MQTT] Connection failed rc={rc}')
        system_state['mqtt_connected'] = False


def on_disconnect(client, userdata, flags, rc, properties=None):
    print(f'[MQTT] Disconnected rc={rc}')
    system_state['mqtt_connected'] = False


def on_message(client, userdata, msg):
    try:
        data  = json.loads(msg.payload.decode())
        topic = msg.topic

        if topic == MQTT_TOPIC_TELEMETRY:
            has_sensors   = bool(SENSOR_KEYS   & data.keys())
            has_actuators = bool(ACTUATOR_KEYS & data.keys())

            if has_sensors:
                s = system_state['sensors']
                for key in ('air_temp_c', 'air_humidity_pct', 'soil_temp_c',
                            'soil_moisture_raw', 'soil_moisture_pct', 'light_raw'):
                    if key in data:
                        s[key] = data[key]
                s['last_update'] = datetime.now(timezone.utc).isoformat()

            if has_actuators:
                a = system_state['actuators']
                for key in ('pump', 'fan', 'heater', 'lamp'):
                    if key in data:
                        a[key] = data[key]

        elif topic == MQTT_TOPIC_AUTOMATION:
            system_state['automation_mode']   = data.get('enabled', False)
            system_state['automation_active'] = data.get('active_controls', {
                'pump': False, 'fan': False, 'heater': False, 'lamp': False,
            })

    except Exception as e:
        print(f'[ERROR] on_message: {e}')


mqtt_client.on_connect    = on_connect
mqtt_client.on_disconnect = on_disconnect
mqtt_client.on_message    = on_message

# ── InfluxDB client ───────────────────────────────────────────────────────────
influx_client = None
query_api     = None

if INFLUX_TOKEN and INFLUX_ORG:
    try:
        influx_client = InfluxDBClient(
            url=INFLUX_URL, token=INFLUX_TOKEN, org=INFLUX_ORG
        )
        query_api = influx_client.query_api()
        print(f'[INIT] InfluxDB client initialised')
    except Exception as e:
        print(f'[WARN] InfluxDB init failed: {e}')
else:
    print('[WARN] Missing INFLUX_TOKEN or INFLUX_ORG — history endpoints unavailable')

# ── Helpers ───────────────────────────────────────────────────────────────────
def publish_command(actuator: str, cmd_state: int, source: str = 'manual') -> bool:
    command = {
        'actuator':  actuator,
        'state':     int(cmd_state),
        'source':    source,
        'timestamp': datetime.now(timezone.utc).isoformat(),
    }
    try:
        result = mqtt_client.publish(
            MQTT_TOPIC_COMMAND, json.dumps(command), qos=1
        )
        result.wait_for_publish(timeout=2.0)
        print(f'[API] Command sent: {actuator} → {cmd_state}')
        return True
    except Exception as e:
        print(f'[ERROR] publish_command: {e}')
        return False

# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.route('/', methods=['GET'])
def index():
    return jsonify({
        'service': 'AgriControl Greenhouse API',
        'version': '2.0',
        'endpoints': {
            'status':           'GET  /api/status',
            'health':           'GET  /api/health',
            'actuator_control': 'POST /api/actuator/<name>',
            'automation':       'GET/POST /api/automation',
            'sensor_history':   'GET  /api/sensors/history',
            'filtered_history': 'GET  /api/sensors/history/filtered',
            'sensors_latest':   'GET  /api/sensors/latest',
            'comparison':       'GET  /api/sensors/comparison?sensor=<field>',
            'sparkline':        'GET  /api/sensors/sparkline?sensor=<field>',
            'actuator_history': 'GET  /api/actuators/history',
            'actuator_gantt':   'GET  /api/actuators/gantt',
        },
        'mqtt_connected': system_state['mqtt_connected'],
    })


@app.route('/api/status', methods=['GET'])
def get_status():
    return jsonify({
        'success':   True,
        'data':      system_state,
        'timestamp': datetime.now(timezone.utc).isoformat(),
    })


@app.route('/api/health', methods=['GET'])
def health_check():
    return jsonify({
        'success':            True,
        'service':            'agricontrol-api',
        'mqtt_connected':     system_state['mqtt_connected'],
        'last_sensor_update': system_state['sensors']['last_update'],
        'influxdb_available': query_api is not None,
        'timestamp':          datetime.now(timezone.utc).isoformat(),
    })


@app.route('/api/actuator/<actuator>', methods=['POST'])
def control_actuator(actuator):
    if actuator not in system_state['actuators']:
        return jsonify({
            'success': False,
            'error':   f'Unknown actuator: {actuator}',
            'valid':   list(system_state['actuators'].keys()),
        }), 400

    data = request.get_json()
    if not data:
        return jsonify({'success': False, 'error': 'No JSON body'}), 400

    try:
        cmd_state = int(data.get('state', 0))
    except (ValueError, TypeError):
        return jsonify({'success': False, 'error': 'state must be 0 or 1'}), 400

    if cmd_state not in (0, 1):
        return jsonify({'success': False, 'error': 'state must be 0 or 1'}), 400

    if (system_state['automation_mode'] and
            system_state['automation_active'].get(actuator)):
        return jsonify({
            'success':           False,
            'error':             f'Automation is controlling {actuator}',
            'automation_mode':   system_state['automation_mode'],
            'automation_active': system_state['automation_active'],
        }), 403

    if not system_state['mqtt_connected']:
        return jsonify({'success': False, 'error': 'MQTT not connected'}), 503

    if publish_command(actuator, cmd_state):
        system_state['actuators'][actuator] = cmd_state
        return jsonify({
            'success':   True,
            'actuator':  actuator,
            'state':     cmd_state,
            'timestamp': datetime.now(timezone.utc).isoformat(),
        })

    return jsonify({'success': False, 'error': 'Failed to publish command'}), 500


@app.route('/api/automation', methods=['GET', 'POST'])
def automation_mode():
    if request.method == 'GET':
        return jsonify({
            'success':           True,
            'automation_mode':   system_state['automation_mode'],
            'automation_active': system_state['automation_active'],
        })

    data = request.get_json()
    if not data:
        return jsonify({'success': False, 'error': 'No JSON body'}), 400

    enabled = bool(data.get('enabled', False))
    system_state['automation_mode'] = enabled
    if not enabled:
        for k in system_state['automation_active']:
            system_state['automation_active'][k] = False

    mqtt_client.publish(MQTT_TOPIC_AUTOMATION, json.dumps({
        'enabled':   enabled,
        'source':    'api',
        'timestamp': datetime.now(timezone.utc).isoformat(),
    }), qos=1)

    return jsonify({
        'success':         True,
        'automation_mode': enabled,
        'timestamp':       datetime.now(timezone.utc).isoformat(),
    })


@app.route('/api/sensors/history', methods=['GET'])
def get_sensor_history():
    if not query_api:
        return jsonify({'success': False, 'error': 'InfluxDB not configured'}), 503

    try:
        hours    = min(int(request.args.get('hours',    6)),  168)
        interval = max(int(request.args.get('interval', 5)),  1)

        query = f'''
from(bucket: "{INFLUX_BUCKET}")
  |> range(start: -{hours}h)
  |> filter(fn: (r) => r["_measurement"] == "sensor_readings")
  |> filter(fn: (r) => r["device"] == "{DEVICE_ID}")
  |> filter(fn: (r) =>
      r["_field"] == "air_temp_c"        or
      r["_field"] == "air_humidity_pct"  or
      r["_field"] == "soil_temp_c"       or
      r["_field"] == "soil_moisture_raw" or
      r["_field"] == "soil_moisture_pct" or
      r["_field"] == "light_raw"
  )
  |> aggregateWindow(every: {interval}m, fn: mean, createEmpty: false)
  |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
  |> sort(columns: ["_time"])
'''
        result = query_api.query(query=query, org=INFLUX_ORG)
        data_points = []
        for table in result:
            for record in table.records:
                data_points.append({
                    'time':              record.get_time().isoformat(),
                    'air_temp_c':        record.values.get('air_temp_c'),
                    'air_humidity_pct':  record.values.get('air_humidity_pct'),
                    'soil_temp_c':       record.values.get('soil_temp_c'),
                    'soil_moisture_raw': record.values.get('soil_moisture_raw'),
                    'soil_moisture_pct': record.values.get('soil_moisture_pct'),
                    'light_raw':         record.values.get('light_raw'),
                })

        return jsonify({
            'success':          True,
            'measurement':      'sensor_readings',
            'data':             data_points,
            'hours':            hours,
            'interval_minutes': interval,
            'count':            len(data_points),
        })

    except Exception as e:
        print(f'[ERROR] sensor history: {e}')
        return jsonify({'success': False, 'error': str(e)}), 500


# PATCH: Replace the get_filtered_sensor_history function in flask_api.py
# Find the line:  hours = min(int(request.args.get('hours', 6)), 168)
# Inside get_filtered_sensor_history and replace the whole query block as shown below.

# OLD (inside get_filtered_sensor_history):
#   hours    = min(int(request.args.get('hours',    6)),   168)
#   interval = max(int(request.args.get('interval', 5)),   1)
#   query = f'''
#   from(bucket: "{INFLUX_BUCKET}")
#     |> range(start: -{hours}h)
#   ...

# NEW — replace those two lines and the range line with:
#   if 'minutes' in request.args:
#       minutes = min(int(request.args.get('minutes', 360)), 10080)
#   else:
#       hours   = min(int(request.args.get('hours', 6)), 168)
#       minutes = hours * 60
#   interval = max(int(request.args.get('interval', 1)), 1)
#   query = f'''
#   from(bucket: "{INFLUX_BUCKET}")
#     |> range(start: -{minutes}m)
#   ...

# COMPLETE REPLACEMENT for get_filtered_sensor_history:

@app.route('/api/sensors/history/filtered', methods=['GET'])
def get_filtered_sensor_history():
    """
    Historical filtered sensor data from InfluxDB measurement: sensor_readings_filt.
    Accepts 'minutes' (preferred) or 'hours' param.
    Query params:
      minutes  — look-back in minutes (default 360, max 10080)
      hours    — legacy, used if minutes not provided
      interval — aggregation window in minutes (default 1)
    """
    if not query_api:
        return jsonify({'success': False, 'error': 'InfluxDB not configured'}), 503

    try:
        if 'minutes' in request.args:
            minutes = min(int(request.args.get('minutes', 360)), 10080)
        else:
            hours   = min(int(request.args.get('hours', 6)), 168)
            minutes = hours * 60

        interval = max(int(request.args.get('interval', 1)), 1)

        query = f'''
from(bucket: "{INFLUX_BUCKET}")
  |> range(start: -{minutes}m)
  |> filter(fn: (r) => r["_measurement"] == "sensor_readings_filt")
  |> filter(fn: (r) => r["device"] == "{DEVICE_ID}")
  |> filter(fn: (r) =>
      r["_field"] == "air_temp_c"        or
      r["_field"] == "air_humidity_pct"  or
      r["_field"] == "soil_temp_c"       or
      r["_field"] == "soil_moisture_raw" or
      r["_field"] == "soil_moisture_pct" or
      r["_field"] == "light_raw"
  )
  |> aggregateWindow(every: {interval}m, fn: mean, createEmpty: false)
  |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
  |> sort(columns: ["_time"])
'''
        result = query_api.query(query=query, org=INFLUX_ORG)

        data_points = []
        for table in result:
            for record in table.records:
                data_points.append({
                    'time':               record.get_time().isoformat(),
                    'air_temp_c':         record.values.get('air_temp_c'),
                    'air_humidity_pct':   record.values.get('air_humidity_pct'),
                    'soil_temp_c':        record.values.get('soil_temp_c'),
                    'soil_moisture_raw':  record.values.get('soil_moisture_raw'),
                    'soil_moisture_pct':  record.values.get('soil_moisture_pct'),
                    'light_raw':          record.values.get('light_raw'),
                })

        return jsonify({
            'success':          True,
            'measurement':      'sensor_readings_filt',
            'data':             data_points,
            'minutes':          minutes,
            'interval_minutes': interval,
            'count':            len(data_points),
        })

    except Exception as e:
        print(f'[ERROR] filtered sensor history: {e}')
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/actuators/history', methods=['GET'])
def get_actuator_history():
    if not query_api:
        return jsonify({'success': False, 'error': 'InfluxDB not configured'}), 503

    try:
        hours    = min(int(request.args.get('hours',    6)),  168)
        interval = max(int(request.args.get('interval', 1)),  1)

        query = f'''
from(bucket: "{INFLUX_BUCKET}")
  |> range(start: -{hours}h)
  |> filter(fn: (r) => r["_measurement"] == "actuator_states")
  |> filter(fn: (r) => r["device"] == "{DEVICE_ID}")
  |> filter(fn: (r) =>
      r["_field"] == "pump"   or
      r["_field"] == "lamp"   or
      r["_field"] == "heater" or
      r["_field"] == "fan"
  )
  |> aggregateWindow(every: {interval}m, fn: last, createEmpty: false)
  |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
  |> sort(columns: ["_time"])
'''
        result = query_api.query(query=query, org=INFLUX_ORG)
        data_points = []
        for table in result:
            for record in table.records:
                data_points.append({
                    'time':   record.get_time().isoformat(),
                    'pump':   record.values.get('pump'),
                    'lamp':   record.values.get('lamp'),
                    'heater': record.values.get('heater'),
                    'fan':    record.values.get('fan'),
                })

        return jsonify({
            'success':          True,
            'measurement':      'actuator_states',
            'data':             data_points,
            'hours':            hours,
            'interval_minutes': interval,
            'count':            len(data_points),
        })

    except Exception as e:
        print(f'[ERROR] actuator history: {e}')
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/actuators/gantt', methods=['GET'])
def get_actuator_gantt():
    """
    Returns actuator ON/OFF periods as Gantt-style segments.
    Accepts either 'minutes' (preferred, supports <60m) or 'hours' param.

    Query params:
      minutes — look-back in minutes (default 360, max 10080 = 7 days)
      hours   — legacy param, used if minutes not provided

    Returns:
      {
        "success": true,
        "domain": { "start": "<iso>", "end": "<iso>" },
        "segments": [
          { "actuator": "lamp", "start": "<iso>", "end": "<iso>", "duration_s": 3600 },
          ...
        ]
      }
    """
    if not query_api:
        return jsonify({'success': False, 'error': 'InfluxDB not configured'}), 503

    try:
        if 'minutes' in request.args:
            minutes = min(int(request.args.get('minutes', 360)), 10080)
        else:
            hours   = min(int(request.args.get('hours', 6)), 168)
            minutes = hours * 60

        query = f'''
from(bucket: "{INFLUX_BUCKET}")
  |> range(start: -{minutes}m)
  |> filter(fn: (r) => r["_measurement"] == "actuator_states")
  |> filter(fn: (r) => r["device"] == "{DEVICE_ID}")
  |> filter(fn: (r) =>
      r["_field"] == "pump"   or
      r["_field"] == "lamp"   or
      r["_field"] == "heater" or
      r["_field"] == "fan"
  )
  |> aggregateWindow(every: 1m, fn: last, createEmpty: false)
  |> sort(columns: ["_time"])
'''
        result = query_api.query(query=query, org=INFLUX_ORG)

        series: dict = {act: [] for act in ('pump', 'lamp', 'heater', 'fan')}
        domain_start = None
        domain_end   = None

        for table in result:
            for record in table.records:
                act   = record.get_field()
                t     = record.get_time()
                state = int(record.get_value() or 0)
                if act in series:
                    series[act].append((t, state))
                if domain_start is None or t < domain_start:
                    domain_start = t
                if domain_end is None or t > domain_end:
                    domain_end = t

        now = datetime.now(timezone.utc)
        if domain_end is None:
            domain_end = now
        if domain_start is None:
            domain_start = now

        segments = []
        for act, points in series.items():
            if not points:
                continue
            points.sort(key=lambda x: x[0])
            seg_start  = None
            prev_state = 0

            for t, state in points:
                if prev_state == 0 and state == 1:
                    seg_start = t
                elif prev_state == 1 and state == 0:
                    if seg_start is not None:
                        duration = (t - seg_start).total_seconds()
                        segments.append({
                            'actuator':   act,
                            'start':      seg_start.isoformat(),
                            'end':        t.isoformat(),
                            'duration_s': round(duration),
                        })
                        seg_start = None
                prev_state = state

            if prev_state == 1 and seg_start is not None:
                duration = (now - seg_start).total_seconds()
                segments.append({
                    'actuator':   act,
                    'start':      seg_start.isoformat(),
                    'end':        now.isoformat(),
                    'duration_s': round(duration),
                })

        segments.sort(key=lambda x: x['start'])

        return jsonify({
            'success':  True,
            'minutes':  minutes,
            'domain': {
                'start': domain_start.isoformat(),
                'end':   domain_end.isoformat(),
            },
            'segments': segments,
            'count':    len(segments),
        })

    except Exception as e:
        print(f'[ERROR] actuator gantt: {e}')
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/sensors/latest', methods=['GET'])
def get_sensors_latest():
    def soil_status(pct):
        if pct is None:   return 'unknown'
        if pct > 58:      return 'saturated'
        if pct > 50:      return 'wet'
        if pct >= 35:     return 'ideal'
        if pct >= 20:     return 'getting_dry'
        return 'dry'

    last_update_str = system_state['sensors']['last_update']
    stale = True
    if last_update_str:
        try:
            last_update = datetime.fromisoformat(last_update_str)
            if last_update.tzinfo is None:
                last_update = last_update.replace(tzinfo=timezone.utc)
            stale = (datetime.now(timezone.utc) - last_update).total_seconds() > 90
        except Exception:
            stale = True

    filtered = {}
    if query_api:
        try:
            query = f'''
from(bucket: "{INFLUX_BUCKET}")
  |> range(start: -5m)
  |> filter(fn: (r) => r["_measurement"] == "sensor_readings_filt")
  |> filter(fn: (r) => r["device"] == "{DEVICE_ID}")
  |> last()
  |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
'''
            result = query_api.query(query=query, org=INFLUX_ORG)
            for table in result:
                for record in table.records:
                    for field in ('air_temp_c', 'air_humidity_pct', 'soil_moisture_pct',
                                  'soil_moisture_raw', 'soil_temp_c', 'light_raw'):
                        val = record.values.get(field)
                        if val is not None:
                            filtered[field] = val
        except Exception as e:
            print(f'[WARN] latest filtered query failed: {e}')

    s            = system_state['sensors']
    soil_pct_raw = s.get('soil_moisture_pct')

    data = {
        'air_temp_c':        {'raw': s.get('air_temp_c'),        'filtered': filtered.get('air_temp_c'),        'unit': 'C',   'stale': stale},
        'air_humidity_pct':  {'raw': s.get('air_humidity_pct'),  'filtered': filtered.get('air_humidity_pct'),  'unit': '%',   'stale': stale},
        'soil_moisture_pct': {'raw': soil_pct_raw,                'filtered': filtered.get('soil_moisture_pct'), 'unit': '%',   'status': soil_status(soil_pct_raw), 'stale': stale},
        'soil_moisture_raw': {'raw': s.get('soil_moisture_raw'),  'filtered': filtered.get('soil_moisture_raw'), 'unit': 'ADC', 'stale': stale},
        'soil_temp_c':       {'raw': s.get('soil_temp_c'),        'filtered': filtered.get('soil_temp_c'),       'unit': 'C',   'stale': stale},
        'light_raw':         {'raw': s.get('light_raw'),          'filtered': filtered.get('light_raw'),         'unit': 'ADC', 'stale': stale},
    }

    return jsonify({
        'success':              True,
        'data':                 data,
        'last_sensor_update':   last_update_str,
        'last_actuator_update': system_state['actuators'].get('last_actuator_update'),
        'stale':                stale,
        'timestamp':            datetime.now(timezone.utc).isoformat(),
    })


@app.route('/api/sensors/comparison', methods=['GET'])
def get_sensor_comparison():
    if not query_api:
        return jsonify({'success': False, 'error': 'InfluxDB not configured'}), 503

    sensor = request.args.get('sensor')
    valid_sensors = ('air_temp_c', 'air_humidity_pct', 'soil_moisture_pct',
                     'soil_moisture_raw', 'soil_temp_c', 'light_raw')
    if not sensor or sensor not in valid_sensors:
        return jsonify({'success': False, 'error': f'sensor must be one of: {", ".join(valid_sensors)}'}), 400

    try:
        hours    = min(int(request.args.get('hours',    1)), 24)
        interval = max(int(request.args.get('interval', 1)),  1)

        def run_query(measurement):
            q = f'''
from(bucket: "{INFLUX_BUCKET}")
  |> range(start: -{hours}h)
  |> filter(fn: (r) => r["_measurement"] == "{measurement}")
  |> filter(fn: (r) => r["device"] == "{DEVICE_ID}")
  |> filter(fn: (r) => r["_field"] == "{sensor}")
  |> aggregateWindow(every: {interval}m, fn: mean, createEmpty: false)
  |> sort(columns: ["_time"])
'''
            result = query_api.query(query=q, org=INFLUX_ORG)
            rows = {}
            for table in result:
                for record in table.records:
                    rows[record.get_time().isoformat()] = record.get_value()
            return rows

        raw_rows      = run_query('sensor_readings')
        filtered_rows = run_query('sensor_readings_filt')
        all_times     = sorted(set(raw_rows) | set(filtered_rows))
        data          = [{'time': t, 'raw': raw_rows.get(t), 'filtered': filtered_rows.get(t)} for t in all_times]

        return jsonify({'success': True, 'sensor': sensor, 'hours': hours, 'interval_minutes': interval, 'count': len(data), 'data': data})

    except Exception as e:
        print(f'[ERROR] comparison: {e}')
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/sensors/sparkline', methods=['GET'])
def get_sensor_sparkline():
    if not query_api:
        return jsonify({'success': False, 'error': 'InfluxDB not configured'}), 503

    sensor = request.args.get('sensor')
    valid_sensors = ('air_temp_c', 'air_humidity_pct', 'soil_moisture_pct',
                     'soil_moisture_raw', 'soil_temp_c', 'light_raw')
    if not sensor or sensor not in valid_sensors:
        return jsonify({'success': False, 'error': f'sensor must be one of: {", ".join(valid_sensors)}'}), 400

    try:
        query = f'''
from(bucket: "{INFLUX_BUCKET}")
  |> range(start: -30m)
  |> filter(fn: (r) => r["_measurement"] == "sensor_readings_filt")
  |> filter(fn: (r) => r["device"] == "{DEVICE_ID}")
  |> filter(fn: (r) => r["_field"] == "{sensor}")
  |> aggregateWindow(every: 1m, fn: mean, createEmpty: false)
  |> sort(columns: ["_time"])
'''
        result = query_api.query(query=query, org=INFLUX_ORG)
        values = [round(float(r.get_value()), 2) for table in result for r in table.records if r.get_value() is not None]

        return jsonify({'success': True, 'sensor': sensor, 'minutes': 30, 'count': len(values), 'data': values})

    except Exception as e:
        print(f'[ERROR] sparkline: {e}')
        return jsonify({'success': False, 'error': str(e)}), 500


# ── Error handlers ────────────────────────────────────────────────────────────
@app.errorhandler(404)
def not_found(e):
    return jsonify({'success': False, 'error': 'Endpoint not found'}), 404

@app.errorhandler(500)
def internal_error(e):
    return jsonify({'success': False, 'error': 'Internal server error', 'message': str(e)}), 500


# ── Startup ───────────────────────────────────────────────────────────────────
def connect_mqtt():
    try:
        mqtt_client.connect(MQTT_HOST, MQTT_PORT, keepalive=60)
        mqtt_client.loop_start()
        for _ in range(10):
            time.sleep(0.5)
            if system_state['mqtt_connected']:
                print('[INIT] MQTT connected')
                return
        print('[WARN] MQTT connection timeout')
    except Exception as e:
        print(f'[ERROR] MQTT connect failed: {e}')


if __name__ == '__main__':
    print('=' * 60)
    print(' AgriControl — Flask API v2')
    print('=' * 60)
    print(f'  MQTT:     {MQTT_HOST}:{MQTT_PORT}')
    print(f'  InfluxDB: {INFLUX_URL} / {INFLUX_BUCKET}')
    print('=' * 60)

    connect_mqtt()

    print('[INIT] Starting Flask on http://0.0.0.0:5000')
    app.run(host='0.0.0.0', port=5000, debug=False, use_reloader=False)
