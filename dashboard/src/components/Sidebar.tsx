import { LayoutDashboard, BarChart3, MessageSquare, Lightbulb, Info, Menu, X, BookOpen, Settings, Activity } from 'lucide-react';
import { PageType } from '../types';
import { useState } from 'react';

interface SidebarProps {
  currentPage: PageType;
  onNavigate: (page: PageType) => void;
}

export default function Sidebar({ currentPage, onNavigate }: SidebarProps) {
  const [isOpen, setIsOpen] = useState(false);

  const menuItems = [
    { id: 'dashboard' as PageType, label: 'Dashboard', icon: LayoutDashboard },
    { id: 'sensors' as PageType, label: 'Sensors', icon: Activity },
    { id: 'agricontrol' as PageType, label: 'AgriControl', icon: Settings },
    { id: 'deepanalysis' as PageType, label: 'DeepAnalysis', icon: BarChart3 },
    { id: 'chat' as PageType, label: 'AI Chat', icon: MessageSquare },
    { id: 'learning' as PageType, label: 'Learning', icon: BookOpen },
    { id: 'about' as PageType, label: 'About', icon: Info },
  ];

  return (
    <>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="lg:hidden fixed top-4 left-4 z-50 p-2 bg-white rounded-lg shadow-lg"
      >
        {isOpen ? <X size={24} /> : <Menu size={24} />}
      </button>

      <aside
        className={`fixed lg:sticky top-0 h-screen bg-white border-r border-gray-200 transition-transform duration-300 z-40 ${
          isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
        style={{ width: '280px' }}
      >
        <div className="flex flex-col h-full">
          <div className="p-6 border-b border-gray-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-[#4CAF50] to-[#2EB872] rounded-xl flex items-center justify-center">
                <span className="text-white font-bold text-xl">D</span>
              </div>
              <div>
                <h1 className="text-xl font-bold text-[#164A41]">DyianAI</h1>
              </div>
            </div>
          </div>

          <nav className="flex-1 p-4 space-y-2">
            {menuItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentPage === item.id;

              return (
                <button
                  key={item.id}
                  onClick={() => {
                    onNavigate(item.id);
                    setIsOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl transition-all ${
                    isActive
                      ? 'bg-[#F4FAF4] text-[#164A41] shadow-sm border-l-4 border-[#4CAF50]'
                      : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <Icon size={20} className={isActive ? 'text-[#4CAF50]' : ''} />
                  <span className="font-medium">{item.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="p-4 border-t border-gray-200">
            <div className="bg-gradient-to-br from-[#F4FAF4] to-[#4CAF50]/10 rounded-2xl p-4">
              <p className="text-xs text-gray-600 mb-2">Greenhouse Status</p>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-[#4CAF50] rounded-full animate-pulse"></div>
                <span className="text-sm font-medium text-[#164A41]">Active - GH-A1</span>
              </div>
            </div>
          </div>
        </div>
      </aside>

      {isOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black bg-opacity-50 z-30"
          onClick={() => setIsOpen(false)}
        />
      )}
    </>
  );
}
