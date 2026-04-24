import { GraduationCap, Target, Users, Leaf } from 'lucide-react';

export default function AboutPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-[#164A41] mb-2">About DyikanAI</h1>
        <p className="text-gray-600">Advanced greenhouse monitoring system</p>
      </div>

      <div className="bg-gradient-to-br from-[#4CAF50] to-[#2EB872] rounded-3xl p-8 text-white shadow-lg">
        <div className="flex items-center gap-4 mb-6">
          <div className="w-16 h-16 bg-white/20 backdrop-blur rounded-2xl flex items-center justify-center">
            <Leaf size={32} />
          </div>
          <div>
            <h2 className="text-2xl font-bold">DyikanAI Agricultural Monitor</h2>
            <p className="text-green-50">Smart Greenhouse Management System</p>
          </div>
        </div>
        <p className="text-lg leading-relaxed text-green-50">
          DyikanAI is an innovative agriculture monitoring platform designed to help farmers optimize
          greenhouse conditions through real-time sensor data analytics and AI-powered recommendations.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center mb-4">
            <GraduationCap className="text-blue-600" size={24} />
          </div>
          <h3 className="text-xl font-semibold text-[#164A41] mb-3">Academic Project</h3>
          <p className="text-gray-600 leading-relaxed">
            This platform is developed as a Final Year Project demonstrating the integration of IoT sensors,
            real-time data processing, and modern web technologies for agricultural applications.
          </p>
        </div>

        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center mb-4">
            <Target className="text-green-600" size={24} />
          </div>
          <h3 className="text-xl font-semibold text-[#164A41] mb-3">Project Goals</h3>
          <p className="text-gray-600 leading-relaxed">
            To create an accessible, professional-grade monitoring solution that helps greenhouse operators
            make data-driven decisions and optimize growing conditions for maximum yield.
          </p>
        </div>

        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center mb-4">
            <Users className="text-purple-600" size={24} />
          </div>
          <h3 className="text-xl font-semibold text-[#164A41] mb-3">Target Users</h3>
          <p className="text-gray-600 leading-relaxed">
            Designed for small to medium-scale greenhouse operators, agricultural researchers, and farming
            cooperatives looking to modernize their monitoring infrastructure.
          </p>
        </div>

        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <div className="w-12 h-12 bg-orange-100 rounded-xl flex items-center justify-center mb-4">
            <Leaf className="text-orange-600" size={24} />
          </div>
          <h3 className="text-xl font-semibold text-[#164A41] mb-3">Technology Stack</h3>
          <p className="text-gray-600 leading-relaxed">
            Built with React 18, TypeScript, Tailwind CSS for the frontend, and designed to integrate
            seamlessly with Spring Boot backend and real greenhouse sensor hardware.
          </p>
        </div>
      </div>

      <div className="bg-[#F4FAF4] rounded-2xl p-6 border border-[#4CAF50]/20">
        <h3 className="text-lg font-semibold text-[#164A41] mb-4">Key Features</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="flex items-center gap-3 text-gray-700">
            <div className="w-2 h-2 bg-[#4CAF50] rounded-full"></div>
            <span>Real-time microclimate monitoring</span>
          </div>
          <div className="flex items-center gap-3 text-gray-700">
            <div className="w-2 h-2 bg-[#4CAF50] rounded-full"></div>
            <span>Advanced data analytics</span>
          </div>
          <div className="flex items-center gap-3 text-gray-700">
            <div className="w-2 h-2 bg-[#4CAF50] rounded-full"></div>
            <span>AI-powered recommendations</span>
          </div>
          <div className="flex items-center gap-3 text-gray-700">
            <div className="w-2 h-2 bg-[#4CAF50] rounded-full"></div>
            <span>Interactive chat assistant</span>
          </div>
          <div className="flex items-center gap-3 text-gray-700">
            <div className="w-2 h-2 bg-[#4CAF50] rounded-full"></div>
            <span>Historical data tracking</span>
          </div>
          <div className="flex items-center gap-3 text-gray-700">
            <div className="w-2 h-2 bg-[#4CAF50] rounded-full"></div>
            <span>Mobile app integration ready</span>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 text-center">
        <p className="text-gray-600 mb-2">Developed as part of Final Year Project</p>
        <p className="text-[#164A41] font-semibold">University Academic Submission 2025</p>
      </div>
    </div>
  );
}
