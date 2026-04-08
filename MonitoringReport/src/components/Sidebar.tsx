
import React from 'react';
import { AppTab } from '../types';

interface SidebarProps {
  activeTab: AppTab;
  setActiveTab: (tab: AppTab) => void;
  isOwner: boolean;
}

const Sidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab, isOwner }) => {
  const navItems: { id: AppTab; label: string; icon: React.ReactNode }[] = [
    { id: 'monitoring-report', label: 'IMV Smart Assist', icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"></path></svg>
    ) },
  ];

  return (
    <div className="w-64 bg-slate-900 text-white flex flex-col h-screen fixed left-0 top-0 shadow-2xl z-20">
      <div className="p-6 border-b border-slate-700">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl overflow-hidden shadow-lg flex-shrink-0">
             <svg viewBox="0 0 512 512" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
                <defs><linearGradient id="logo-sidebar" x1="0" y1="0" x2="512" y2="512"><stop offset="0" stopColor="#2dd4bf" /><stop offset="1" stopColor="#0891b2" /></linearGradient></defs>
                <rect width="512" height="512" rx="0" fill="url(#logo-sidebar)" />
                <path d="M160 416h192c17.67 0 32-14.33 32-32s-6.5-24.6-16.8-36.5L288 256V128h32V96H192v32h32v128L144.8 347.5C134.5 359.4 128 366.3 128 384s14.33 32 32 32z" fill="white" stroke="white" strokeWidth="20" strokeLinejoin="round"/>
             </svg>
          </div>
          <h1 className="text-xl font-bold tracking-tight">AIDE</h1>
        </div>
        <p className="text-[10px] text-slate-400 mt-2 uppercase tracking-widest font-bold">Clinical Development</p>
      </div>

      <nav className="flex-1 p-4 space-y-1 flex flex-col overflow-y-auto">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 text-left ${
              activeTab === item.id
                ? 'bg-gradient-to-r from-cyan-600 to-teal-600 text-white shadow-md'
                : 'text-slate-400 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <div className="flex-shrink-0">{item.icon}</div>
            <span className="font-medium text-sm truncate">{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="p-4 border-t border-slate-700">
        <div className="bg-slate-800 rounded-lg p-3">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse"></div>
            <span className="text-[10px] text-green-400 font-bold uppercase tracking-wider">Operational</span>
          </div>
          <div className="text-[10px] text-slate-500 font-mono">SYS_V2.2 • LIVE</div>
        </div>
      </div>
    </div>
  );
};

export default Sidebar;
