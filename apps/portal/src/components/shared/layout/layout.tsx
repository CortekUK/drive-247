"use client";

import { ReactNode } from "react";
import { ThemeToggle } from "./theme-toggle";
import { HeaderSearch } from "./header-search";
import { UserMenu } from "./user-menu";
import { AppSidebar } from "./app-sidebar";
import { NotificationBell } from "./notification-bell";
import { SidebarProvider, SidebarTrigger, SidebarInset } from "@/components/ui/sidebar";

interface LayoutProps {
  children: ReactNode;
}

export const Layout = ({ children }: LayoutProps) => {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="overflow-x-hidden">
        {/* Global header spanning full width */}
        <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <HeaderSearch />
          <div className="ml-auto flex items-center gap-2">
            <NotificationBell />
            <ThemeToggle />
            <UserMenu />
          </div>
        </header>
        
        <main className="flex flex-1 flex-col gap-4 p-4 pt-0">
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
};