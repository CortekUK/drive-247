'use client';

import { ShieldCheck } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import BonzahSubmissions from '@/components/admin/BonzahSubmissions';
import BonzahContentEditor from '@/components/admin/BonzahContentEditor';

// Bonzah insurance onboarding for super admins.
//
// These two panes used to live as tabs on the unified /admin/onboarding page,
// and this route was a redirect into it. That page has been removed, so the
// panes come back here — their original home. Nothing about the Bonzah review
// pipeline itself changed: tenants still submit from the portal, and Brandon
// still reviews in the Bonzah Partner Console (apps/bonzah), which reads the
// submissions table directly.
export default function BonzahOnboardingPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center h-10 w-10 rounded-xl bg-primary/15 glow-purple-sm">
          <ShieldCheck className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Bonzah Onboarding</h1>
          <p className="text-sm text-muted-foreground">
            Tenant insurance applications, and the training &amp; quiz content they see
          </p>
        </div>
      </div>

      <Tabs defaultValue="forms">
        <TabsList>
          <TabsTrigger value="forms">Bonzah Forms</TabsTrigger>
          <TabsTrigger value="content">Training &amp; Quiz</TabsTrigger>
        </TabsList>

        <TabsContent value="forms" className="mt-4">
          <BonzahSubmissions />
        </TabsContent>

        <TabsContent value="content" className="mt-4">
          <BonzahContentEditor />
        </TabsContent>
      </Tabs>
    </div>
  );
}
