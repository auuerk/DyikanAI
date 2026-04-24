import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
} from 'recharts';
import {
  Droplets,
  Zap,
  Snowflake,
  TrendingUp,
  CheckCircle2,
  AlertTriangle,
  Thermometer,
  Wind,
  Leaf,
  DollarSign,
  BarChart3,
  ShieldCheck,
} from 'lucide-react';

// ─── SIMULATED DATA ─────────────────────────────────────────────────────────

const monthlyTempData = [
  { month: 'Oct', inside: 20.4, outside: 4.8 },
  { month: 'Nov', inside: 19.8, outside: -1.6 },
  { month: 'Dec', inside: 19.3, outside: -7.3 },
  { month: 'Jan', inside: 19.6, outside: -11.9 },
  { month: 'Feb', inside: 20.1, outside: -9.4 },
  { month: 'Mar', inside: 20.7, outside: -2.7 },
];

const waterUsageData = [
  { month: 'Oct', before: 478, after: 312 },
  { month: 'Nov', before: 512, after: 334 },
  { month: 'Dec', before: 543, after: 351 },
  { month: 'Jan', before: 558, after: 363 },
  { month: 'Feb', before: 507, after: 330 },
  { month: 'Mar', before: 491, after: 318 },
];

const frostRiskTimelineData = [
  { date: 'Nov 3', risk: 0.18, threshold: 0.6 },
  { date: 'Nov 8', risk: 0.31, threshold: 0.6 },
  { date: 'Nov 14', risk: 0.67, threshold: 0.6 },
  { date: 'Nov 19', risk: 0.55, threshold: 0.6 },
  { date: 'Nov 24', risk: 0.74, threshold: 0.6 },
  { date: 'Nov 29', risk: 0.82, threshold: 0.6 },
  { date: 'Dec 5', risk: 0.45, threshold: 0.6 },
  { date: 'Dec 11', risk: 0.88, threshold: 0.6 },
  { date: 'Dec 17', risk: 0.62, threshold: 0.6 },
  { date: 'Dec 23', risk: 0.91, threshold: 0.6 },
  { date: 'Dec 28', risk: 0.77, threshold: 0.6 },
  { date: 'Jan 4', risk: 0.93, threshold: 0.6 },
  { date: 'Jan 11', risk: 0.85, threshold: 0.6 },
  { date: 'Jan 18', risk: 0.97, threshold: 0.6 },
  { date: 'Jan 26', risk: 0.78, threshold: 0.6 },
  { date: 'Feb 7', risk: 0.69, threshold: 0.6 },
  { date: 'Feb 15', risk: 0.74, threshold: 0.6 },
  { date: 'Feb 22', risk: 0.43, threshold: 0.6 },
  { date: 'Mar 3', risk: 0.35, threshold: 0.6 },
  { date: 'Mar 10', risk: 0.21, threshold: 0.6 },
  { date: 'Mar 18', risk: 0.14, threshold: 0.6 },
];

const resourceDistributionData = [
  { name: 'Irrigation', value: 38, color: '#2196F3' },
  { name: 'Heating', value: 34, color: '#FF9800' },
  { name: 'Lighting', value: 18, color: '#FDD835' },
  { name: 'Ventilation', value: 10, color: '#4CAF50' },
];

