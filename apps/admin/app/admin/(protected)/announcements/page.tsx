'use client';

import { Suspense } from 'react';
import { ListSkeleton } from '@/components/announcements/announcement-list';
import { AnnouncementsPage } from '@/components/announcements/announcements-page';

// The page reads ?tab= with useSearchParams, which needs a Suspense boundary on
// a statically prerendered route or `next build` fails.
export default function AnnouncementsRoute() {
  return (
    <Suspense fallback={<ListSkeleton />}>
      <AnnouncementsPage />
    </Suspense>
  );
}
