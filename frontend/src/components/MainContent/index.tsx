'use client';

import React from 'react';
import { useSidebar } from '@/components/Sidebar/SidebarProvider';
import { usePathname } from 'next/navigation';

interface MainContentProps {
  children: React.ReactNode;
}

const TITLEBAR_SAFE_AREA = 44;

const MainContent: React.FC<MainContentProps> = ({ children }) => {
  const { isCollapsed } = useSidebar();
  const pathname = usePathname();
  const pageBackground = pathname?.startsWith('/chat') ? 'bg-[#f7f7f5]' : 'bg-gray-50';

  return (
    <main
      className="h-screen flex-1 overflow-hidden bg-white transition-[margin] duration-300"
      style={{
        marginLeft: isCollapsed ? 64 : 'var(--orxa-sidebar-width, 286px)',
      }}
    >
      <div className="bg-white" style={{ height: TITLEBAR_SAFE_AREA }} />
      <div
        className={`min-h-0 overflow-hidden ${pageBackground}`}
        style={{ height: `calc(100vh - ${TITLEBAR_SAFE_AREA}px)` }}
      >
        {children}
      </div>
    </main>
  );
};

export default MainContent;
