'use client';

import { Menu } from 'lucide-react';
import { useSidebar } from './SidebarContext';

export function MobileHeader() {
  const { isMobile, toggle } = useSidebar();

  if (!isMobile) return null;

  return (
    <header className="fixed top-0 left-0 right-0 h-14 bg-dark-card border-b border-dark-border flex items-center px-4 z-40">
      <button
        onClick={toggle}
        className="p-2 text-gray-400 hover:text-white hover:bg-dark-hover rounded-lg transition-colors"
        aria-label="Toggle menu"
      >
        <Menu className="h-6 w-6" />
      </button>
      <div className="ml-4">
        <h1 className="text-lg font-bold gradient-text">CORTEK</h1>
      </div>
    </header>
  );
}
