import { SensorReading, RecommendationItem } from '../types';

export const sensorReadings: SensorReading[] = [
  {
    id: 'reading-001',
    greenhouseId: 'GH-A1',
    timestamp: '2024-12-08T14:30:00Z',
    temperature: 24.5,
    humidity: 68.2,
    soilMoisture: 45.0,
    co2: 420
  },
  {
    id: 'reading-002',
    greenhouseId: 'GH-A1',
    timestamp: '2024-12-08T14:15:00Z',
    temperature: 24.2,
    humidity: 69.1,
    soilMoisture: 44.8,
    co2: 415
  },
  {
    id: 'reading-003',
    greenhouseId: 'GH-A1',
    timestamp: '2024-12-08T14:00:00Z',
    temperature: 23.8,
    humidity: 70.5,
    soilMoisture: 44.5,
    co2: 410
  },
  {
    id: 'reading-004',
    greenhouseId: 'GH-A1',
    timestamp: '2024-12-08T13:45:00Z',
    temperature: 23.5,
    humidity: 71.2,
    soilMoisture: 44.2,
    co2: 408
  },
  {
    id: 'reading-005',
    greenhouseId: 'GH-A1',
    timestamp: '2024-12-08T13:30:00Z',
    temperature: 23.2,
    humidity: 72.0,
    soilMoisture: 44.0,
    co2: 405
  },
  {
    id: 'reading-006',
    greenhouseId: 'GH-A1',
    timestamp: '2024-12-08T13:15:00Z',
    temperature: 22.8,
    humidity: 73.5,
    soilMoisture: 43.8,
    co2: 402
  },
  {
    id: 'reading-007',
    greenhouseId: 'GH-A1',
    timestamp: '2024-12-08T13:00:00Z',
    temperature: 22.5,
    humidity: 74.1,
    soilMoisture: 43.5,
    co2: 400
  },
  {
    id: 'reading-008',
    greenhouseId: 'GH-A1',
    timestamp: '2024-12-08T12:45:00Z',
    temperature: 22.2,
    humidity: 75.0,
    soilMoisture: 43.2,
    co2: 398
  }
];

export const recommendations: RecommendationItem[] = [
  {
    id: 'rec-001',
    title: 'Temperature Optimal',
    message: 'Current temperature levels are within optimal range for crop growth. Continue monitoring.',
    status: 'normal'
  },
  {
    id: 'rec-002',
    title: 'Humidity Slightly High',
    message: 'Humidity levels are approaching upper threshold. Consider increasing ventilation to prevent mold growth.',
    status: 'warning'
  },
  {
    id: 'rec-003',
    title: 'Soil Moisture Good',
    message: 'Soil moisture levels are ideal for current crop stage. Maintain regular irrigation schedule.',
    status: 'normal'
  },
  {
    id: 'rec-004',
    title: 'CO₂ Levels Optimal',
    message: 'CO₂ concentration is perfect for photosynthesis. No action required.',
    status: 'normal'
  },
  {
    id: 'rec-005',
    title: 'Evening Ventilation Needed',
    message: 'Based on humidity trends, increase ventilation during evening hours to optimize growing conditions.',
    status: 'warning'
  }
];
