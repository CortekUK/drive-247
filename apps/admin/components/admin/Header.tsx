'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useSidebar } from './SidebarContext';
import { Button } from '@/components/ui/button';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Menu } from 'lucide-react';

function useBreadcrumbs() {
  const pathname = usePathname();

  const routeLabels: Record<string, string> = {
    '/admin/dashboard': 'Dashboard',
    '/admin/rentals': 'Rental Companies',
    '/admin/blacklist': 'Global Blacklist',
    '/admin/contacts': 'Contact Requests',
    '/admin/settings': 'Settings',
    '/admin/admins': 'Manage Admins',
    '/admin/audit-logs': 'Audit Logs',
    '/admin/requests': 'Mode Requests',
  };

  const segments = pathname.split('/').filter(Boolean);
  const crumbs: { label: string; href?: string }[] = [];

  let currentPath = '';
  for (let i = 0; i < segments.length; i++) {
    currentPath += `/${segments[i]}`;

    if (currentPath === '/admin') continue;

    const label = routeLabels[currentPath];
    if (label) {
      crumbs.push({
        label,
        href: currentPath === pathname ? undefined : currentPath,
      });
    } else if (i >= 2) {
      const parentPath = segments.slice(0, i).join('/');
      const parentLabel = routeLabels[`/${parentPath}`];
      if (!crumbs.find((c) => c.label === parentLabel)) {
        crumbs.push({
          label: parentLabel || segments[i - 1],
          href: `/${parentPath}`,
        });
      }
      crumbs.push({ label: 'Details' });
    }
  }

  return crumbs;
}

export function Header() {
  const { isMobile, toggle } = useSidebar();
  const breadcrumbs = useBreadcrumbs();

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b border-border/60 bg-background/80 backdrop-blur-xl px-4 sm:px-6">
      {isMobile && (
        <Button
          variant="ghost"
          size="icon"
          onClick={toggle}
          className="-ml-2 text-muted-foreground h-8 w-8"
          aria-label="Toggle menu"
        >
          <Menu className="h-4 w-4" />
        </Button>
      )}

      <Breadcrumb className="flex-1">
        <BreadcrumbList>
          {breadcrumbs.map((crumb, index) => (
            <BreadcrumbItem key={index}>
              {index > 0 && <BreadcrumbSeparator />}
              {crumb.href ? (
                <BreadcrumbLink asChild>
                  <Link href={crumb.href}>{crumb.label}</Link>
                </BreadcrumbLink>
              ) : (
                <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
              )}
            </BreadcrumbItem>
          ))}
        </BreadcrumbList>
      </Breadcrumb>
    </header>
  );
}
