'use client';

import { ClipboardCheck } from 'lucide-react';
import BonzahQueue from '@/components/console/BonzahQueue';

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center h-10 w-10 rounded-xl bg-primary/15">
          <ClipboardCheck className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Onboarding Reviews</h1>
          <p className="text-sm text-muted-foreground">
            Review operator applications and activate Bonzah coverage
          </p>
        </div>
      </div>

      <BonzahQueue />
    </div>
  );
}
