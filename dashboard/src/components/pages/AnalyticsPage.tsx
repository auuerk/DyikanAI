import { TrendingUp, TrendingDown, Activity, Gauge } from 'lucide-react';
import MetricLineChart from '../MetricLineChart';
import MetricAreaChart from '../MetricAreaChart';
import { sensorReadings } from '../../data/mockData';

export default function AnalyticsPage() {
  const temperatures = sensorReadings.map(r => r.temperature);
  const humidities = sensorReadings.map(r => r.humidity);
  const soilMoistures = sensorReadings.map(r => r.soilMoisture);
  const co2Levels = sensorReadings.map(r => r.co2);

  const analytics = {
    temperature: {
      min: Math.min(...temperatures).toFixed(1),
      max: Math.max(...temperatures).toFixed(1),
      avg: (temperatures.reduce((a, b) => a + b, 0) / temperatures.length).toFixed(1),
    },
    humidity: {
      min: Math.min(...humidities).toFixed(1),
      max: Math.max(...humidities).toFixed(1),
      avg: (humidities.reduce((a, b) => a + b, 0) / humidities.length).toFixed(1),
    },
    soilMoisture: {
      min: Math.min(...soilMoistures).toFixed(1),
      max: Math.max(...soilMoistures).toFixed(1),
      avg: (soilMoistures.reduce((a, b) => a + b, 0) / soilMoistures.length).toFixed(1),
    },
    co2: {
      min: Math.min(...co2Levels),
      max: Math.max(...co2Levels),
      avg: Math.round(co2Levels.reduce((a, b) => a + b, 0) / co2Levels.length),
    },
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-[#164A41] mb-2">Analytics Overview</h1>
        <p className="text-gray-600">Detailed statistical analysis of environmental conditions</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-orange-100 rounded-xl flex items-center justify-center">
              <Activity className="text-orange-600" size={20} />
            </div>
            <h3 className="text-lg font-semibold text-[#164A41]">Temperature Analytics</h3>
          </div>
          <div className="space-y-3">
            <div className="flex justify-between items-center p-3 bg-gray-50 rounded-xl">
              <span className="text-gray-600 flex items-center gap-2">
                <TrendingDown size={16} className="text-blue-500" />
                Minimum
              </span>
              <span className="font-bold text-[#164A41]">{analytics.temperature.min}°C</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-gray-50 rounded-xl">
              <span className="text-gray-600 flex items-center gap-2">
                <TrendingUp size={16} className="text-red-500" />
                Maximum
              </span>
              <span className="font-bold text-[#164A41]">{analytics.temperature.max}°C</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-[#F4FAF4] rounded-xl border border-[#4CAF50]/20">
              <span className="text-gray-600 flex items-center gap-2">
                <Gauge size={16} className="text-[#4CAF50]" />
                Average
              </span>
              <span className="font-bold text-[#164A41]">{analytics.temperature.avg}°C</span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
              <Activity className="text-blue-600" size={20} />
            </div>
            <h3 className="text-lg font-semibold text-[#164A41]">Humidity Analytics</h3>
          </div>
          <div className="space-y-3">
            <div className="flex justify-between items-center p-3 bg-gray-50 rounded-xl">
              <span className="text-gray-600 flex items-center gap-2">
                <TrendingDown size={16} className="text-blue-500" />
                Minimum
              </span>
              <span className="font-bold text-[#164A41]">{analytics.humidity.min}%</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-gray-50 rounded-xl">
              <span className="text-gray-600 flex items-center gap-2">
                <TrendingUp size={16} className="text-red-500" />
                Maximum
              </span>
              <span className="font-bold text-[#164A41]">{analytics.humidity.max}%</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-[#F4FAF4] rounded-xl border border-[#4CAF50]/20">
              <span className="text-gray-600 flex items-center gap-2">
                <Gauge size={16} className="text-[#4CAF50]" />
                Average
              </span>
              <span className="font-bold text-[#164A41]">{analytics.humidity.avg}%</span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center">
              <Activity className="text-green-600" size={20} />
            </div>
            <h3 className="text-lg font-semibold text-[#164A41]">Soil Moisture Analytics</h3>
          </div>
          <div className="space-y-3">
            <div className="flex justify-between items-center p-3 bg-gray-50 rounded-xl">
              <span className="text-gray-600 flex items-center gap-2">
                <TrendingDown size={16} className="text-blue-500" />
                Minimum
              </span>
              <span className="font-bold text-[#164A41]">{analytics.soilMoisture.min}%</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-gray-50 rounded-xl">
              <span className="text-gray-600 flex items-center gap-2">
                <TrendingUp size={16} className="text-red-500" />
                Maximum
              </span>
              <span className="font-bold text-[#164A41]">{analytics.soilMoisture.max}%</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-[#F4FAF4] rounded-xl border border-[#4CAF50]/20">
              <span className="text-gray-600 flex items-center gap-2">
                <Gauge size={16} className="text-[#4CAF50]" />
                Average
              </span>
              <span className="font-bold text-[#164A41]">{analytics.soilMoisture.avg}%</span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-purple-100 rounded-xl flex items-center justify-center">
              <Activity className="text-purple-600" size={20} />
            </div>
            <h3 className="text-lg font-semibold text-[#164A41]">CO₂ Analytics</h3>
          </div>
          <div className="space-y-3">
            <div className="flex justify-between items-center p-3 bg-gray-50 rounded-xl">
              <span className="text-gray-600 flex items-center gap-2">
                <TrendingDown size={16} className="text-blue-500" />
                Minimum
              </span>
              <span className="font-bold text-[#164A41]">{analytics.co2.min} ppm</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-gray-50 rounded-xl">
              <span className="text-gray-600 flex items-center gap-2">
                <TrendingUp size={16} className="text-red-500" />
                Maximum
              </span>
              <span className="font-bold text-[#164A41]">{analytics.co2.max} ppm</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-[#F4FAF4] rounded-xl border border-[#4CAF50]/20">
              <span className="text-gray-600 flex items-center gap-2">
                <Gauge size={16} className="text-[#4CAF50]" />
                Average
              </span>
              <span className="font-bold text-[#164A41]">{analytics.co2.avg} ppm</span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <MetricLineChart
          data={sensorReadings}
          metric="temperature"
          title="Temperature Trend"
          height={300}
        />
        <MetricLineChart
          data={sensorReadings}
          metric="humidity"
          title="Humidity Trend"
          height={300}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <MetricAreaChart
          data={sensorReadings}
          metric="soilMoisture"
          title="Soil Moisture Distribution"
          height={300}
        />
        <MetricAreaChart
          data={sensorReadings}
          metric="co2"
          title="CO₂ Levels Distribution"
          height={300}
        />
      </div>
    </div>
  );
}