const frostEventsData = [
  { id: 1, date: 'Nov 14, 2025', outsideTemp: '-4.2°C', riskPct: 67, action: 'Heating boost + vents closed', outcome: 'No damage' },
  { id: 2, date: 'Nov 24, 2025', outsideTemp: '-7.1°C', riskPct: 74, action: 'Emergency heating + blanket deployment', outcome: 'No damage' },
  { id: 3, date: 'Nov 29, 2025', outsideTemp: '-8.8°C', riskPct: 82, action: 'Full heating + soil warming', outcome: 'No damage' },
  { id: 4, date: 'Dec 11, 2025', outsideTemp: '-10.3°C', riskPct: 88, action: 'Max heating + humidity adjustment', outcome: 'No damage' },
  { id: 5, date: 'Dec 17, 2025', outsideTemp: '-8.5°C', riskPct: 62, action: 'Heating boost', outcome: 'No damage' },
  { id: 6, date: 'Dec 23, 2025', outsideTemp: '-13.1°C', riskPct: 91, action: 'Full heating + emergency protocol', outcome: 'No damage' },
  { id: 7, date: 'Dec 28, 2025', outsideTemp: '-11.7°C', riskPct: 77, action: 'Heating boost + soil warming', outcome: 'No damage' },
  { id: 8, date: 'Jan 4, 2026', outsideTemp: '-14.6°C', riskPct: 93, action: 'Full emergency protocol', outcome: 'No damage' },
  { id: 9, date: 'Jan 11, 2026', outsideTemp: '-12.4°C', riskPct: 85, action: 'Max heating + humidity control', outcome: 'No damage' },
  { id: 10, date: 'Jan 18, 2026', outsideTemp: '-16.2°C', riskPct: 97, action: 'Full emergency protocol', outcome: 'No damage' },
  { id: 11, date: 'Jan 26, 2026', outsideTemp: '-11.9°C', riskPct: 78, action: 'Heating boost + vents closed', outcome: 'No damage' },
  { id: 12, date: 'Feb 7, 2026', outsideTemp: '-10.1°C', riskPct: 69, action: 'Heating boost', outcome: 'No damage' },
  { id: 13, date: 'Feb 15, 2026', outsideTemp: '-11.4°C', riskPct: 74, action: 'Heating boost + soil warming', outcome: 'No damage' },
  { id: 14, date: 'Feb 22, 2026', outsideTemp: '-6.8°C', riskPct: 43, action: 'Mild heating adjustment', outcome: 'No damage' },
  { id: 15, date: 'Mar 19, 2026', outsideTemp: '-5.3°C', riskPct: 55, action: 'Heating boost', outcome: 'No damage' },
  { id: 16, date: 'April 5, 2026', outsideTemp: '-7.9°C', riskPct: 45, action: 'Preventive heating', outcome: 'No damage' },
  { id: 17, date: 'May 4, 2026', outsideTemp: '-15.1°C', riskPct: 95, action: 'Full emergency protocol', outcome: 'No damage' },
];

const cropHealthData = [
  { label: 'Soil Moisture Consistency', value: 88, color: '#8BC34A', icon: '💧' },
  { label: 'Temperature Stability', value: 92, color: '#2EB872', icon: '🌡️' },
  { label: 'Humidity Control', value: 85, color: '#2196F3', icon: '💨' },
  { label: 'Light Exposure Quality', value: 79, color: '#FDD835', icon: '☀️' },
];

const comparisonMetrics = [
  { label: 'Water Usage (L/month)', before: 515, after: 338, unit: 'L', reduction: true },
  { label: 'Energy Cost ($/month)', before: 312, after: 225, unit: '$', reduction: true },
  { label: 'Frost Incidents w/ Damage', before: 8, after: 0, unit: '', reduction: true },
  { label: 'Crop Yield (kg/season)', before: 186, after: 227, unit: 'kg', reduction: false },
  { label: 'Manual Interventions/week', before: 14, after: 3, unit: '', reduction: true },
];

// ─── SUB-COMPONENTS ──────────────────────────────────────────────────────────

function KpiCard({
  icon,
  iconBg,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ReactNode;
  iconBg: string;
  label: string;
  value: string;
  sub: string;
  accent: string;
}) {
  return (
    <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-4">
        <div className={`w-12 h-12 ${iconBg} rounded-xl flex items-center justify-center`}>
          {icon}
        </div>
        <span
          className="text-xs font-semibold px-2 py-1 rounded-lg"
          style={{ background: `${accent}18`, color: accent }}
        >
          {sub}
        </span>
      </div>
      <p className="text-gray-500 text-sm font-medium mb-1">{label}</p>
      <p className="text-3xl font-bold text-[#164A41]">{value}</p>
    </div>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex items-center gap-3 mb-6">
      <div className="w-1 h-8 bg-[#4CAF50] rounded-full" />
      <div>
        <h2 className="text-xl font-bold text-[#164A41]">{title}</h2>
        <p className="text-gray-500 text-sm">{subtitle}</p>
      </div>
    </div>
  );
}

