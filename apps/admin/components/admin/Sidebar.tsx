'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { useAuthStore } from '@/store/authStore';
import { useSidebar } from './SidebarContext';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  Building2,
  Ban,
  Mail,
  Settings,
  Users,
  ChevronDown,
  LogOut,
  ScrollText,
  ArrowUpCircle,
} from 'lucide-react';

interface NavItem {
  name: string;
  href: string;
  icon: React.ElementType;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

function useNavigation() {
  const { user } = useAuthStore();

  const groups: NavGroup[] = [
    {
      label: 'Overview',
      items: [
        { name: 'Dashboard', href: '/admin/dashboard', icon: LayoutDashboard },
      ],
    },
    {
      label: 'Management',
      items: [
        { name: 'Rental Companies', href: '/admin/rentals', icon: Building2 },
        { name: 'Global Blacklist', href: '/admin/blacklist', icon: Ban },
        { name: 'Contact Requests', href: '/admin/contacts', icon: Mail },
        { name: 'Mode Requests', href: '/admin/requests', icon: ArrowUpCircle },
        { name: 'Audit Logs', href: '/admin/audit-logs', icon: ScrollText },
      ],
    },
    {
      label: 'Configuration',
      items: [
        { name: 'Settings', href: '/admin/settings', icon: Settings },
        ...(user?.is_primary_super_admin
          ? [{ name: 'Manage Admins', href: '/admin/admins', icon: Users }]
          : []),
      ],
    },
  ];

  return groups;
}

function NavGroupComponent({
  group,
  isActive,
  onNavigate,
}: {
  group: NavGroup;
  isActive: (href: string) => boolean;
  onNavigate?: () => void;
}) {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <div className="mb-2">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between px-4 py-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/70 hover:text-muted-foreground transition-colors"
      >
        {group.label}
        <ChevronDown
          className={cn(
            'h-3 w-3 transition-transform duration-200',
            !isOpen && '-rotate-90'
          )}
        />
      </button>
      {isOpen && (
        <div className="mt-1 space-y-0.5 px-3">
          {group.items.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <Link
                key={item.name}
                href={item.href}
                onClick={onNavigate}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-all duration-200',
                  active
                    ? 'bg-primary/15 text-primary glow-purple'
                    : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                )}
              >
                <Icon className={cn("h-4 w-4", active && "text-primary")} />
                {item.name}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { user, logout } = useAuthStore();
  const groups = useNavigation();

  const isActive = (href: string) => {
    if (href === '/admin/dashboard') return pathname === href;
    return pathname.startsWith(href);
  };

  return (
    <div className="flex flex-col h-full bg-sidebar">
      {/* Logo */}
      <div className="flex items-center gap-3 h-16 px-5 border-b border-sidebar-border">
        <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-primary/15 glow-purple-sm">
          <span className="text-primary font-bold text-sm">D</span>
        </div>
        <div>
          <h1 className="text-sm font-semibold text-sidebar-foreground">Drive247</h1>
          <p className="text-[10px] text-sidebar-muted">Super Admin</p>
        </div>
      </div>

      {/* Navigation */}
      <ScrollArea className="flex-1 py-4">
        {groups.map((group) => (
          <NavGroupComponent
            key={group.label}
            group={group}
            isActive={isActive}
            onNavigate={onNavigate}
          />
        ))}
      </ScrollArea>

      {/* Footer */}
      <div className="border-t border-sidebar-border p-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="flex items-center justify-center h-8 w-8 rounded-full bg-primary/15 text-primary text-xs font-bold">
            {user?.email?.[0]?.toUpperCase() || 'A'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-medium text-sidebar-foreground truncate">
              {user?.name || user?.email}
            </p>
            {user?.is_primary_super_admin && (
              <span className="inline-flex items-center mt-0.5 px-1.5 py-0 text-[10px] font-semibold rounded-full bg-primary/15 text-primary border border-primary/30">
                Primary Admin
              </span>
            )}
          </div>
        </div>
        <Separator className="mb-3 bg-sidebar-border" />
        <button
          onClick={() => logout()}
          className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-all"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </div>
  );
}

export default function Sidebar() {
  const { isMobile, isOpen, close } = useSidebar();

  if (isMobile) {
    return (
      <Sheet open={isOpen} onOpenChange={close}>
        <SheetContent side="left" className="p-0 w-[260px] border-r-0">
          <SidebarContent onNavigate={close} />
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <div className="hidden md:flex flex-col h-screen w-[260px] border-r border-sidebar-border flex-shrink-0">
      <SidebarContent />
    </div>
  );
}
