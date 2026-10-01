'use client';

/*
 * The sidebar's state now lives in the ported Northwind primitive
 * (`components/ui/sidebar.tsx`): expanded/collapsed on a desktop, the phone
 * sheet's open state, ⌘B. This file stays as the import path the rest of the
 * app already uses, so nothing that only reads `isMobile` has to move.
 */
export { SidebarProvider, useSidebar } from '@/components/ui/sidebar';
