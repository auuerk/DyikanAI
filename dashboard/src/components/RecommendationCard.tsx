import { CheckCircle, AlertTriangle, AlertCircle } from 'lucide-react';
import { RecommendationItem } from '../types';

interface RecommendationCardProps {
  recommendation: RecommendationItem;
}

export default function RecommendationCard({ recommendation }: RecommendationCardProps) {
  const statusConfig = {
    normal: {
      bg: 'bg-green-50',
      border: 'border-green-200',
      text: 'text-green-700',
      badge: 'bg-green-100 text-green-800',
      icon: CheckCircle,
    },
    warning: {
      bg: 'bg-yellow-50',
      border: 'border-yellow-200',
      text: 'text-yellow-700',
      badge: 'bg-yellow-100 text-yellow-800',
      icon: AlertTriangle,
    },
    critical: {
      bg: 'bg-red-50',
      border: 'border-red-200',
      text: 'text-red-700',
      badge: 'bg-red-100 text-red-800',
      icon: AlertCircle,
    },
  };

  const config = statusConfig[recommendation.status];
  const Icon = config.icon;

  return (
    <div className={`${config.bg} rounded-2xl p-6 border ${config.border} hover:shadow-md transition-shadow`}>
      <div className="flex items-start gap-4">
        <div className={`${config.text} mt-1`}>
          <Icon size={24} />
        </div>
        <div className="flex-1">
          <div className="flex items-start justify-between mb-2">
            <h3 className="font-semibold text-[#164A41] text-lg">{recommendation.title}</h3>
            <span className={`${config.badge} text-xs font-medium px-3 py-1 rounded-full uppercase`}>
              {recommendation.status}
            </span>
          </div>
          <p className="text-gray-700 leading-relaxed">{recommendation.message}</p>
        </div>
      </div>
    </div>
  );
}
