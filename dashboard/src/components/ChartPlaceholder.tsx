import { BarChart3 } from 'lucide-react';

interface ChartPlaceholderProps {
  title: string;
  height?: string;
}

export default function ChartPlaceholder({ title, height = '300px' }: ChartPlaceholderProps) {
  return (
    <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
      <h3 className="text-lg font-semibold text-[#164A41] mb-4">{title}</h3>
      <div
        className="bg-gradient-to-br from-[#F4FAF4] to-white rounded-xl border-2 border-dashed border-gray-200 flex items-center justify-center"
        style={{ height }}
      >
        <div className="text-center">
          <div className="w-16 h-16 bg-[#4CAF50]/10 rounded-full flex items-center justify-center mx-auto mb-3">
            <BarChart3 className="text-[#4CAF50]" size={32} />
          </div>
          <p className="text-gray-500 font-medium">Chart Visualization</p>
          <p className="text-gray-400 text-sm mt-1">Real-time data visualization area</p>
        </div>
      </div>
    </div>
  );
}
