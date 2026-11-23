import { redirect } from 'next/navigation';

/** The hub's front door is its first tab; the protected layout sends anyone signed out to /login. */
export default function RootPage() {
  redirect('/onboarding');
}
