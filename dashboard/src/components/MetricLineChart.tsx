import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { SensorReading } from '../types';

interface MetricLineChartProps {
  data: SensorReading[];
  metric: 'temperature' | 'humidity' | 'soilMoisture' | 'co2';
  title: string;
  height?: number;
}

export default function MetricLineChart({
  data,
  metric,
  title,
  height = 300,
}: MetricLineChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
        <h3 className="text-lg font-semibold text-[#164A41] mb-4">{title}</h3>
        <div
          className="bg-gray-50 rounded-xl flex items-center justify-center"
          style={{ height }}
        >
          <p className="text-gray-500">No data available</p>
        </div>
      </div>
    );
  }

  const metricConfig = {
    temperature: {
      key: 'temperature',
      unit: '°C',
      color: '#2EB872',
      label: 'Temperature',
    },
    humidity: {
      key: 'humidity',
      unit: '%',
      color: '#2196F3',
      label: 'Humidity',
    },
    soilMoisture: {
      key: 'soilMoisture',
      unit: '%',
      color: '#8BC34A',
      label: 'Soil Moisture',
    },
    co2: {
      key: 'co2',
      unit: 'ppm',
      color: '#FF9800',
      label: 'CO₂',
    },
  };

  const config = metricConfig[metric];

  const chartData = data
    .slice()
    .reverse()
    .map((reading) => ({
      ...reading,
      displayTime: new Date(reading.timestamp).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
      }),
    }));

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-white p-3 border border-gray-200 rounded-lg shadow-lg">
          <p className="text-sm text-gray-600">
            {new Date(data.timestamp).toLocaleString('en-US', {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </p>
          <p className="text-sm font-semibold text-[#164A41]">
            {payload[0].value.toFixed(metric === 'co2' ? 0 : 1)} {config.unit}
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
      <h3 className="text-lg font-semibold text-[#164A41] mb-4">{title}</h3>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis
            dataKey="displayTime"
            stroke="#9ca3af"
            style={{ fontSize: '12px' }}
          />
          <YAxis
            stroke="#9ca3af"
            label={{
              value: config.unit,
              angle: -90,
              position: 'insideLeft',
              style: { textAnchor: 'middle' },
            }}
            style={{ fontSize: '12px' }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            wrapperStyle={{ paddingTop: '16px' }}
            iconType="line"
          />
          <Line
            type="monotone"
            dataKey={config.key}
            stroke={config.color}
            strokeWidth={3}
            dot={false}
            name={config.label}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
