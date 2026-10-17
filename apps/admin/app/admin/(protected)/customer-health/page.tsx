import { redirect } from 'next/navigation';

/**
 * Customer Health Score is a section of Customer Management now (Oct 17 2026).
 * This keeps old links and bookmarks working.
 */
export default function CustomerHealthRedirect() {
  redirect('/admin/customer-management?section=health');
}
