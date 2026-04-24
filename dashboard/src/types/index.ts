export interface SensorReading {
  id: string;
  greenhouseId: string;
  timestamp: string;
  temperature: number;
  humidity: number;
  soilMoisture: number;
  co2: number;
}

export interface MetricCardProps {
  title: string;
  value: string;
  unit: string;
  trend: number;
  icon: React.ReactNode;
  iconBg: string;
}

export interface RecommendationItem {
  id: string;
  title: string;
  message: string;
  status: 'normal' | 'warning' | 'critical';
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'ai' | 'assistant';
  content: string;
  timestamp: string;
}

export type PageType = 'dashboard' | 'analytics' | 'chat' | 'recommendations' | 'learning' | 'about' | 'agricontrol' | 'deepanalysis' | 'sensors';
