'use client';

import React from 'react';
import { useSidebar } from '@/components/Sidebar/SidebarProvider';
import { usePathname } from 'next/navigation';

interface MainContentProps {
  children: React.ReactNode;
}

const MainContent: React.FC<MainContentProps> = ({ children }) => {
  const { isCollapsed } = useSidebar();
  const pathname = usePathname();
  const pageBackground = pathname?.startsWith('/chat') ? 'bg-[#f7f7f5]' : 'bg-gray-50';

  return (
    <main
      className={`min-h-screen flex-1 overflow-hidden transition-[margin,background-color] duration-300 ${pageBackground}`}
      style={{
        marginLeft: isCollapsed ? 64 : 'var(--orxa-sidebar-width, 286px)',
      }}
    >
      {children}
    </main>
  );
};

export default MainContent;
