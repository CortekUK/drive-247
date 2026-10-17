'use client';

/**
 * The Developer pages, opened from the dashed DEVELOPER block at the foot of
 * the rail (components/admin/dev-section.tsx). Super admins only: the block is
 * shown to super admins alone, this layout sends anyone else back to the
 * dashboard, and the `dev-signup-rehearsal` edge function behind every button
 * refuses anyone who is not an active super admin.
 *
 * The four pages fill the rail as sections, with "Main menu" as the way back —
 * the same take-over a record page gets.
 */

import { useCallback, useEffect, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/authStore';
import { useRegisterSidebarSections } from '@/components/admin/sidebar-sections';
import { DEVELOPER_ROOT } from '@/components/admin/admin-nav';

const DEVELOPER_PAGES = [
  { id: DEVELOPER_ROOT, label: 'Signup Rehearsal' },
  { id: `${DEVELOPER_ROOT}/northwind`, label: 'Northwind Onboarding' },
  { id: `${DEVELOPER_ROOT}/customer-management`, label: 'Email Sequence Rehearsal' },
  { id: `${DEVELOPER_ROOT}/previews`, label: 'Previews' },
];

export default function DeveloperLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() ?? DEVELOPER_ROOT;
  const { user } = useAuthStore();

  useEffect(() => {
    if (user && !user.is_super_admin) router.push('/admin/dashboard');
  }, [user, router]);

  const open = useCallback((href: string) => router.push(href), [router]);

  // Registered under the CURRENT path, so the rail reads every Developer page
  // as a top-level page (back = "Main menu"), not as a record of the first one.
  useRegisterSidebarSections(pathname, DEVELOPER_PAGES, pathname, open, 'Developer');

  if (user && !user.is_super_admin) return null;
  return <div className="mx-auto max-w-4xl space-y-6">{children}</div>;
}
