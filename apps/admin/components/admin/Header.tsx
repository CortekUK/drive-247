'use client';

import { Fragment } from 'react';
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
    '/admin/signup-plans': 'Signup Plans',
    '/admin/blacklist': 'Global Blacklist',
    '/admin/contacts': 'Contact Requests',
    '/admin/settings': 'Settings',
    '/admin/admins': 'Manage Admins',
    '/admin/audit-logs': 'Audit Logs',
    '/admin/requests': 'Mode Requests',
    '/admin/announcements': 'Announcements',
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
    <header
      /* No fill, no border, no blur — it sits straight on the app gradient,
         the way the portal's top bar does. It used to be `bg-background/80
         backdrop-blur-xl border-b`, which painted an opaque white band across
         the top of every page and cut the wash off at the header.

         Safe to leave bare because nothing ever passes under it: this is a
         non-scrolling row in a `h-screen` flex column, and `<main>` below is
         the only scroll container. The `sticky` stays only because it costs
         nothing on an element that cannot scroll. */
      className="sticky top-0 z-30 flex h-14 items-center gap-4 px-4 sm:px-6"
    >
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
            <Fragment key={`${crumb.href ?? crumb.label}-${index}`}>
              {index > 0 && <BreadcrumbSeparator />}
              <BreadcrumbItem>
                {crumb.href ? (
                  <BreadcrumbLink asChild>
                    <Link href={crumb.href}>{crumb.label}</Link>
                  </BreadcrumbLink>
                ) : (
                  <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                )}
              </BreadcrumbItem>
            </Fragment>
          ))}
        </BreadcrumbList>
      </Breadcrumb>
    </header>
  );
}
