import { TestEmailsPanel } from '@/components/onboarding/test-emails-panel';

export default function OnboardingPage() {
  return (
    <div className="space-y-6">
      <header className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Onboarding</h1>
        <p className="text-sm text-muted-foreground">
          Sign up on test Stripe with your own addresses, then reset and go again.
        </p>
      </header>
      <TestEmailsPanel />
    </div>
  );
}