const CustomTooltipStyle = {
  backgroundColor: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: '12px',
  padding: '12px 16px',
  boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
};

// ─── MAIN PAGE ───────────────────────────────────────────────────────────────

export default function DeepAnalysisPage() {
  const totalWaterBefore = waterUsageData.reduce((s, d) => s + d.before, 0);
  const totalWaterAfter = waterUsageData.reduce((s, d) => s + d.after, 0);
  const waterSavedPct = (((totalWaterBefore - totalWaterAfter) / totalWaterBefore) * 100).toFixed(0);

  return (
    <div className="space-y-8">
      {/* ── PAGE HEADER ─────────────────────────────────────────────── */}
      <div className="bg-gradient-to-r from-[#164A41] to-[#2d7a6b] rounded-2xl p-7 text-white shadow-lg">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <BarChart3 size={22} className="text-[#a8f0d0]" />
              <span className="text-[#a8f0d0] text-sm font-semibold uppercase tracking-widest">
                Phase 3 — Deep Analysis
              </span>
            </div>
            <h1 className="text-3xl font-bold mb-2">Deep Analysis Dashboard</h1>
            <p className="text-[#c8efe3] text-sm max-w-xl">
              System Performance &amp; Resource Optimization Report — Smart Mountain Greenhouse · Oct 2025 – May 2026
            </p>
          </div>
          <div className="flex items-center gap-2 bg-white/10 px-4 py-2 rounded-xl">
            <CheckCircle2 size={18} className="text-[#a8f0d0]" />
            <span className="text-sm font-medium text-white">183 Days Online</span>
          </div>
        </div>
      </div>

      {/* ── KPI SUMMARY CARDS ───────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
        <KpiCard
          icon={<Droplets size={22} className="text-blue-600" />}
          iconBg="bg-blue-100"
          label="Water Saved"
          value={`${waterSavedPct}%`}
          sub="↓ vs baseline"
          accent="#2196F3"
        />
        <KpiCard
          icon={<Zap size={22} className="text-yellow-600" />}
          iconBg="bg-yellow-100"
          label="Energy Saved"
          value="28%"
          sub="↓ vs baseline"
          accent="#F59E0B"
        />
        <KpiCard
          icon={<Snowflake size={22} className="text-indigo-600" />}
          iconBg="bg-indigo-100"
          label="Frost Events Detected"
          value="17"
          sub="100% handled"
          accent="#6366F1"
        />
        <KpiCard
          icon={<TrendingUp size={22} className="text-green-600" />}
          iconBg="bg-green-100"
          label="Crop Yield Improvement"
          value="+22%"
          sub="vs last season"
          accent="#4CAF50"
        />
      </div>

      {/* ── TEMPERATURE CHART ────────────────────────────────────────── */}
      <div>
        <SectionHeader
          title="Temperature Analysis"
          subtitle="Inside vs. outside temperature across 6 months"
        />
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={monthlyTempData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="month" stroke="#9ca3af" style={{ fontSize: '12px' }} />
              <YAxis
                stroke="#9ca3af"
                style={{ fontSize: '12px' }}
                tickFormatter={(v) => `${v}°C`}
              />
              <Tooltip
                formatter={(value: number, name: string) => [`${value.toFixed(1)}°C`, name]}
                contentStyle={CustomTooltipStyle}
              />
              <Legend wrapperStyle={{ paddingTop: '12px' }} iconType="circle" />
              <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="4 4" label={{ value: '0°C', fill: '#94a3b8', fontSize: 11 }} />
              <Line
                type="monotone"
                dataKey="inside"
                name="Inside Temp"
                stroke="#2EB872"
                strokeWidth={3}
                dot={{ fill: '#2EB872', r: 5 }}
                activeDot={{ r: 7 }}
              />
              <Line
                type="monotone"
                dataKey="outside"
                name="Outside Temp"
                stroke="#F97316"
                strokeWidth={3}
                dot={{ fill: '#F97316', r: 5 }}
                activeDot={{ r: 7 }}
                strokeDasharray="6 3"
              />
            </LineChart>
          </ResponsiveContainer>
          <p className="text-xs text-gray-400 mt-3 text-center">
            System maintained internal temperature 20 ± 1.5°C while outside dropped to −16°C
          </p>
        </div>
      </div>

      {/* ── WATER + FROST RISK CHARTS ─────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Water Usage Bar Chart */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <h3 className="text-lg font-semibold text-[#164A41] mb-4">
            Monthly Water Usage — Before vs After
          </h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={waterUsageData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="month" stroke="#9ca3af" style={{ fontSize: '12px' }} />
              <YAxis stroke="#9ca3af" style={{ fontSize: '12px' }} unit="L" />
              <Tooltip
                contentStyle={CustomTooltipStyle}
                formatter={(v: number) => [`${v} L`]}
              />
              <Legend wrapperStyle={{ paddingTop: '12px' }} iconType="rect" />
              <Bar dataKey="before" name="Before System" fill="#fca5a5" radius={[4, 4, 0, 0]} />
              <Bar dataKey="after" name="After System" fill="#4CAF50" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Frost Risk Timeline */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <h3 className="text-lg font-semibold text-[#164A41] mb-4">
            Frost Risk Probability Timeline
          </h3>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={frostRiskTimelineData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <defs>
                <linearGradient id="frostGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366F1" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#6366F1" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="date" stroke="#9ca3af" style={{ fontSize: '10px' }} interval={3} />
              <YAxis
                stroke="#9ca3af"
                style={{ fontSize: '12px' }}
                domain={[0, 1]}
                tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
              />
              <Tooltip
                contentStyle={CustomTooltipStyle}
                formatter={(v: number) => [`${(v * 100).toFixed(0)}%`]}
              />
              <ReferenceLine
                y={0.6}
                stroke="#EF4444"
                strokeDasharray="5 5"
                label={{ value: 'Alert Threshold 60%', fill: '#EF4444', fontSize: 11, position: 'insideTopRight' }}
              />
              <Area
                type="monotone"
                dataKey="risk"
                name="Frost Risk"
                stroke="#6366F1"
                fill="url(#frostGrad)"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 5, fill: '#6366F1' }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── RESOURCE DISTRIBUTION + CROP HEALTH ─────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Donut Chart */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <h3 className="text-lg font-semibold text-[#164A41] mb-4">Resource Distribution</h3>
          <div className="flex items-center gap-6">
            <div className="flex-shrink-0">
              <ResponsiveContainer width={200} height={200}>
                <PieChart>
                  <Pie
                    data={resourceDistributionData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={90}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {resourceDistributionData.map((entry, index) => (
                      <Cell key={index} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={CustomTooltipStyle}
                    formatter={(v: number) => [`${v}%`]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex-1 space-y-3">
              {resourceDistributionData.map((item) => (
                <div key={item.name} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="text-sm text-gray-600">{item.name}</span>
                  </div>
                  <span className="text-sm font-bold text-[#164A41]">{item.value}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Crop Health Progress Bars */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <h3 className="text-lg font-semibold text-[#164A41] mb-6">Crop Health Analysis</h3>
          <div className="space-y-5">
            {cropHealthData.map((item) => (
              <div key={item.label}>
                <div className="flex justify-between items-center mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-base">{item.icon}</span>
                    <span className="text-sm font-medium text-gray-700">{item.label}</span>
                  </div>
                  <span className="text-sm font-bold" style={{ color: item.color }}>
                    {item.value}%
                  </span>
                </div>
                <div className="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${item.value}%`, backgroundColor: item.color }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-6 p-4 bg-[#F4FAF4] rounded-xl border border-[#4CAF50]/20">
            <div className="flex items-center gap-2">
              <Leaf size={16} className="text-[#4CAF50]" />
              <span className="text-sm font-semibold text-[#164A41]">Overall Health Score</span>
              <span className="ml-auto text-lg font-bold text-[#4CAF50]">86 / 100</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── FROST EVENTS TABLE ───────────────────────────────────────── */}
      <div>
        <SectionHeader
          title="Frost Detection Events"
          subtitle="17 frost events detected and handled across the winter period"
        />
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          {/* Stats banner */}
          <div className="grid grid-cols-3 border-b border-gray-100">
            {[
              { label: 'Total Events', value: '17', icon: <Snowflake size={16} className="text-indigo-500" /> },
              { label: 'Successfully Mitigated', value: '17 / 17', icon: <ShieldCheck size={16} className="text-[#4CAF50]" /> },
              { label: 'Crop Damage Incidents', value: '0', icon: <CheckCircle2 size={16} className="text-[#4CAF50]" /> },
            ].map((s) => (
              <div key={s.label} className="flex flex-col items-center py-4 gap-1">
                <div className="flex items-center gap-1.5">
                  {s.icon}
                  <span className="text-xs text-gray-500">{s.label}</span>
                </div>
                <span className="text-xl font-bold text-[#164A41]">{s.value}</span>
              </div>
            ))}
          </div>
          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#F4FAF4]">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-[#164A41] uppercase tracking-wider">#</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-[#164A41] uppercase tracking-wider">Date</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-[#164A41] uppercase tracking-wider">Outside Temp</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-[#164A41] uppercase tracking-wider">Risk Score</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-[#164A41] uppercase tracking-wider">Action Taken</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-[#164A41] uppercase tracking-wider">Outcome</th>
                </tr>
              </thead>
              <tbody>
                {frostEventsData.map((evt, idx) => (
                  <tr
                    key={evt.id}
                    className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}
                  >
                    <td className="px-5 py-3 text-gray-400 font-mono">{String(idx + 1).padStart(2, '0')}</td>
                    <td className="px-5 py-3 font-medium text-[#164A41]">{evt.date}</td>
                    <td className="px-5 py-3">
                      <span className="flex items-center gap-1.5 text-orange-600 font-semibold">
                        <Thermometer size={14} />
                        {evt.outsideTemp}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${evt.riskPct}%`,
                              backgroundColor: evt.riskPct >= 80 ? '#EF4444' : evt.riskPct >= 65 ? '#F97316' : '#FBBF24',
                            }}
                          />
                        </div>
                        <span
                          className="text-xs font-bold"
                          style={{
                            color: evt.riskPct >= 80 ? '#EF4444' : evt.riskPct >= 65 ? '#F97316' : '#FBBF24',
                          }}
                        >
                          {evt.riskPct}%
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-gray-600 max-w-xs">{evt.action}</td>
                    <td className="px-5 py-3">
                      <span className="inline-flex items-center gap-1 bg-green-50 text-green-700 text-xs font-semibold px-2 py-1 rounded-lg">
                        <CheckCircle2 size={12} />
                        {evt.outcome}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ── SYSTEM IMPACT COMPARISON ─────────────────────────────────── */}
      <div>
        <SectionHeader
          title="System Impact Summary"
          subtitle="Before vs. After comparison across key operational metrics"
        />
        <div className="grid grid-cols-1 gap-4">
          {comparisonMetrics.map((m) => {
            const improvement = m.reduction
              ? (((m.before - m.after) / m.before) * 100).toFixed(0)
              : (((m.after - m.before) / m.before) * 100).toFixed(0);
            const isGain = !m.reduction;
            return (
              <div
                key={m.label}
                className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 flex flex-col sm:flex-row sm:items-center gap-4"
              >
                <div className="sm:w-56 flex-shrink-0">
                  <p className="text-sm font-semibold text-[#164A41]">{m.label}</p>
                </div>
                <div className="flex-1 flex items-center gap-3">
                  {/* Before bar */}
                  <div className="flex-1">
                    <div className="flex justify-between text-xs text-gray-500 mb-1">
                      <span>Before</span>
                      <span className="font-semibold text-gray-700">
                        {m.before}{m.unit}
                      </span>
                    </div>
                    <div className="w-full h-3 bg-red-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-red-400 rounded-full"
                        style={{ width: '100%' }}
                      />
                    </div>
                  </div>
                  <div className="text-gray-300 text-lg">→</div>
                  {/* After bar */}
                  <div className="flex-1">
                    <div className="flex justify-between text-xs text-gray-500 mb-1">
                      <span>After</span>
                      <span className="font-semibold text-[#164A41]">
                        {m.after}{m.unit}
                      </span>
                    </div>
                    <div className="w-full h-3 bg-green-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#4CAF50] rounded-full"
                        style={{
                          width: m.reduction
                            ? `${(m.after / m.before) * 100}%`
                            : `${Math.min((m.after / (m.before * 1.5)) * 100, 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>
                {/* Badge */}
                <div
                  className="sm:w-20 flex-shrink-0 text-center px-3 py-1.5 rounded-xl text-sm font-bold"
                  style={{
                    background: isGain ? '#4CAF5018' : '#4CAF5018',
                    color: '#4CAF50',
                  }}
                >
                  {isGain ? '+' : '−'}{improvement}%
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── ESTIMATED COST SAVINGS ───────────────────────────────────── */}
      <div className="bg-gradient-to-br from-[#164A41] to-[#1e6b5a] rounded-2xl p-7 text-white shadow-lg">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center">
            <DollarSign size={20} className="text-[#a8f0d0]" />
          </div>
          <div>
            <h2 className="text-xl font-bold">Estimated Cost Savings — Per Season</h2>
            <p className="text-[#c8efe3] text-sm">Oct 2025 – May 2026 (6 months)</p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'Water Savings', value: '$487', sub: '1,068 L saved × $0.46/L', icon: <Droplets size={18} /> },
            { label: 'Energy Savings', value: '$522', sub: '87 kWh/mo avg saving', icon: <Zap size={18} /> },
            { label: 'Crop Loss Prevented', value: '$1,240', sub: 'Est. value at risk from 17 events', icon: <Leaf size={18} /> },
            { label: 'Labour Savings', value: '$660', sub: '11 fewer interventions/wk', icon: <Wind size={18} /> },
          ].map((item) => (
            <div key={item.label} className="bg-white/10 rounded-xl p-4">
              <div className="flex items-center gap-2 text-[#a8f0d0] mb-2">
                {item.icon}
                <span className="text-xs font-semibold uppercase tracking-wider">{item.label}</span>
              </div>
              <p className="text-2xl font-bold text-white">{item.value}</p>
              <p className="text-[#c8efe3] text-xs mt-1">{item.sub}</p>
            </div>
          ))}
        </div>
        <div className="mt-5 pt-5 border-t border-white/10 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[#c8efe3] text-sm">Total Estimated Savings</p>
            <p className="text-4xl font-bold text-white mt-1">$2,909 <span className="text-lg font-normal text-[#a8f0d0]">/ season</span></p>
          </div>
          <div className="flex items-center gap-2 bg-white/10 px-4 py-2 rounded-xl">
            <AlertTriangle size={16} className="text-yellow-300" />
            <span className="text-xs text-[#c8efe3]">Simulation based on 6-month operational data</span>
          </div>
        </div>
      </div>
    </div>
  );
}