import { redirect } from 'next/navigation';

// Renamed: Bonzah Onboarding is now part of the unified Onboarding page.
export default function BonzahOnboardingRedirect() {
  redirect('/admin/onboarding');
}
