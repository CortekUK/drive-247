'use client';

/** Developer → Customer Management: the operator email sequence, at compressed speed. */

import { Mail } from 'lucide-react';
import { DeveloperHeader } from '@/components/admin/developer/developer-header';
import { CustomerManagementCard } from '@/components/admin/developer/customer-management-card';

export default function CustomerManagementPage() {
  return (
    <>
      <DeveloperHeader
        icon={Mail}
        title="Customer Management"
        description="Rehearse the operator email sequence at compressed speed."
      />
      <CustomerManagementCard />
    </>
  );
}
