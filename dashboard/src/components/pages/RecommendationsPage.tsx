import { Sparkles } from 'lucide-react';
import RecommendationCard from '../RecommendationCard';
import { recommendations } from '../../data/mockData';

export default function RecommendationsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 bg-gradient-to-br from-[#4CAF50] to-[#2EB872] rounded-2xl flex items-center justify-center">
          <Sparkles className="text-white" size={24} />
        </div>
        <div>
          <h1 className="text-3xl font-bold text-[#164A41]">Smart Recommendations</h1>
          <p className="text-gray-600">AI-powered insights for optimal greenhouse management</p>
        </div>
      </div>

      <div className="bg-gradient-to-br from-[#4CAF50]/10 to-[#2EB872]/5 rounded-2xl p-6 border border-[#4CAF50]/20">
        <div className="flex items-start gap-4">
          <div className="text-[#4CAF50]">
            <Sparkles size={24} />
          </div>
          <div>
            <h3 className="font-semibold text-[#164A41] mb-2">System Analysis Complete</h3>
            <p className="text-gray-700 leading-relaxed">
              Our AI has analyzed your greenhouse data and generated personalized recommendations.
              These insights are based on optimal growing conditions, historical patterns, and current environmental readings.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {recommendations.map((recommendation) => (
          <RecommendationCard key={recommendation.id} recommendation={recommendation} />
        ))}
      </div>

      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
        <h3 className="text-lg font-semibold text-[#164A41] mb-4">Action Items Summary</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="text-center p-4 bg-green-50 rounded-xl border border-green-100">
            <div className="text-3xl font-bold text-green-700 mb-1">3</div>
            <div className="text-sm text-gray-600">Normal Status</div>
          </div>
          <div className="text-center p-4 bg-yellow-50 rounded-xl border border-yellow-100">
            <div className="text-3xl font-bold text-yellow-700 mb-1">2</div>
            <div className="text-sm text-gray-600">Requires Attention</div>
          </div>
          <div className="text-center p-4 bg-red-50 rounded-xl border border-red-100">
            <div className="text-3xl font-bold text-red-700 mb-1">0</div>
            <div className="text-sm text-gray-600">Critical Issues</div>
          </div>
        </div>
      </div>
    </div>
  );
}
