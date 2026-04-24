import { useEffect, useState } from 'react';
import { Wifi, WifiOff, Zap, ZapOff, Lock, RefreshCw } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────
type Sensors = {
  air_temp_c?: number;
  air_humidity_pct?: number;
  soil_temp_c?: number;
  soil_moisture_raw?: number;
  soil_moisture_pct?: number;
  light_raw?: number;
};

type Actuators = {
  pump?: 0 | 1;
  fan?: 0 | 1;
  heater?: 0 | 1;
  lamp?: 0 | 1;
};

type AutomationActive = {
  pump?: boolean;
  fan?: boolean;
  heater?: boolean;
  lamp?: boolean;
};

type StatusResponse = {
  success: boolean;
  data?: {
    sensors?: Sensors;
    actuators?: Actuators;
    automation_mode?: boolean;
    automation_active?: AutomationActive;
    mqtt_connected?: boolean;
  };
  error?: string;
};

// ── API helpers ───────────────────────────────────────────────────────────────
async function safeJson(res: Response) {
  const ct = res.headers.get('content-type') || '';
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 120)}`);
  if (!ct.includes('application/json'))
    throw new Error(`Expected JSON, got ${ct}. Body: ${text.slice(0, 60)}`);
  return JSON.parse(text);
}

async function fetchStatus(): Promise<StatusResponse> {
  const res = await fetch('/box/api/status');
  return safeJson(res);
}

async function sendActuator(actuator: 'pump' | 'fan' | 'heater' | 'lamp', state: 0 | 1) {
  const res = await fetch(`/box/api/actuator/${actuator}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state }),
  });
  return safeJson(res);
}

