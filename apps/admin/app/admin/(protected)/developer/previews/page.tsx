'use client';

/** Developer → Previews: autofill, skeletons, message / billing scenarios and empty states on Northwind. */

import { Eye } from 'lucide-react';
import { DeveloperHeader } from '@/components/admin/developer/developer-header';
import { PreviewsCard } from '@/components/admin/developer/previews-card';
import { useDeveloperStatus } from '@/components/admin/developer/use-developer-status';

export default function PreviewsPage() {
  const status = useDeveloperStatus();
  return (
    <>
      <DeveloperHeader
        icon={Eye}
        title="Previews"
        description="Switch the Northwind portal into states that are hard to reach by clicking."
      />
      <PreviewsCard initial={status.data?.settings.portalPreviews ?? null} />
    </>
  );
}
