'use client';

/**
 * The developer hub's sign-in: the super-admin dashboard's login
 * (apps/admin/app/admin/login/page.tsx), drawn the same way. A split hero
 * with the Drive247 wash on the left, the form straight on the page on the
 * right, no card. Where the admin hero types live platform facts, this one
 * says what the hub is for.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Loader2 } from 'lucide-react';

import { PasswordInput } from '@/components/ui/password-input';
import { useAuthStore } from '@/store/authStore';

/** The admin login's brand wash and ink (#6366f1 held to a light page). */
const HERO_WASH = 'hsl(239 58% 88%)';
const ACCENT_INK = 'hsl(239 84% 42%)';

/** The wash dissolves into the form side with no seam. */
const WASH_MASK = `linear-gradient(to right,
  rgb(0 0 0) 0%,
  rgb(0 0 0) 34%,
  rgb(0 0 0 / 0.96) 42%,
  rgb(0 0 0 / 0.88) 49%,
  rgb(0 0 0 / 0.74) 56%,
  rgb(0 0 0 / 0.56) 63%,
  rgb(0 0 0 / 0.38) 70%,
  rgb(0 0 0 / 0.22) 77%,
  rgb(0 0 0 / 0.10) 84%,
  rgb(0 0 0 / 0.03) 92%,
  rgb(0 0 0 / 0) 100%)`;

const MOBILE_WASH_MASK = `linear-gradient(to bottom,
  rgb(0 0 0) 0%,
  rgb(0 0 0) 18%,
  rgb(0 0 0 / 0.88) 34%,
  rgb(0 0 0 / 0.68) 48%,
  rgb(0 0 0 / 0.44) 62%,
  rgb(0 0 0 / 0.22) 76%,
  rgb(0 0 0 / 0.08) 88%,
  rgb(0 0 0 / 0) 100%)`;

/** The admin login's fields: 48px, white, a border that holds on the wash and on white. */
const FIELD_CLASS =
  'h-12 w-full rounded-2xl border border-slate-900/20 bg-white px-4 text-[15px] text-slate-900 shadow-[0_1px_2px_rgb(15_23_42/0.04)] outline-none transition-colors placeholder:text-slate-400 hover:border-slate-900/30 focus-visible:border-primary/50 focus-visible:ring-3 focus-visible:ring-primary/20 disabled:opacity-60';

function Headline({ compact = false }: { compact?: boolean }) {
  return (
    <div>
      <p
        className={
          compact
            ? 'text-2xl font-semibold leading-tight tracking-tight text-slate-900'
            : 'max-w-[18ch] text-5xl font-semibold leading-[1.05] tracking-tight text-slate-900'
        }
      >
        The Drive247 developer hub.{' '}
        <span style={{ color: ACCENT_INK }}>Try it here first.</span>
      </p>
      {!compact && (
        <p className="mt-4 max-w-[42ch] text-[15px] leading-relaxed text-slate-900/60">
          Test signups on test Stripe, and a clean slate whenever you want one. Everyone else signs up as normal.
        </p>
      )}
    </div>
  );
}

export default function DeveloperLoginPage() {
  const router = useRouter();
  const { login, user } = useAuthStore();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user) router.push('/onboarding');
  }, [user, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      router.push('/onboarding');
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Invalid email or password');
    } finally {
      setLoading(false);
    }
  };

  return (
    // Always light, as the admin login is: the wash and the slate inks are
    // drawn for a light page. `data-keep-light` holds it there in dark mode.
    <div data-keep-light className="relative min-h-screen overflow-hidden bg-white lg:grid lg:grid-cols-2">
      <div
        aria-hidden
        className="absolute inset-y-0 left-0 hidden w-full lg:block"
        style={{ backgroundColor: HERO_WASH, maskImage: WASH_MASK, WebkitMaskImage: WASH_MASK }}
      />
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-[42vh] lg:hidden"
        style={{ backgroundColor: HERO_WASH, maskImage: MOBILE_WASH_MASK, WebkitMaskImage: MOBILE_WASH_MASK }}
      />

      {/* ---------- Left: the hero (lg and up) ---------- */}
      <aside className="relative hidden overflow-hidden p-12 text-slate-900 lg:flex lg:flex-col lg:justify-between">
        <div className="relative z-10">
          <img
            src="/drive247-logo-light.png"
            alt="Drive247"
            width={855}
            height={195}
            className="h-14 w-auto max-w-[220px] object-contain"
          />
        </div>

        <div className="relative z-10">
          <Headline />
        </div>

        <p className="relative z-10 text-xs text-slate-900/50">
          © {new Date().getFullYear()} Drive247. All rights reserved.
        </p>
      </aside>

      {/* Phone: the mark pinned near the top edge, in the wash. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center pt-8 lg:hidden">
        <img
          src="/drive247-logo-light.png"
          alt="Drive247"
          width={855}
          height={195}
          className="h-8 w-auto max-w-[180px] object-contain"
        />
      </div>

      {/* ---------- Right: sign-in form ---------- */}
      <main className="relative flex min-h-screen items-start justify-center px-6 pb-10 pt-[104px] sm:px-10 lg:items-center lg:py-12">
        <div className="w-full max-w-[480px]">
          <div className="mb-7 lg:hidden">
            <Headline compact />
          </div>

          <div className="mb-6 space-y-1.5">
            <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Sign in</h1>
            <p className="text-sm text-slate-500">Enter your email and password to open the developer hub.</p>
          </div>

          <form className="space-y-4" onSubmit={handleSubmit}>
            {error && (
              <div
                role="alert"
                className="flex items-start gap-3 rounded-2xl border border-destructive/20 bg-destructive/[0.06] px-4 py-3"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
                <p className="text-sm leading-snug text-destructive">{error}</p>
              </div>
            )}

            <div className="space-y-2">
              <label htmlFor="email" className="block text-sm font-medium text-slate-900">
                Email Address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                autoFocus
                required
                disabled={loading}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={FIELD_CLASS}
                placeholder="Enter your email"
              />
            </div>

            {/* pb-1 leaves room under the field for the out-of-flow Caps Lock notice. */}
            <div className="space-y-2 pb-1">
              <label htmlFor="password" className="block text-sm font-medium text-slate-900">
                Password
              </label>
              <PasswordInput
                id="password"
                name="password"
                autoComplete="current-password"
                required
                disabled={loading}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`${FIELD_CLASS} pr-11`}
                placeholder="Enter your password"
              />
            </div>

            <button
              type="submit"
              disabled={loading || !email || !password}
              aria-busy={loading}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-base font-medium text-primary-foreground transition-colors hover:bg-primary/85 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin motion-reduce:[animation-duration:1.5s]" aria-hidden="true" />
                  Signing in...
                </>
              ) : (
                'Sign In'
              )}
            </button>
          </form>

          <p className="mt-6 text-center text-xs text-slate-400">Restricted to Drive247 super admins.</p>
        </div>
      </main>
    </div>
  );
}