async function sendAutomation(enabled: boolean) {
  const res = await fetch('/box/api/automation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  return safeJson(res);
}

// ── Soil status ───────────────────────────────────────────────────────────────
function soilStatusLabel(pct?: number): { label: string; colour: string } {
  if (pct === undefined || pct === null)
    return { label: 'unknown', colour: 'bg-gray-100 text-gray-500' };
  if (pct > 58) return { label: 'saturated', colour: 'bg-blue-100 text-blue-700' };
  if (pct > 50) return { label: 'wet',        colour: 'bg-cyan-100 text-cyan-700' };
  if (pct >= 35) return { label: 'ideal',     colour: 'bg-green-100 text-green-700' };
  if (pct >= 20) return { label: 'getting dry', colour: 'bg-yellow-100 text-yellow-700' };
  return { label: 'dry', colour: 'bg-red-100 text-red-700' };
}

function fmt(n?: number, dec = 1) {
  return typeof n === 'number' && !Number.isNaN(n) ? n.toFixed(dec) : '--';
}

// ── Actuator config ───────────────────────────────────────────────────────────
const ACTUATOR_CONFIG = [
  { key: 'pump'   as const, label: 'Pump',   emoji: '💧', desc: 'Irrigation pump' },
  { key: 'fan'    as const, label: 'Fan',    emoji: '🌀', desc: 'Ventilation fan' },
  { key: 'heater' as const, label: 'Heater', emoji: '🔥', desc: 'Heating element' },
  { key: 'lamp'   as const, label: 'Lamp',   emoji: '💡', desc: 'Grow light' },
];

// ── Main page ─────────────────────────────────────────────────────────────────
export default function AgriControlPage() {
  const [connected, setConnected]     = useState<boolean | null>(null);
  const [lastUpdate, setLastUpdate]   = useState('Never');
  const [sensors, setSensors]         = useState<Sensors | null>(null);
  const [actuators, setActuators]     = useState<Actuators | null>(null);
  const [automation, setAutomation]   = useState(false);
  const [autoActive, setAutoActive]   = useState<AutomationActive>({});
  const [error, setError]             = useState<string | null>(null);
  const [busy, setBusy]               = useState(false);

  async function refresh() {
    try {
      setError(null);
      const json = await fetchStatus();
      if (json.success && json.data) {
        setConnected(true);
        setSensors(json.data.sensors ?? null);
        setActuators(json.data.actuators ?? null);
        setAutomation(Boolean(json.data.automation_mode));
        setAutoActive(json.data.automation_active ?? {});
        setLastUpdate(new Date().toLocaleTimeString());
      } else {
        setConnected(false);
        setError(json.error ?? 'Bad response from box');
      }
    } catch (e: any) {
      setConnected(false);
      setError(e?.message ?? 'Request failed');
    }
  }

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, []);

  const toggleAutomation = async () => {
    try {
      setBusy(true);
      setError(null);
      await sendAutomation(!automation);
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to toggle automation');
    } finally {
      setBusy(false);
    }
  };

  const handleActuator = async (name: 'pump' | 'fan' | 'heater' | 'lamp', state: 0 | 1) => {
    try {
      setBusy(true);
      setError(null);
      await sendActuator(name, state);
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to set actuator');
    } finally {
      setBusy(false);
    }
  };

  const soil = soilStatusLabel(sensors?.soil_moisture_pct);

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-[#164A41]">AgriControl</h1>
          <p className="text-sm text-gray-500 mt-1">Manual and automated greenhouse control</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={refresh}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#4CAF50] text-white text-sm hover:bg-[#43a047] transition-colors disabled:opacity-50"
          >
            <RefreshCw size={13} />
            Refresh
          </button>
          <div className="flex items-center gap-1.5 text-sm">
            {connected === true
              ? <Wifi size={15} className="text-green-500" />
              : <WifiOff size={15} className="text-red-400" />}
            <span className={connected === true ? 'text-green-600 font-medium' : 'text-red-400'}>
              {connected === true ? 'Connected' : connected === false ? 'Disconnected' : 'Checking...'}
            </span>
          </div>
        </div>
      </div>

      {/* Status bar */}
      <div className="bg-white rounded-2xl px-5 py-3 border border-gray-100 flex items-center gap-4 flex-wrap text-sm">
        <span className="text-gray-400 text-xs font-medium uppercase tracking-wider">Status</span>
        <span className="text-gray-500">Last update: <span className="text-[#164A41] font-medium">{lastUpdate}</span></span>
        {busy && (
          <span className="flex items-center gap-1 text-gray-400 text-xs">
            <RefreshCw size={11} className="animate-spin" /> Applying…
          </span>
        )}
        {error && <span className="text-red-600 text-xs">{error}</span>}
      </div>

      {/* Sensor readings */}
      <div className="bg-white rounded-2xl p-6 border border-gray-100">
        <h2 className="text-lg font-semibold text-[#164A41] mb-4">Sensor Readings</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <SensorTile label="Air Temp"     value={fmt(sensors?.air_temp_c)}         unit="°C" />
          <SensorTile label="Humidity"     value={fmt(sensors?.air_humidity_pct)}    unit="%"  />
          <SensorTile label="Soil Temp"    value={fmt(sensors?.soil_temp_c)}         unit="°C" />
          <SensorTile label="Soil Moisture" value={fmt(sensors?.soil_moisture_pct)}  unit="%"
            badge={sensors?.soil_moisture_pct !== undefined
              ? { label: soil.label, colour: soil.colour }
              : undefined}
          />
          <SensorTile label="Light"        value={fmt(sensors?.light_raw, 0)}        unit="ADC" />
          <SensorTile label="Soil Raw"     value={fmt(sensors?.soil_moisture_raw, 0)} unit="ADC" />
        </div>
      </div>

      {/* Automation mode */}
      <div className="bg-white rounded-2xl p-6 border border-gray-100">
        <h2 className="text-lg font-semibold text-[#164A41] mb-4">Automation Mode</h2>
        <div className="flex items-center gap-4 flex-wrap">
          <button
            onClick={toggleAutomation}
            disabled={busy || connected !== true}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium transition-all disabled:opacity-50 ${
              automation
                ? 'bg-green-500 text-white hover:bg-green-600'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            {automation ? <Zap size={16} /> : <ZapOff size={16} />}
            {automation ? 'Automation ON' : 'Automation OFF'}
          </button>
          <p className="text-sm text-gray-500">
            {automation
              ? 'System is auto-controlling actuators based on sensor thresholds.'
              : 'Manual mode — use the buttons below to control actuators directly.'}
          </p>
        </div>

        {automation && Object.values(autoActive).some(Boolean) && (
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="text-xs text-gray-400 font-medium uppercase tracking-wider self-center">Auto-controlling:</span>
            {ACTUATOR_CONFIG.filter(a => autoActive[a.key]).map(a => (
              <span key={a.key} className="flex items-center gap-1 text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">
                <span>{a.emoji}</span>
                <span>{a.label}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Actuator control */}
      <div className="bg-white rounded-2xl p-6 border border-gray-100">
        <h2 className="text-lg font-semibold text-[#164A41] mb-4">Actuator Control</h2>

        {actuators ? (
          <div className="space-y-3">
            {ACTUATOR_CONFIG.map(cfg => {
              const state = actuators[cfg.key] ?? 0;
              const locked = Boolean(automation && autoActive[cfg.key]);
              return (
                <ActuatorRow
                  key={cfg.key}
                  name={cfg.key}
                  label={cfg.label}
                  emoji={cfg.emoji}
                  desc={cfg.desc}
                  state={state}
                  locked={locked}
                  disabled={busy || connected !== true || locked}
                  onSet={handleActuator}
                />
              );
            })}
          </div>
        ) : (
          <div className="text-sm text-gray-400">No actuator data yet — waiting for Arduino.</div>
        )}

        <p className="mt-4 text-xs text-gray-400">
          Actuators showing <Lock size={10} className="inline" /> are currently controlled by automation and cannot be overridden manually.
        </p>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────
function SensorTile({
  label, value, unit, badge
}: {
  label: string;
  value: string;
  unit: string;
  badge?: { label: string; colour: string };
}) {
  return (
    <div className="bg-[#F4FAF4] rounded-xl p-3 text-center">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className="text-xl font-bold text-[#164A41] leading-none">{value}</div>
      <div className="text-xs text-gray-400 mt-0.5">{unit}</div>
      {badge && (
        <span className={`mt-1.5 inline-block text-xs px-2 py-0.5 rounded-full ${badge.colour}`}>
          {badge.label}
        </span>
      )}
    </div>
  );
}

function ActuatorRow({
  name, label, emoji, desc, state, locked, disabled, onSet
}: {
  name: 'pump' | 'fan' | 'heater' | 'lamp';
  label: string;
  emoji: string;
  desc: string;
  state: 0 | 1;
  locked: boolean;
  disabled?: boolean;
  onSet: (name: 'pump' | 'fan' | 'heater' | 'lamp', state: 0 | 1) => void;
}) {
  return (
    <div className={`flex items-center justify-between p-4 rounded-xl transition-colors ${
      state ? 'bg-green-50 border border-green-200' : 'bg-gray-50 border border-gray-100'
    }`}>
      <div className="flex items-center gap-3">
        <span className="text-xl">{emoji}</span>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-[#164A41]">{label}</span>
            {locked && (
              <span className="flex items-center gap-1 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                <Lock size={10} /> Auto
              </span>
            )}
          </div>
          <div className="text-xs text-gray-400">{desc}</div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <span className={`text-xs font-medium px-2 py-1 rounded-full ${
          state ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-600'
        }`}>
          {state ? 'ON' : 'OFF'}
        </span>
        <div className="flex gap-2">
          <button
            onClick={() => onSet(name, 1)}
            disabled={disabled || state === 1}
            className="px-3 py-1.5 rounded-lg bg-green-600 text-white text-sm font-medium disabled:opacity-40 hover:bg-green-700 transition-colors"
          >
            ON
          </button>
          <button
            onClick={() => onSet(name, 0)}
            disabled={disabled || state === 0}
            className="px-3 py-1.5 rounded-lg bg-red-500 text-white text-sm font-medium disabled:opacity-40 hover:bg-red-600 transition-colors"
          >
            OFF
          </button>
        </div>
      </div>
    </div>
  );
}
