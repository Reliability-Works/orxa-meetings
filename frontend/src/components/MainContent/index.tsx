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
  const isFullScreenRoute = pathname?.startsWith('/settings');

  return (
    <main
      className="h-screen flex-1 overflow-hidden bg-white transition-[margin] duration-300"
      style={{
        marginLeft: isFullScreenRoute ? 0 : isCollapsed ? 0 : 'var(--orxa-sidebar-width, 286px)',
      }}
    >
      {!isFullScreenRoute && <div className="bg-white" style={{ height: TITLEBAR_SAFE_AREA }} />}
      <div
        className="min-h-0 overflow-hidden bg-white [&>*]:h-full"
        style={{ height: isFullScreenRoute ? '100vh' : `calc(100vh - ${TITLEBAR_SAFE_AREA}px)` }}
      >
        {children}
      </div>
    </main>
  );
};

export default MainContent;
