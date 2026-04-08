
import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import MonitoringReportGenerator from './components/MonitoringReportGenerator';
import { AppTab } from './types';

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<AppTab>('monitoring-report');
  const [isOwner, setIsOwner] = useState(false);

  useEffect(() => {
    // Simple owner check - in a real app this would come from auth
    const checkOwner = () => {
      const userEmail = 'ggovindarajan.admin@novotech-cro.com';
      setIsOwner(userEmail.includes('admin'));
    };
    checkOwner();
  }, []);

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} isOwner={isOwner} />
      <main className="flex-1 ml-64 h-screen flex flex-col overflow-hidden">
        <div className="flex-1 min-h-0">
          <MonitoringReportGenerator />
        </div>
      </main>
    </div>
  );
};

export default App;
