'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { usePortalAuthStore } from '@/stores/portal-auth-store';
import { authApi } from '@/lib/api';
import {
  Button,
  Avatar,
  AvatarFallback,
  Separator,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Badge,
} from '@drive247/ui';
import { cn } from '@drive247/ui';

const navItems = [
  { href: '/', label: 'Dashboard' },
  { href: '/users', label: 'Users' },
  { href: '/change-password', label: 'Change Password' },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, isAuthenticated, isLoading, setAuth, setLoading, logout } =
    usePortalAuthStore();

  useEffect(() => {
    const checkAuth = async () => {
      try {
        // Just call me() — if no token, interceptor auto-refreshes via cookie
        const { data: res } = await authApi.me();
        if (res.success) {
          setAuth(usePortalAuthStore.getState().accessToken!, res.data);
        } else {
          router.replace('/login');
        }
      } catch {
        router.replace('/login');
      } finally {
        setLoading(false);
      }
    };

    if (!isAuthenticated) {
      checkAuth();
    } else {
      setLoading(false);
    }
  }, []);

  const handleLogout = async () => {
    try {
      await authApi.logout();
    } catch {
      // ignore
    }
    logout();
    router.replace('/login');
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!isAuthenticated) return null;

  const initials = user?.name
    ? user.name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
    : user?.email?.[0]?.toUpperCase() ?? '?';

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="w-[240px] border-r bg-white flex flex-col">
        <div className="p-4 border-b">
          <h1 className="text-lg font-semibold">Drive 247</h1>
          <p className="text-xs text-muted-foreground">Admin Portal</p>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center px-3 py-2 text-sm rounded-md transition-colors',
                pathname === item.href
                  ? 'bg-[#e0e7ff] text-[#6366f1] font-medium'
                  : 'text-[#404040] hover:bg-[#f1f5f9]',
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <Separator />
        <div className="p-3">
          <Badge variant="outline" className="text-xs">
            {user?.role}
          </Badge>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col bg-[#f8fafc]">
        {/* Header */}
        <header className="h-14 border-b bg-white px-6 flex items-center justify-between">
          <span className="text-sm font-medium text-[#080812]">
            {navItems.find((n) => n.href === pathname)?.label ?? 'Dashboard'}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="gap-2">
                <Avatar className="h-7 w-7">
                  <AvatarFallback className="text-xs bg-[#6366f1] text-white">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <span className="text-sm">{user?.name || user?.email}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel className="font-normal">
                <p className="text-sm font-medium">{user?.name}</p>
                <p className="text-xs text-muted-foreground">{user?.email}</p>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={handleLogout}
                className="text-destructive cursor-pointer"
              >
                Logout
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        {/* Content */}
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
