'use client';

/**
 * Developer → Signup Rehearsal: the real self-serve signup, repeatable with
 * one email. The first page of the Developer side.
 */

import { FlaskConical } from 'lucide-react';
import { DeveloperHeader } from '@/components/admin/developer/developer-header';
import { RehearsalCard } from '@/components/admin/developer/rehearsal-card';
import { useDeveloperStatus } from '@/components/admin/developer/use-developer-status';

export default function SignupRehearsalPage() {
  const status = useDeveloperStatus();
  return (
    <>
      <DeveloperHeader
        icon={FlaskConical}
        title="Signup Rehearsal"
        description="Run the real signup again and again with one email. Nothing here affects any other tenant."
      />
      <RehearsalCard status={status.data ?? null} onChanged={async () => {
        await status.refetch();
      }} />
    </>
  );
}
