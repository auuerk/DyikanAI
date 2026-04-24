import { useState } from 'react';
import Sidebar from './components/Sidebar';
import DashboardPage from './components/pages/DashboardPage';
import SensorsPage from './components/pages/SensorsPage';
import AgriControlPage from './components/pages/AgriControlPage';
import DeepAnalysisPage from './components/pages/DeepAnalysisPage';
import AIChatPage from './components/pages/AIChatPage';
import LearningPage from './components/pages/LearningPage';
import AboutPage from './components/pages/AboutPage';
import { PageType } from './types';

function App() {
  const [currentPage, setCurrentPage] = useState<PageType>('dashboard');
  console.log('CURRENT PAGE =>', currentPage);

  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard':
        return <DashboardPage />;
      case 'sensors':
        return <SensorsPage />;
      case 'agricontrol':
        return <AgriControlPage />;
      case 'deepanalysis':
        return <DeepAnalysisPage />;
      case 'chat':
        return <AIChatPage />;
      case 'learning':
        return <LearningPage />;
      case 'about':
        return <AboutPage />;
      default:
        return <DashboardPage />;
    }
  };

  return (
    <div className="flex min-h-screen bg-[#F4FAF4]">
      <Sidebar currentPage={currentPage} onNavigate={setCurrentPage} />

      <main className="flex-1 lg:ml-0">
        <div className="p-6 lg:p-8 max-w-7xl mx-auto">
          {renderPage()}
        </div>
      </main>
    </div>
  );
}

export default App;
