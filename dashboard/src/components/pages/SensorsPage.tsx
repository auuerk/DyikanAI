import { useEffect, useState, useCallback } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, ReferenceLine, ReferenceArea, BarChart, Bar, Cell
} from 'recharts';
import {
  Thermometer, Droplets, Sprout, Sun, Gauge,
  AlertTriangle, Wifi, WifiOff, Database, RefreshCw,
  TrendingUp, TrendingDown, Minus
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
type HealthResponse = {
  success: boolean;
  mqtt_connected: boolean;
  influxdb_available: boolean;
  last_sensor_update: string | null;
};
type ComparisonPoint = { time: string; raw: number | null; filtered: number | null };
// ── CHANGE 2: history points now include normalized fields too ─────────────────
type HistoryPoint = { time: string; [key: string]: number | null | string };
type ActuatorPoint = { time: string; pump?: number | null; lamp?: number | null; heater?: number | null; fan?: number | null };
type GanttSegment = { actuator: string; start: string; end: string; duration_s: number; };
type GanttResponse = { success: boolean; domain: { start: string; end: string }; segments: GanttSegment[]; };

// ── Sensor config ─────────────────────────────────────────────────────────────
// CHANGE 1: soil_temp_c targetHigh 24 → 28 (more realistic for greenhouse soil)
const SENSORS = [
  {
    key: 'air_temp_c',
    label: 'Air Temperature',
    shortLabel: 'Air Temp',
    icon: Thermometer,
    colour: '#f97316',
    unit: '°C',
    min: -5, max: 45,
    targetLow: 18, targetHigh: 26,
    warnLow: 15,  warnHigh: 30,
    description: 'DHT11 sensor, -0.3°C offset applied in firmware',
  },
  {
    key: 'air_humidity_pct',
    label: 'Air Humidity',
    shortLabel: 'Humidity',
    icon: Droplets,
    colour: '#3b82f6',
    unit: '%',
    min: 0, max: 100,
    targetLow: 50, targetHigh: 70,
    warnLow: 30,  warnHigh: 80,
    description: 'DHT11 sensor, factory ±5% RH',
  },
  {
    key: 'soil_moisture_pct',
    label: 'Soil Moisture',
    shortLabel: 'Soil Moisture',
    icon: Sprout,
    colour: '#22c55e',
    unit: '%',
    min: 0, max: 60,
    targetLow: 35, targetHigh: 55,
    warnLow: 20,  warnHigh: 58,
    description: '4-point piecewise calibration, Sensor 1 peat soil (Report #5)',
  },
  {
    key: 'soil_temp_c',
    label: 'Soil Temperature',
    shortLabel: 'Soil Temp',
    icon: Gauge,
    colour: '#a855f7',
    unit: '°C',
    min: 0, max: 40,
    targetLow: 16, targetHigh: 28,   // CHANGE 1: was 24, now 28
    warnLow: null, warnHigh: null,
    description: 'DS18B20 sensor, factory ±0.5°C',
  },
  {
    key: 'light_raw',
    label: 'Light Level',
    shortLabel: 'Light',
    icon: Sun,
    colour: '#eab308',
    unit: 'ADC',
    min: 0, max: 1024,
    targetLow: null, targetHigh: null,
    warnLow: null,   warnHigh: null,
    description: 'TEMT6000, raw ADC — no absolute lux calibration',
  },
] as const;

type SensorKey = typeof SENSORS[number]['key'];

const SOIL_STATUS: Record<string, { label: string; bg: string; text: string }> = {
  saturated:   { label: 'Saturated', bg: 'bg-blue-100',   text: 'text-blue-800'  },
  wet:         { label: 'Wet',       bg: 'bg-cyan-100',   text: 'text-cyan-800'  },
  ideal:       { label: 'Ideal',     bg: 'bg-green-100',  text: 'text-green-800' },
  getting_dry: { label: 'Getting dry', bg: 'bg-yellow-100', text: 'text-yellow-800' },
  dry:         { label: 'Dry',       bg: 'bg-red-100',    text: 'text-red-800'   },
  unknown:     { label: 'Unknown',   bg: 'bg-gray-100',   text: 'text-gray-600'  },
};

const ACTUATOR_COLOUR: Record<string, string> = {
  pump: '#3b82f6', lamp: '#eab308', heater: '#f97316', fan: '#a855f7',
};

const RANGES = [
  { label: '10m', minutes: 10,   hours: 1,  interval: 1  },
  { label: '30m', minutes: 30,   hours: 1,  interval: 1  },
  { label: '1h',  minutes: 60,   hours: 1,  interval: 1  },
  { label: '6h',  minutes: 360,  hours: 6,  interval: 5  },
  { label: '24h', minutes: 1440, hours: 24, interval: 15 },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(n: number | null | undefined, dec = 1) {
  if (n === null || n === undefined) return '--';
  return Number(n).toFixed(dec);
}

function zoneForValue(sensor: typeof SENSORS[number], value: number | null): 'good' | 'warn' | 'alert' | 'none' {
  if (value === null) return 'none';
  if (sensor.warnLow !== null && value < sensor.warnLow) return 'alert';
  if (sensor.warnHigh !== null && value > sensor.warnHigh) return 'alert';
  if (sensor.targetLow !== null && value < sensor.targetLow) return 'warn';
  if (sensor.targetHigh !== null && value > sensor.targetHigh) return 'warn';
  if (sensor.targetLow !== null || sensor.targetHigh !== null) return 'good';
  return 'none';
}

function zoneColour(zone: string) {
  if (zone === 'good')  return { border: 'border-green-200',  bg: 'bg-green-50',  badge: 'bg-green-100 text-green-800'  };
  if (zone === 'warn')  return { border: 'border-yellow-200', bg: 'bg-yellow-50', badge: 'bg-yellow-100 text-yellow-800' };
  if (zone === 'alert') return { border: 'border-red-200',    bg: 'bg-red-50',    badge: 'bg-red-100 text-red-800'      };
  return { border: 'border-gray-100', bg: 'bg-white', badge: 'bg-gray-100 text-gray-600' };
}

function trendIcon(history: number[]) {
  if (history.length < 3) return <Minus size={12} className="text-gray-400" />;
  const recent = history.slice(-3);
  const delta = recent[recent.length - 1] - recent[0];
  if (delta > 0.2)  return <TrendingUp size={12} className="text-red-400" />;
  if (delta < -0.2) return <TrendingDown size={12} className="text-blue-400" />;
  return <Minus size={12} className="text-gray-400" />;
}

function secondsAgo(iso: string | null) {
  if (!iso) return 'never';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function timeFmt(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ── CHANGE 2 helper: normalize a raw value to % of target range ───────────────
// 0% = at targetLow, 100% = at targetHigh, can go outside 0-100 if out of range
// For sensors without a target range (light), normalize to physical min-max instead
function normalizeToTarget(sensor: typeof SENSORS[number], value: number | null): number | null {
  if (value === null) return null;
  if (sensor.targetLow !== null && sensor.targetHigh !== null) {
    const range = sensor.targetHigh - sensor.targetLow;
    return ((value - sensor.targetLow) / range) * 100;
  }
  // light_raw: normalize to 0-100% of physical range
  const range = sensor.max - sensor.min;
  return ((value - sensor.min) / range) * 100;
}

// ── CHANGE 3 helper: compute rate of change per hour from sparkline ───────────
// sparkline = array of values sampled every 1 minute over last 30 minutes
// rate = (last - first) / time_in_hours
function rateOfChange(sparkline: number[], unit: string): string | null {
  if (sparkline.length < 6) return null; // need at least 6 minutes of data
  const recent = sparkline.slice(-10); // last 10 minutes
  const delta = recent[recent.length - 1] - recent[0];
  const hours = (recent.length - 1) / 60; // each step = 1 minute
  const perHour = delta / hours;
  const sign = perHour > 0 ? '+' : '';
  return `${sign}${perHour.toFixed(1)} ${unit}/hr`;
}

// ── Actuator Gantt config + component ────────────────────────────────────────
const ACTUATOR_CONFIG = [
  {
    key: 'lamp',   label: 'Lamp',   color: '#eab308', anomalyThresholdS: 14 * 3600,
    anomalyNote: 'ON >14h — check light schedule',
    sensor: 'light_raw', sensorLabel: 'Light',
  },
  {
    key: 'fan',    label: 'Fan',    color: '#a855f7', anomalyThresholdS: 4 * 3600,
    anomalyNote: 'ON >4h — humidity may be too high',
    sensor: 'air_humidity_pct', sensorLabel: 'Humidity',
  },
  {
    key: 'heater', label: 'Heater', color: '#f97316', anomalyThresholdS: 2 * 3600,
    anomalyNote: 'ON >2h — system may be losing heat',
    sensor: 'air_temp_c', sensorLabel: 'Air Temp',
  },
  {
    key: 'pump',   label: 'Pump',   color: '#3b82f6', anomalyThresholdS: 5 * 60,
    anomalyNote: 'ON >5min — check for stuck valve or burst pipe',
    sensor: 'soil_moisture_pct', sensorLabel: 'Soil Moisture',
  },
] as const;

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function ActuatorGantt({ gantt, rangeLabel, historyDomain }: {
  gantt: GanttResponse | null;
  rangeLabel: string;
  historyDomain: { start: string; end: string } | null;
}) {
  const [hoveredSeg, setHoveredSeg] = useState<{
    cfg: typeof ACTUATOR_CONFIG[number];
    seg: GanttSegment;
    laneEl: HTMLElement;
    mouseX: number;
  } | null>(null);

  if (!gantt || gantt.segments.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 p-6">
        <h2 className="text-lg font-semibold text-[#164A41] mb-1">Actuator Event Timeline</h2>
        <p className="text-xs text-gray-400 mb-4">Gantt swimlane view — last {rangeLabel}.</p>
        <div className="h-24 flex items-center justify-center text-sm text-gray-400">
          No actuator activity in this time range.
        </div>
      </div>
    );
  }

  const domainStart = new Date(historyDomain?.start ?? gantt.domain.start).getTime();
  const domainEnd   = new Date(historyDomain?.end   ?? gantt.domain.end).getTime();
  const domainMs    = domainEnd - domainStart;

  // 7 evenly-spaced time ticks
  const ticks = Array.from({ length: 7 }, (_, i) => ({
    pct: (i / 6) * 100,
    label: new Date(domainStart + (i / 6) * domainMs).toLocaleTimeString([], {
      hour: '2-digit', minute: '2-digit',
    }),
  }));

  // Duty cycle per actuator
  const dutyCycle: Record<string, number> = {};
  for (const cfg of ACTUATOR_CONFIG) {
    const segs    = gantt.segments.filter(s => s.actuator === cfg.key);
    const totalOn = segs.reduce((acc, s) => acc + s.duration_s, 0);
    dutyCycle[cfg.key] = domainMs > 0
      ? Math.round((totalOn / (domainMs / 1000)) * 100)
      : 0;
  }

  const hoveredCfg = hoveredSeg?.cfg;
  const hoveredSegData = hoveredSeg?.seg;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-6" onMouseLeave={() => setHoveredSeg(null)}>
      <div className="flex items-start justify-between flex-wrap gap-2 mb-1">
        <h2 className="text-lg font-semibold text-[#164A41]">Actuator Event Timeline</h2>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <div className="w-3 h-3 rounded-sm bg-red-400 opacity-70" />
          <span>Anomaly (unusually long ON period)</span>
        </div>
      </div>
      <p className="text-xs text-gray-400 mb-6">
        Solid blocks = ON periods from the <code className="text-gray-500">/api/actuators/gantt</code> endpoint.
        X-axis domain matches Environmental Trends above.
        Hover a block for duration and causality context. Red outline = anomaly.
      </p>

      <div className="space-y-2">
        {ACTUATOR_CONFIG.map(cfg => {
          const segs = gantt.segments.filter(s => s.actuator === cfg.key);
          const dc   = dutyCycle[cfg.key];
          const isHoveredRow = hoveredCfg?.key === cfg.key;

          return (
            <div key={cfg.key}>
              {/* Lane header */}
              <div className="flex items-center gap-3 mb-1">
                <div className="w-28 shrink-0 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ background: cfg.color }} />
                    <span className="text-xs font-bold text-gray-600 uppercase tracking-wide">{cfg.label}</span>
                  </div>
                  <span className="text-[10px] font-mono text-gray-400 shrink-0">
                    {dc}% on
                  </span>
                </div>
                {/* Duty cycle bar */}
                <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${dc}%`, background: cfg.color, opacity: 0.6 }}
                  />
                </div>
              </div>

              {/* Swimlane */}
              <div className="flex items-center gap-3">
                <div className="w-28 shrink-0" />
                <div
                  className="flex-1 relative rounded-lg overflow-hidden"
                  style={{
                    height: 36,
                    background: isHoveredRow ? cfg.color + '08' : '#f9fafb',
                    border: `1px solid ${isHoveredRow ? cfg.color + '30' : '#f3f4f6'}`,
                    transition: 'background 0.2s, border-color 0.2s',
                    minWidth: 0,
                  }}
                >
                  {/* OFF state center line */}
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full h-px" style={{ background: cfg.color + '20' }} />
                  </div>

                  {/* ON blocks */}
                  {segs.map((seg, i) => {
                    const startMs  = new Date(seg.start).getTime();
                    const endMs    = new Date(seg.end).getTime();
                    const left     = Math.max(0, ((startMs - domainStart) / domainMs) * 100);
                    const clampedEnd = Math.min(endMs, domainEnd);
                    const widthPct = Math.max(0.3, ((clampedEnd - startMs) / domainMs) * 100);
                    const isAnomaly = seg.duration_s >= cfg.anomalyThresholdS;
                    const isHovered = hoveredSegData === seg;

                    return (
                      <div
                        key={i}
                        className="absolute cursor-pointer transition-all duration-150"
                        style={{
                          top: 4, bottom: 4,
                          left: `${left}%`,
                          width: `${widthPct}%`,
                          minWidth: 3,
                          background: isAnomaly ? '#ef4444' : cfg.color,
                          borderRadius: 4,
                          opacity: isHovered ? 1 : 0.85,
                          outline: isAnomaly ? '2px solid #dc2626' : isHovered ? `2px solid ${cfg.color}` : 'none',
                          outlineOffset: 1,
                          zIndex: isHovered ? 10 : 1,
                        }}
                        onMouseEnter={e => {
                          const laneEl = e.currentTarget.closest('.flex-1') as HTMLElement;
                          setHoveredSeg({ cfg, seg, laneEl, mouseX: e.clientX });
                        }}
                      />
                    );
                  })}

                  {/* Tooltip */}
                  {isHoveredRow && hoveredSeg && hoveredSegData && (() => {
                    const laneRect = hoveredSeg.laneEl.getBoundingClientRect();
                    const rawLeft  = hoveredSeg.mouseX - laneRect.left;
                    const tipLeft  = Math.min(rawLeft, laneRect.width - 200);
                    const isAnomaly = hoveredSegData.duration_s >= cfg.anomalyThresholdS;
                    return (
                      <div
                        className="absolute z-50 bg-white border border-gray-200 rounded-xl shadow-xl p-3 text-xs pointer-events-none"
                        style={{ left: Math.max(0, tipLeft), bottom: 44, minWidth: 200 }}
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <div className="w-2 h-2 rounded-full" style={{ background: isAnomaly ? '#ef4444' : cfg.color }} />
                          <p className="font-bold text-gray-800">{cfg.label} — ON</p>
                          {isAnomaly && (
                            <span className="text-[10px] font-bold text-red-500 bg-red-50 px-1.5 py-0.5 rounded-full">
                              ANOMALY
                            </span>
                          )}
                        </div>
                        <div className="space-y-1 text-gray-500">
                          <div className="flex justify-between gap-4">
                            <span>Start</span>
                            <span className="font-mono text-gray-700">
                              {new Date(hoveredSegData.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                          <div className="flex justify-between gap-4">
                            <span>End</span>
                            <span className="font-mono text-gray-700">
                              {new Date(hoveredSegData.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                          <div className="flex justify-between gap-4 border-t border-gray-100 pt-1 mt-1">
                            <span>Duration</span>
                            <span className="font-mono font-bold text-gray-800">
                              {formatDuration(hoveredSegData.duration_s)}
                            </span>
                          </div>
                        </div>
                        <div className="mt-2 pt-2 border-t border-gray-100">
                          <p className="text-[10px] text-gray-400">
                            <span className="font-semibold text-gray-500">Causality:</span>{' '}
                            Check <span style={{ color: cfg.color }} className="font-semibold">{cfg.sensorLabel}</span> in the trends chart above at this time.
                          </p>
                          {isAnomaly && (
                            <p className="text-[10px] text-red-500 font-semibold mt-1">
                              ⚠ {cfg.anomalyNote}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>
          );
        })}

        {/* Shared X axis — aligned with swimlanes */}
        <div className="flex items-start gap-3 mt-2">
          <div className="w-28 shrink-0" />
          <div className="flex-1 relative h-6">
            {ticks.map((tick, i) => (
              <div
                key={i}
                className="absolute flex flex-col items-center"
                style={{ left: `${tick.pct}%`, transform: 'translateX(-50%)' }}
              >
                <div className="w-px h-2 bg-gray-300" />
                <span className="text-[9px] text-gray-400 mt-0.5 whitespace-nowrap">{tick.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}


// ── Mini gauge bar ────────────────────────────────────────────────────────────
function GaugeBar({ sensor, value }: { sensor: typeof SENSORS[number]; value: number | null }) {
  if (value === null) return <div className="h-1.5 bg-gray-100 rounded-full" />;
  const range = sensor.max - sensor.min;
  const pct = Math.max(0, Math.min(100, ((value - sensor.min) / range) * 100));
  const tLowPct = sensor.targetLow !== null ? ((sensor.targetLow - sensor.min) / range) * 100 : null;
  const tHighPct = sensor.targetHigh !== null ? ((sensor.targetHigh - sensor.min) / range) * 100 : null;
  const zone = zoneForValue(sensor, value);
  const barColour = zone === 'good' ? '#22c55e' : zone === 'warn' ? '#eab308' : zone === 'alert' ? '#ef4444' : sensor.colour;
  return (
    <div className="relative h-1.5 bg-gray-100 rounded-full mt-2">
      {tLowPct !== null && tHighPct !== null && (
        <div className="absolute h-full bg-green-100 rounded-full" style={{ left: `${tLowPct}%`, width: `${tHighPct - tLowPct}%` }} />
      )}
      <div className="absolute h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: barColour }} />
    </div>
  );
}

// ── Sparkline ─────────────────────────────────────────────────────────────────
function Sparkline({ data, colour }: { data: number[]; colour: string }) {
  if (data.length < 2) return <div className="w-16 h-8" />;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const W = 64, H = 32;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * W;
    const y = H - ((v - min) / range) * (H - 4) - 2;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="shrink-0">
      <polyline points={pts} fill="none" stroke={colour} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function LiveAge({ iso }: { iso: string | null }) {
  const [t, setT] = useState(secondsAgo(iso));
  useEffect(() => {
    setT(secondsAgo(iso));
    const id = setInterval(() => setT(secondsAgo(iso)), 1000);
    return () => clearInterval(id);
  }, [iso]);
  return <span>{t}</span>;
}

const POLL_S = 3;
function Countdown({ tick }: { tick: number }) {
  const [r, setR] = useState(POLL_S);
  useEffect(() => {
    setR(POLL_S);
    const id = setInterval(() => setR(v => Math.max(0, v - 1)), 1000);
    return () => clearInterval(id);
  }, [tick]);
  return (
    <div className="flex items-center gap-1.5 text-xs text-gray-400 bg-white border border-gray-100 px-2 py-1 rounded-full">
      <RefreshCw size={10} className={r === 0 ? 'animate-spin text-green-500' : ''} />
      <span>↻ {r}s</span>
      <div className="w-8 h-1 bg-gray-200 rounded-full overflow-hidden">
        <div className="h-full bg-[#4CAF50] rounded-full transition-all duration-1000" style={{ width: `${(r / POLL_S) * 100}%` }} />
      </div>
    </div>
  );
}

// ── Sensor card (unchanged) ───────────────────────────────────────────────────
function SensorCard({
  sensor, channel, sparkline, selected, onClick, lastUpdate
}: {
  sensor: typeof SENSORS[number];
  channel: SensorChannel | undefined;
  sparkline: number[];
  selected: boolean;
  onClick: () => void;
  lastUpdate: string | null;
}) {
  const Icon = sensor.icon;
  const val = channel?.filtered ?? channel?.raw ?? null;
  const zone = zoneForValue(sensor, val);
  const colours = zoneColour(selected ? 'none' : zone);
  const soilStatus = sensor.key === 'soil_moisture_pct' && channel?.status
    ? SOIL_STATUS[channel.status] ?? SOIL_STATUS.unknown
    : null;

  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-2xl p-4 border-2 transition-all ${
        selected
          ? 'border-[#4CAF50] bg-[#F4FAF4] shadow-lg'
          : `${colours.border} ${colours.bg} hover:shadow-md`
      }`}
    >
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          <Icon size={14} style={{ color: sensor.colour }} />
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{sensor.shortLabel}</span>
        </div>
        <div className="flex items-center gap-1">
          {zone === 'alert' && <AlertTriangle size={12} className="text-red-500" />}
          {zone === 'warn'  && <AlertTriangle size={12} className="text-yellow-500" />}
          {channel?.stale   && <WifiOff size={11} className="text-gray-300" />}
        </div>
      </div>
      <div className="flex items-end justify-between gap-1 mt-2">
        <div>
          <div className="flex items-baseline gap-1">
            <span className="text-3xl font-bold text-[#164A41] leading-none tabular-nums">{fmt(val)}</span>
            <span className="text-xs text-gray-400 mb-0.5">{sensor.unit}</span>
            <span className="ml-1">{trendIcon(sparkline)}</span>
          </div>
          {soilStatus && (
            <span className={`mt-1 inline-block text-xs px-2 py-0.5 rounded-full font-medium ${soilStatus.bg} ${soilStatus.text}`}>
              {soilStatus.label}
            </span>
          )}
          {zone !== 'none' && !soilStatus && (
            <span className={`mt-1 inline-block text-xs px-2 py-0.5 rounded-full font-medium ${colours.badge}`}>
              {zone === 'good' ? 'Optimal' : zone === 'warn' ? 'Warning' : 'Alert'}
            </span>
          )}
        </div>
        <Sparkline data={sparkline} colour={sensor.colour} />
      </div>
      <GaugeBar sensor={sensor} value={val} />
      <div className="mt-1.5 text-xs text-gray-400">
        <LiveAge iso={lastUpdate} />
      </div>
    </button>
  );
}

// ── Comparison tooltip (unchanged) ────────────────────────────────────────────
function ComparisonTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const raw = payload.find((p: any) => p.dataKey === 'raw')?.value;
  const filt = payload.find((p: any) => p.dataKey === 'filtered')?.value;
  const diff = raw != null && filt != null ? Math.abs(filt - raw) : null;
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-lg p-3 text-xs">
      <p className="font-semibold text-gray-500 mb-2">{timeFmt(label)}</p>
      {raw  != null && <p className="text-gray-500">Raw: <span className="font-bold text-gray-700">{Number(raw).toFixed(2)}</span></p>}
      {filt != null && <p style={{ color: '#4CAF50' }}>Filtered: <span className="font-bold">{Number(filt).toFixed(2)}</span></p>}
      {diff != null && diff > 0.005 && (
        <p className="text-purple-600 mt-1 border-t border-gray-100 pt-1">
          Noise removed: <span className="font-bold">{diff.toFixed(3)}</span>
        </p>
      )}
    </div>
  );
}

// ── CHANGE 2: Custom tooltip for normalized trends chart ──────────────────────
function NormalizedTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-lg p-3 text-xs min-w-[160px]">
      <p className="font-semibold text-gray-500 mb-2">{timeFmt(label)}</p>
      {payload.map((p: any) => {
        const sensor = SENSORS.find(s => s.key === p.dataKey);
        if (!sensor || p.value == null) return null;
        // Reverse the normalization to show actual value in tooltip
        let actualVal: string;
        if (sensor.targetLow !== null && sensor.targetHigh !== null) {
          const range = sensor.targetHigh - sensor.targetLow;
          const actual = (p.value / 100) * range + sensor.targetLow;
          actualVal = `${actual.toFixed(1)} ${sensor.unit}`;
        } else {
          const range = sensor.max - sensor.min;
          const actual = (p.value / 100) * range + sensor.min;
          actualVal = `${actual.toFixed(0)} ${sensor.unit}`;
        }
        return (
          <div key={p.dataKey} className="flex justify-between gap-4 mt-1">
            <span style={{ color: p.stroke }} className="font-medium">{sensor.shortLabel}</span>
            <span className="font-mono text-gray-700">
              {p.value.toFixed(0)}% <span className="text-gray-400">({actualVal})</span>
            </span>
          </div>
        );
      })}
      <p className="text-gray-400 mt-2 border-t border-gray-100 pt-1 text-[10px]">
        0% = target low · 100% = target high
      </p>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function SensorsPage() {
  const [latest,          setLatest]         = useState<LatestResponse | null>(null);
  const [health,          setHealth]          = useState<HealthResponse | null>(null);
  const [sparklines,      setSparklines]      = useState<Record<string, number[]>>({});
  const [selected,        setSelected]        = useState<SensorKey>('air_temp_c');
  const [comparison,      setComparison]      = useState<ComparisonPoint[]>([]);
  const [history,         setHistory]         = useState<HistoryPoint[]>([]);
  const [actuatorHistory, setActuatorHistory] = useState<ActuatorPoint[]>([]);
  const [gantt,           setGantt]           = useState<GanttResponse | null>(null);
  const [rangeIdx,        setRangeIdx]        = useState(2);
  const [connected,       setConnected]       = useState<boolean | null>(null);
  const [alerts,          setAlerts]          = useState<string[]>([]);

  const range = RANGES[rangeIdx];

  const fetchLatest = useCallback(async () => {
    try {
      const json: LatestResponse = await fetch('/box/api/sensors/latest').then(r => r.json());
      if (json.success) {
        setLatest(json);
        setConnected(!json.stale);
        const active: string[] = [];
        for (const s of SENSORS) {
          const ch = json.data[s.key];
          const v = ch?.filtered ?? ch?.raw ?? null;
          const z = zoneForValue(s, v);
          if (z === 'alert') active.push(`${s.shortLabel}: ${fmt(v)} ${s.unit} — outside safe range`);
          else if (z === 'warn') active.push(`${s.shortLabel}: ${fmt(v)} ${s.unit} — approaching threshold`);
          if (ch?.stale) active.push(`${s.shortLabel}: no data (stale)`);
        }
        setAlerts(active);
      } else setConnected(false);
    } catch { setConnected(false); }
  }, []);

  const fetchHealth = useCallback(async () => {
    try {
      const json: HealthResponse = await fetch('/box/api/health').then(r => r.json());
      if (json.success) setHealth(json);
    } catch { /* ignore */ }
  }, []);

  const fetchSparklines = useCallback(async () => {
    const out: Record<string, number[]> = {};
    await Promise.all(SENSORS.map(async s => {
      try {
        const json = await fetch(`/box/api/sensors/sparkline?sensor=${s.key}`).then(r => r.json());
        if (json.success) out[s.key] = json.data;
      } catch { /* ignore */ }
    }));
    setSparklines(out);
  }, []);

  const fetchComparison = useCallback(async () => {
    try {
      const url = `/box/api/sensors/comparison?sensor=${selected}&hours=${range.hours}&interval=${range.interval}`;
      const json = await fetch(url).then(r => r.json());
      if (json.success) {
        let data: ComparisonPoint[] = json.data;
        if (range.minutes < 60) {
          const cutoff = new Date(Date.now() - range.minutes * 60 * 1000).toISOString();
          data = data.filter(d => d.time >= cutoff);
        }
        setComparison(data);
      }
    } catch { /* ignore */ }
  }, [selected, range]);

  const fetchHistory = useCallback(async () => {
    try {
      const mins = range.minutes;
      const json = await fetch(`/box/api/sensors/history/filtered?minutes=${mins}&interval=${range.interval}`).then(r => r.json());
      if (json.success) setHistory(json.data);
    } catch { /* ignore */ }
  }, [range]);

  const fetchActuators = useCallback(async () => {
    try {
      const json = await fetch(`/box/api/actuators/history?hours=${range.hours}&interval=${range.interval}`).then(r => r.json());
      if (json.success) setActuatorHistory(json.data);
    } catch { /* ignore */ }
  }, [range]);

  const fetchGantt = useCallback(async () => {
    try {
      // Use minutes for short ranges so 10m/30m actually work
      const mins = range.minutes;
      const json = await fetch(`/box/api/actuators/gantt?minutes=${mins}`).then(r => r.json());
      if (json.success) setGantt(json);
    } catch { /* ignore */ }
  }, [range]);

  async function refreshAll() {
    await Promise.all([fetchLatest(), fetchHealth(), fetchSparklines(), fetchComparison(), fetchHistory(), fetchActuators(), fetchGantt()]);
  }

  useEffect(() => {
    fetchLatest(); fetchHealth();
    const t1 = setInterval(fetchLatest, POLL_S * 1000);
    const t2 = setInterval(fetchHealth, 30000);
    return () => { clearInterval(t1); clearInterval(t2); };
  }, [fetchLatest, fetchHealth]);

  useEffect(() => {
    fetchSparklines();
    const t = setInterval(fetchSparklines, 60000);
    return () => clearInterval(t);
  }, [fetchSparklines]);

  useEffect(() => { fetchComparison(); fetchHistory(); fetchActuators(); fetchGantt(); },
    [fetchComparison, fetchHistory, fetchActuators, fetchGantt]);

  // ── Build normalized history for trends chart ─────────────────────────────
  const normalizedHistory = history.map(point => {
    const norm: HistoryPoint = { time: point.time };
    for (const s of SENSORS) {
      const raw = point[s.key] as number | null;
      norm[s.key] = normalizeToTarget(s, raw);
    }
    return norm;
  });

  // Compute shared domain from history data so Gantt aligns
  const historyDomain = normalizedHistory.length > 1
    ? {
        start: normalizedHistory[0].time as string,
        end:   normalizedHistory[normalizedHistory.length - 1].time as string,
      }
    : null;

  const selSensor = SENSORS.find(s => s.key === selected)!;
  const alertCount = alerts.filter(a => a.includes('outside safe')).length;
  const warnCount  = alerts.filter(a => a.includes('approaching')).length;

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-[#164A41]">Sensor Monitor</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Greenhouse GH-A1 · raw + Kalman-filtered · auto-refresh every {POLL_S}s
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={refreshAll}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#4CAF50] text-white text-sm hover:bg-[#43a047] transition-colors">
            <RefreshCw size={13} /> Refresh
          </button>
          <div className="flex items-center gap-1.5 text-sm">
            {connected === true ? <Wifi size={14} className="text-green-500" /> : <WifiOff size={14} className="text-red-400" />}
            <span className={connected === true ? 'text-green-600 font-medium' : 'text-red-400'}>
              {connected === true ? 'Connected' : connected === false ? 'Disconnected' : 'Checking...'}
            </span>
          </div>
        </div>
      </div>

      {/* System health strip */}
      {health && (
        <div className="bg-white rounded-xl border border-gray-100 px-4 py-2.5 flex items-center gap-6 flex-wrap text-xs text-gray-500">
          <span className="font-semibold text-gray-400 uppercase tracking-widest text-[10px]">System</span>
          <div className="flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full ${health.mqtt_connected ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
            MQTT {health.mqtt_connected ? 'connected' : 'disconnected'}
          </div>
          <div className="flex items-center gap-1.5">
            <Database size={11} className={health.influxdb_available ? 'text-green-500' : 'text-red-400'} />
            InfluxDB {health.influxdb_available ? 'available' : 'unavailable'}
          </div>
          <div className="text-gray-400">Last data: <LiveAge iso={health.last_sensor_update} /></div>
        </div>
      )}

      {/* Alert bar */}
      {alerts.length > 0 && (
        <div className={`rounded-2xl p-4 flex gap-3 border ${alertCount > 0 ? 'bg-red-50 border-red-200' : 'bg-yellow-50 border-yellow-200'}`}>
          <AlertTriangle size={17} className={alertCount > 0 ? 'text-red-500 shrink-0 mt-0.5' : 'text-yellow-500 shrink-0 mt-0.5'} />
          <div className="space-y-0.5">
            <p className={`text-sm font-semibold ${alertCount > 0 ? 'text-red-700' : 'text-yellow-700'}`}>
              {alertCount > 0 ? `${alertCount} out-of-range` : ''}{alertCount > 0 && warnCount > 0 ? ', ' : ''}{warnCount > 0 ? `${warnCount} approaching threshold` : ''}
            </p>
            {alerts.map((a, i) => (
              <p key={i} className={`text-xs ${a.includes('outside') ? 'text-red-600' : 'text-yellow-600'}`}>{a}</p>
            ))}
          </div>
        </div>
      )}

      {/* Sensor cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {SENSORS.map(s => (
          <SensorCard key={s.key} sensor={s}
            channel={latest?.data[s.key]}
            sparkline={sparklines[s.key] ?? []}
            selected={selected === s.key}
            onClick={() => setSelected(s.key)}
            lastUpdate={latest?.last_sensor_update ?? null}
          />
        ))}
      </div>

      {/* Time range selector */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Time range:</span>
        {RANGES.map((r, i) => (
          <button key={r.label} onClick={() => setRangeIdx(i)}
            className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${
              rangeIdx === i ? 'bg-[#4CAF50] text-white shadow-sm' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}>
            {r.label}
          </button>
        ))}
        <span className="text-xs text-gray-400 ml-2">
          {range.minutes < 60 ? `Showing every ${range.interval}m reading` : `Aggregated every ${range.interval}m`}
        </span>
      </div>

      {/* Kalman comparison chart (unchanged) */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6">
        <div className="flex items-start justify-between flex-wrap gap-2 mb-1">
          <div className="flex items-center gap-2">
            <selSensor.icon size={18} style={{ color: selSensor.colour }} />
            <h2 className="text-lg font-semibold text-[#164A41]">
              {selSensor.label} — Raw vs Kalman Filtered
            </h2>
          </div>
          <div className="text-xs text-gray-400 bg-purple-50 border border-purple-100 px-3 py-1 rounded-full">
            {selSensor.description}
          </div>
        </div>
        <p className="text-xs text-gray-400 mb-4">
          <strong className="text-gray-500">Grey line</strong> = raw sensor reading (noisy).&nbsp;
          <strong style={{ color: selSensor.colour }}>{selSensor.shortLabel} colour</strong> = Kalman filter estimate (smoothed).
          The filter removes quantisation noise while tracking real changes.
          Use <strong>10m</strong> or <strong>30m</strong> to see DHT11 step noise clearly.
        </p>
        {comparison.filter(d => d.raw !== null || d.filtered !== null).length === 0 ? (
          <div className="h-52 flex items-center justify-center text-sm text-gray-400">No data for this range.</div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={comparison} margin={{ top: 10, right: 16, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="time" tickFormatter={timeFmt} tick={{ fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10 }} width={42}
                domain={[(d: number) => Math.floor(d * 0.95), (d: number) => Math.ceil(d * 1.05)]}
              />
              {selSensor.targetLow !== null && (
                <ReferenceLine y={selSensor.targetLow} stroke="#22c55e" strokeDasharray="4 4" strokeWidth={1}
                  label={{ value: 'min optimal', position: 'insideTopLeft', fontSize: 9, fill: '#22c55e' }} />
              )}
              {selSensor.targetHigh !== null && (
                <ReferenceLine y={selSensor.targetHigh} stroke="#22c55e" strokeDasharray="4 4" strokeWidth={1}
                  label={{ value: 'max optimal', position: 'insideTopLeft', fontSize: 9, fill: '#22c55e' }} />
              )}
              {selSensor.warnHigh !== null && (
                <ReferenceLine y={selSensor.warnHigh} stroke="#ef4444" strokeDasharray="2 4" strokeWidth={1}
                  label={{ value: 'alert', position: 'insideTopRight', fontSize: 9, fill: '#ef4444' }} />
              )}
              <Tooltip content={<ComparisonTooltip />} />
              <Legend formatter={v => v === 'raw' ? 'Raw (noisy)' : 'Kalman filtered (smoothed)'} />
              <Line type="monotone" dataKey="raw" stroke="#d1d5db" strokeWidth={1.5} dot={false} connectNulls={false} />
              <Line type="monotone" dataKey="filtered" stroke={selSensor.colour} strokeWidth={2.5} dot={false} connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── Normalized trends + actuator step lines ── */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6">
        <h2 className="text-lg font-semibold text-[#164A41] mb-1">Environmental Trends — Normalized</h2>
        <p className="text-xs text-gray-400 mb-1">
          Sensors normalized to <strong className="text-gray-500">% of target range</strong> — last {range.label}.
          Green band = optimal zone (0–100%). Actuator step lines shown below 0%.
        </p>
        <div className="flex items-center gap-4 mb-4 flex-wrap text-xs text-gray-400">
          <div className="flex items-center gap-1.5">
            <div className="w-6 h-3 rounded-sm bg-green-100 border border-green-200" />
            <span>Optimal zone (0–100%)</span>
          </div>
        </div>
        {normalizedHistory.length === 0 ? (
          <div className="h-52 flex items-center justify-center text-sm text-gray-400">No history data yet.</div>
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={normalizedHistory} margin={{ top: 10, right: 16, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis
                dataKey="time"
                tickFormatter={timeFmt}
                tick={{ fontSize: 10 }}
                interval="preserveStartEnd"
                domain={historyDomain ? [historyDomain.start, historyDomain.end] : ['auto', 'auto']}
              />
              <YAxis
                tick={{ fontSize: 10 }} width={46}
                tickFormatter={(v: number) => `${v.toFixed(0)}%`}
                domain={[-20, 140]}
                ticks={[-20, 0, 25, 50, 75, 100, 125]}
              />
              <ReferenceArea y1={0} y2={100} fill="#22c55e" fillOpacity={0.06} />
              <ReferenceLine y={0}   stroke="#22c55e" strokeDasharray="4 3" strokeWidth={1.5}
                label={{ value: '0% min', position: 'insideTopLeft', fontSize: 9, fill: '#22c55e' }} />
              <ReferenceLine y={100} stroke="#22c55e" strokeDasharray="4 3" strokeWidth={1.5}
                label={{ value: '100% max', position: 'insideTopLeft', fontSize: 9, fill: '#22c55e' }} />
              <Tooltip content={<NormalizedTooltip />} />
              <Legend formatter={n => SENSORS.find(s => s.key === n)?.shortLabel ?? n} />
              {SENSORS.map(s => (
                <Line key={s.key} type="monotone" dataKey={s.key}
                  stroke={s.colour} strokeWidth={1.8} dot={false} connectNulls={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── Gantt swimlane — synced to same history domain ── */}
      <ActuatorGantt gantt={gantt} rangeLabel={range.label} historyDomain={historyDomain} />

      {/* ── CHANGE 3: Stats row with rate of change ── */}
      {latest && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {SENSORS.map(s => {
            const ch   = latest.data[s.key];
            const raw  = ch?.raw ?? null;
            const filt = ch?.filtered ?? null;
            const diff = raw !== null && filt !== null ? Math.abs(filt - raw) : null;
            const zone = zoneForValue(s, filt ?? raw);
            const colours = zoneColour(zone);

            return (
              <div key={s.key} className={`rounded-xl border p-4 ${colours.border} ${colours.bg}`}>
                <div className="flex items-center gap-1.5 mb-3">
                  <s.icon size={13} style={{ color: s.colour }} />
                  <p className="text-xs font-semibold text-gray-500">{s.shortLabel}</p>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-400">Raw</span>
                    <span className="font-mono font-medium text-gray-600">{fmt(raw)} {s.unit}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-400">Filtered</span>
                    <span className="font-mono font-bold text-[#164A41]">{fmt(filt)} {s.unit}</span>
                  </div>
                  {diff !== null && diff > 0.005 && (
                    <div className="flex justify-between text-xs border-t border-gray-100 pt-1 mt-1">
                      <span className="text-purple-400">Δ noise</span>
                      <span className="font-mono text-purple-600">{fmt(diff, 3)} {s.unit}</span>
                    </div>
                  )}
                  {s.targetLow !== null && (
                    <div className="flex justify-between text-xs text-gray-400">
                      <span>Target</span>
                      <span>{s.targetLow}–{s.targetHigh} {s.unit}</span>
                    </div>
                  )}
                </div>
                <GaugeBar sensor={s} value={filt ?? raw} />
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
}
