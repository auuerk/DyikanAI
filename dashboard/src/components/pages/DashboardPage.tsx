import { useEffect, useState, useCallback } from 'react';
import {
  Wifi, WifiOff, Clock, ChevronDown, ChevronUp,
  Thermometer, Droplets, Sprout, Gauge, Sun, RefreshCw
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────
type SensorChannel = {
  raw: number | null;
  filtered: number | null;
  unit: string;
  stale: boolean;
  status?: string;
};
type LatestResponse = {
  success: boolean;
  stale: boolean;
  last_sensor_update: string | null;
  data: Record<string, SensorChannel>;
};
type ActuatorState = { pump: 0|1; fan: 0|1; heater: 0|1; lamp: 0|1 };
type StatusResponse = {
  success: boolean;
  data?: { actuators?: ActuatorState; automation_mode?: boolean };
};

// ── Sensor config ─────────────────────────────────────────────────────────────
const SENSORS = [
  {
    key: 'air_temp_c',
    label: 'Air Temperature',
    unit: '°C',
    decimals: 1,
    min: 0, max: 45,
    targetLow: 18, targetHigh: 26,
    color: '#f97316',
    lightBg: '#fff7ed',
    Icon: Thermometer,
  },
  {
    key: 'air_humidity_pct',
    label: 'Humidity',
    unit: '%',
    decimals: 1,
    min: 0, max: 100,
    targetLow: 50, targetHigh: 70,
    color: '#3b82f6',
    lightBg: '#eff6ff',
    Icon: Droplets,
  },
  {
    key: 'soil_moisture_pct',
    label: 'Soil Moisture',
    unit: '%',
    decimals: 1,
    min: 0, max: 60,
    targetLow: 35, targetHigh: 55,
    color: '#22c55e',
    lightBg: '#f0fdf4',
    Icon: Sprout,
  },
  {
    key: 'soil_temp_c',
    label: 'Soil Temperature',
    unit: '°C',
    decimals: 1,
    min: 0, max: 40,
    targetLow: 16, targetHigh: 28,
    color: '#a855f7',
    lightBg: '#faf5ff',
    Icon: Gauge,
  },
  {
    key: 'light_raw',
    label: 'Light Level',
    unit: 'ADC',
    decimals: 0,
    min: 0, max: 1024,
    targetLow: null, targetHigh: null,
    color: '#eab308',
    lightBg: '#fefce8',
    Icon: Sun,
  },
] as const;

const SOIL_STATUS: Record<string, { label: string; color: string }> = {
  saturated:   { label: 'Saturated', color: '#3b82f6' },
  wet:         { label: 'Wet',       color: '#06b6d4' },
  ideal:       { label: 'Ideal ✓',   color: '#22c55e' },
  getting_dry: { label: 'Getting Dry', color: '#eab308' },
  dry:         { label: 'Dry',       color: '#ef4444' },
  unknown:     { label: '—',         color: '#9ca3af' },
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(n: number | null | undefined, dec = 1) {
  if (n == null) return '--';
  return Number(n).toFixed(dec);
}

function secondsAgo(iso: string | null): string {
  if (!iso) return 'never';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function getZone(sensor: typeof SENSORS[number], value: number | null): 'good' | 'warn' | 'none' {
  if (value === null || sensor.targetLow === null) return 'none';
  if (value >= sensor.targetLow && value <= sensor.targetHigh!) return 'good';
  return 'warn';
}

// ── Auto status message ───────────────────────────────────────────────────────
function generateStatusMessage(
  latest: LatestResponse | null,
  connected: boolean | null
): { text: string; emoji: string; color: string } {
  if (!connected || !latest) {
    return { text: 'Waiting for sensor data — check your connection.', emoji: '⚠️', color: '#ef4444' };
  }

  const issues: string[] = [];

  // Check all sensors with targets against their ranges
  for (const s of SENSORS) {
    if (s.targetLow === null) continue;
    const val = latest.data[s.key]?.filtered ?? latest.data[s.key]?.raw ?? null;
    if (val === null) continue;
    if (val < s.targetLow || val > s.targetHigh!) {
      const label = s.label.toLowerCase();
      if (val > s.targetHigh!) issues.push(`${label} is too high (${val.toFixed(1)} ${s.unit})`);
      else issues.push(`${label} is too low (${val.toFixed(1)} ${s.unit})`);
    }
  }

  // Soil moisture status label gives more specific advice
  const soilStatus = latest.data['soil_moisture_pct']?.status;
  if (soilStatus === 'dry')         issues.push('soil is dry — time to water');
  if (soilStatus === 'getting_dry') issues.push('soil is getting dry — water soon');
  if (soilStatus === 'saturated')   issues.push('soil is saturated — pause irrigation');

  // Deduplicate (soil moisture might appear twice)
  const unique = [...new Set(issues)];

  if (unique.length === 0) {
    return { text: 'All conditions are optimal. Your greenhouse is doing great!', emoji: '🌱', color: '#16a34a' };
  }
  if (unique.length === 1) {
    const msg = unique[0].charAt(0).toUpperCase() + unique[0].slice(1) + '.';
    return { text: msg, emoji: '⚠️', color: '#d97706' };
  }
  const first = unique[0].charAt(0).toUpperCase() + unique[0].slice(1);
  return {
    text: `${first} — and ${unique.length - 1} other issue${unique.length > 2 ? 's' : ''} need attention.`,
    emoji: '🔴',
    color: '#dc2626',
  };
}

// ── Range bar ─────────────────────────────────────────────────────────────────
function RangeBar({ sensor, value }: { sensor: typeof SENSORS[number]; value: number | null }) {
  const range = sensor.max - sensor.min;
  const pct = value !== null ? Math.max(0, Math.min(100, ((value - sensor.min) / range) * 100)) : 0;
  const zone = getZone(sensor, value);
  const barColor = zone === 'warn' ? '#ef4444' : sensor.color;
  const tLowPct  = sensor.targetLow  !== null ? ((sensor.targetLow  - sensor.min) / range) * 100 : null;
  const tHighPct = sensor.targetHigh !== null ? ((sensor.targetHigh - sensor.min) / range) * 100 : null;

  return (
    <div>
      <div style={{ position: 'relative', height: 8, background: '#f3f4f6', borderRadius: 8, marginTop: 16 }}>
        {tLowPct !== null && tHighPct !== null && (
          <div style={{
            position: 'absolute', top: 0, bottom: 0,
            left: `${tLowPct}%`, width: `${tHighPct - tLowPct}%`,
            background: sensor.color + '28', borderRadius: 8,
          }} />
        )}
        {value !== null && (
          <div style={{
            position: 'absolute', top: 0, bottom: 0, left: 0,
            width: `${pct}%`, background: barColor, borderRadius: 8,
            transition: 'width 0.5s ease',
          }} />
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
        <span style={{ fontSize: 10, color: '#d1d5db' }}>{sensor.min}</span>
        <span style={{ fontSize: 10, color: '#d1d5db' }}>{sensor.max}</span>
      </div>
    </div>
  );
}

// ── Sensor card ───────────────────────────────────────────────────────────────
function SensorCard({ sensor, channel }: {
  sensor: typeof SENSORS[number];
  channel: SensorChannel | undefined;
}) {
  const value = channel?.filtered ?? channel?.raw ?? null;
  const zone  = getZone(sensor, value);
  const { Icon } = sensor;

  const soilStatus = sensor.key === 'soil_moisture_pct' && channel?.status
    ? SOIL_STATUS[channel.status] ?? SOIL_STATUS.unknown
    : null;

  const badgeLabel = soilStatus
    ? soilStatus
    : zone === 'good'
      ? { label: 'Optimal', color: '#22c55e' }
      : zone === 'warn' && value !== null && sensor.targetHigh !== null
        ? { label: value > sensor.targetHigh ? '↑ High' : '↓ Low', color: '#ef4444' }
        : null;

  return (
    <div style={{
      background: '#fff',
      borderRadius: 18,
      padding: '20px 20px 16px',
      border: `2px solid ${zone === 'warn' ? '#fecaca' : '#f3f4f6'}`,
      transition: 'border-color 0.3s',
      minWidth: 0, // allow grid to shrink cards
    }}>
      {/* Top row: label + badge */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 6 }}>
        <span style={{
          fontSize: 11, fontWeight: 700, color: '#9ca3af',
          textTransform: 'uppercase', letterSpacing: 0.5,
          minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {sensor.label}
        </span>
        {badgeLabel && (
          <span style={{
            fontSize: 10, fontWeight: 700,
            color: badgeLabel.color,
            background: badgeLabel.color + '18',
            padding: '3px 8px', borderRadius: 20,
            whiteSpace: 'nowrap', flexShrink: 0,
          }}>
            {badgeLabel.label}
          </span>
        )}
      </div>

      {/* Big value row: large icon + number side by side */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          width: 52, height: 52, borderRadius: 14, flexShrink: 0,
          background: zone === 'warn' ? '#fef2f2' : sensor.lightBg,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon size={28} color={zone === 'warn' ? '#ef4444' : sensor.color} />
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 3, minWidth: 0 }}>
          <span style={{
            fontSize: 46, fontWeight: 800, lineHeight: 1,
            color: zone === 'warn' ? '#ef4444' : '#164A41',
            fontVariantNumeric: 'tabular-nums',
            letterSpacing: -2,
          }}>
            {fmt(value, sensor.decimals)}
          </span>
          <span style={{ fontSize: 16, color: '#9ca3af', fontWeight: 500 }}>
            {sensor.unit}
          </span>
        </div>
      </div>

      <RangeBar sensor={sensor} value={value} />

      {sensor.targetLow !== null && (
        <div style={{ marginTop: 8, fontSize: 11, color: '#c4c8cc' }}>
          Target: {sensor.targetLow}–{sensor.targetHigh} {sensor.unit}
        </div>
      )}
    </div>
  );
}

// ── Actuator SVG icons ────────────────────────────────────────────────────────
function PumpIcon({ on }: { on: boolean }) {
  const c = on ? '#3b82f6' : '#d1d5db';
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="12" rx="4" ry="4" fill={on ? '#dbeafe' : 'none'} stroke={c}/>
      <path d="M12 2v4M12 18v4M2 12h4M18 12h4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M19.07 4.93l-2.83 2.83M7.76 16.24l-2.83 2.83"/>
    </svg>
  );
}

function FanIcon({ on }: { on: boolean }) {
  const c = on ? '#22c55e' : '#d1d5db';
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 12c0 0 3-5 7-4s4 6 0 7-7-3-7-3" fill={on ? '#dcfce7' : 'none'}/>
      <path d="M12 12c0 0 5 3 4 7s-6 4-7 0 3-7 3-7" fill={on ? '#dcfce7' : 'none'}/>
      <path d="M12 12c0 0-3 5-7 4s-4-6 0-7 7 3 7 3" fill={on ? '#dcfce7' : 'none'}/>
      <path d="M12 12c0 0-5-3-4-7s6-4 7 0-3 7-3 7" fill={on ? '#dcfce7' : 'none'}/>
      <circle cx="12" cy="12" r="1.5" fill={c} stroke="none"/>
    </svg>
  );
}

function HeaterIcon({ on }: { on: boolean }) {
  const c = on ? '#f97316' : '#d1d5db';
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 14c0-2 1.5-3 1.5-5S8 6 8 4"/>
      <path d="M12 14c0-2 1.5-3 1.5-5S12 6 12 4"/>
      <path d="M16 14c0-2 1.5-3 1.5-5S16 6 16 4"/>
      <rect x="4" y="16" width="16" height="5" rx="2" fill={on ? '#ffedd5' : 'none'} stroke={c}/>
    </svg>
  );
}

function LampIcon({ on }: { on: boolean }) {
  const c = on ? '#eab308' : '#d1d5db';
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21h6M10 17h4"/>
      <path d="M12 3a6 6 0 0 1 6 6c0 2-1 3.5-2.5 5h-7C7 12.5 6 11 6 9a6 6 0 0 1 6-6z"
        fill={on ? '#fef9c3' : 'none'} stroke={c}/>
      {on && <>
        <line x1="12" y1="1" x2="12" y2="2" stroke={c} strokeWidth="2"/>
        <line x1="4.5" y1="4.5" x2="5.3" y2="5.3" stroke={c} strokeWidth="2"/>
        <line x1="19.5" y1="4.5" x2="18.7" y2="5.3" stroke={c} strokeWidth="2"/>
      </>}
    </svg>
  );
}

// ── Actuator card ─────────────────────────────────────────────────────────────
function ActuatorCard({ label, on, children }: { label: string; on: boolean; children: React.ReactNode }) {
  return (
    <div style={{
      flex: 1, minWidth: 100,
      background: on ? '#fff' : '#fafafa',
      borderRadius: 16, padding: '20px 14px',
      border: `2px solid ${on ? '#e5e7eb' : '#f3f4f6'}`,
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
    }}>
      <div style={{
        width: 58, height: 58, borderRadius: 14,
        background: on ? '#fff' : '#f3f4f6',
        border: `1.5px solid ${on ? '#e5e7eb' : '#efefef'}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: on ? '0 4px 12px rgba(0,0,0,0.08)' : 'none',
        transition: 'all 0.3s',
      }}>
        {children}
      </div>
      <span style={{
        fontSize: 12, fontWeight: 700,
        color: on ? '#374151' : '#9ca3af',
        textTransform: 'uppercase', letterSpacing: 0.6,
      }}>
        {label}
      </span>
      <span style={{
        fontSize: 11, fontWeight: 700,
        color: on ? '#166534' : '#9ca3af',
        background: on ? '#dcfce7' : '#f3f4f6',
        padding: '3px 14px', borderRadius: 20,
      }}>
        {on ? 'ON' : 'OFF'}
      </span>
    </div>
  );
}

// ── Live age ──────────────────────────────────────────────────────────────────
function LiveAge({ iso }: { iso: string | null }) {
  const [t, setT] = useState(secondsAgo(iso));
  useEffect(() => {
    setT(secondsAgo(iso));
    const id = setInterval(() => setT(secondsAgo(iso)), 1000);
    return () => clearInterval(id);
  }, [iso]);
  return <span>{t}</span>;
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const [latest,    setLatest]    = useState<LatestResponse | null>(null);
  const [actuators, setActuators] = useState<ActuatorState | null>(null);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [expanded,  setExpanded]  = useState(false);
  const [spinning,  setSpinning]  = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [latestRes, statusRes] = await Promise.all([
        fetch('/box/api/sensors/latest').then(r => r.json()) as Promise<LatestResponse>,
        fetch('/box/api/status').then(r => r.json()) as Promise<StatusResponse>,
      ]);
      if (latestRes.success) {
        setLatest(latestRes);
        setConnected(!latestRes.stale);
      } else {
        setConnected(false);
      }
      if (statusRes.success && statusRes.data?.actuators) {
        setActuators(statusRes.data.actuators);
      }
    } catch {
      setConnected(false);
    }
  }, []);

  const handleRefresh = useCallback(async () => {
    setSpinning(true);
    await fetchData();
    setTimeout(() => setSpinning(false), 600);
  }, [fetchData]);

  useEffect(() => {
    fetchData();
    const t = setInterval(fetchData, 5000);
    return () => clearInterval(t);
  }, [fetchData]);

  const statusMsg = generateStatusMessage(latest, connected);

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '28px 24px', fontFamily: 'system-ui, sans-serif' }}>

      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: '#164A41', margin: 0, letterSpacing: -0.5 }}>
          Greenhouse GH-A1
        </h1>
        <p style={{ fontSize: 13, color: '#9ca3af', margin: '3px 0 0' }}>Live environmental overview</p>
      </div>

      {/* Status strip */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 16,
        background: '#fff', borderRadius: 14, padding: '12px 20px',
        border: '1px solid #f3f4f6', marginBottom: 14, flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          {connected === true
            ? <Wifi size={15} color="#22c55e" />
            : <WifiOff size={15} color="#ef4444" />}
          <span style={{ fontSize: 14, fontWeight: 700, color: connected === true ? '#166534' : '#dc2626' }}>
            {connected === true ? 'Connected' : connected === false ? 'Disconnected' : 'Checking...'}
          </span>
        </div>
        <div style={{ width: 1, height: 18, background: '#e5e7eb' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#6b7280', fontSize: 13 }}>
          <Clock size={13} />
          <span>Last update: <LiveAge iso={latest?.last_sensor_update ?? null} /></span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{
              width: 7, height: 7, borderRadius: '50%',
              background: connected === true ? '#22c55e' : '#d1d5db',
              animation: connected === true ? 'pulse 2s infinite' : 'none',
            }} />
            <span style={{ fontSize: 11, color: '#9ca3af' }}>auto-refresh every 5s</span>
          </div>
          <button onClick={handleRefresh} style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '6px 14px', borderRadius: 8,
            background: '#164A41', border: 'none',
            color: '#fff', fontSize: 12, fontWeight: 600,
            cursor: 'pointer',
          }}>
            <RefreshCw size={12} style={{ animation: spinning ? 'spin 0.6s linear' : 'none' }} />
            Refresh
          </button>
        </div>
      </div>

      {/* Auto-generated status message */}
      <div style={{
        background: '#fff', borderRadius: 14, padding: '14px 20px',
        border: `1.5px solid ${statusMsg.color}22`,
        marginBottom: 20,
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <span style={{ fontSize: 22 }}>{statusMsg.emoji}</span>
        <span style={{ fontSize: 15, fontWeight: 600, color: statusMsg.color }}>
          {statusMsg.text}
        </span>
      </div>

      {/* Sensor cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
        gap: 16, marginBottom: 18,
      }}>
        {SENSORS.map(s => (
          <SensorCard key={s.key} sensor={s} channel={latest?.data[s.key]} />
        ))}
      </div>

      {/* Actuators */}
      {actuators && (
        <div style={{
          background: '#fff', borderRadius: 16,
          padding: '20px 22px', border: '1px solid #f3f4f6', marginBottom: 18,
        }}>
          <div style={{
            fontSize: 11, fontWeight: 700, color: '#9ca3af',
            textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 16,
          }}>
            Actuators
          </div>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <ActuatorCard label="Pump"   on={actuators.pump   === 1}><PumpIcon   on={actuators.pump   === 1} /></ActuatorCard>
            <ActuatorCard label="Fan"    on={actuators.fan    === 1}><FanIcon    on={actuators.fan    === 1} /></ActuatorCard>
            <ActuatorCard label="Heater" on={actuators.heater === 1}><HeaterIcon on={actuators.heater === 1} /></ActuatorCard>
            <ActuatorCard label="Lamp"   on={actuators.lamp   === 1}><LampIcon   on={actuators.lamp   === 1} /></ActuatorCard>
          </div>
        </div>
      )}

      {/* Expand toggle */}
      <button onClick={() => setExpanded(v => !v)} style={{
        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        gap: 6, padding: '12px', borderRadius: 12,
        background: '#f9fafb', border: '1px solid #e5e7eb',
        cursor: 'pointer', color: '#6b7280', fontSize: 13, fontWeight: 600,
      }}>
        {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        {expanded ? 'Hide raw values' : 'Show raw values & filter detail'}
      </button>

      {/* Expanded detail */}
      {expanded && latest && (
        <div style={{
          marginTop: 14,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 12,
        }}>
          {SENSORS.map(s => {
            const ch   = latest.data[s.key];
            const raw  = ch?.raw  ?? null;
            const filt = ch?.filtered ?? null;
            const diff = raw !== null && filt !== null ? Math.abs(filt - raw) : null;
            return (
              <div key={s.key} style={{
                background: '#fff', borderRadius: 14, padding: '16px',
                border: '1px solid #f3f4f6', fontSize: 12,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 12 }}>
                  <s.Icon size={14} color={s.color} />
                  <span style={{ fontWeight: 700, color: s.color, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                    {s.label}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#9ca3af', marginBottom: 5 }}>
                  <span>Raw</span>
                  <span style={{ fontFamily: 'monospace', color: '#374151', fontWeight: 600 }}>
                    {fmt(raw, s.decimals)} {s.unit}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#9ca3af', marginBottom: 5 }}>
                  <span>Filtered</span>
                  <span style={{ fontFamily: 'monospace', color: '#164A41', fontWeight: 700 }}>
                    {fmt(filt, s.decimals)} {s.unit}
                  </span>
                </div>
                {diff !== null && diff > 0.01 && (
                  <div style={{
                    display: 'flex', justifyContent: 'space-between',
                    color: '#a855f7', borderTop: '1px solid #f3f4f6',
                    paddingTop: 5, marginTop: 5,
                  }}>
                    <span>Δ noise</span>
                    <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{diff.toFixed(3)}</span>
                  </div>
                )}
                {s.targetLow !== null && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#9ca3af', marginTop: 5 }}>
                    <span>Target</span>
                    <span style={{ fontFamily: 'monospace' }}>{s.targetLow}–{s.targetHigh} {s.unit}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.35} }
        @keyframes spin   { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
      `}</style>
    </div>
  );
}
