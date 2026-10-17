'use client';

/**
 * The super-admin sign-in, drawn as Northwind's portal login
 * (apps/portal/src/components/auth-v2/login-v2.tsx): a split hero with the
 * Drive247 wash on the left — wordmark at the top, a typed headline in the
 * middle, the copyright at the foot — and the form sitting straight on the
 * page on the right, no card.
 *
 * Where the portal's headline sells features, this one types live facts about
 * the whole platform (components/admin/login/platform-facts.tsx).
 *
 * The sign-in itself is unchanged: the same `login` from the same store, the
 * same error, the same redirect to the dashboard.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, ArrowLeft, Loader2 } from 'lucide-react';

import { PasswordInput } from '@/components/ui/password-input';
import { PlatformFactsHeadline } from '@/components/admin/login/platform-facts';
import { useAuthStore } from '@/store/authStore';

/**
 * The Drive247 brand, through the portal's `brandSurface` / `brandInk` rules
 * for #6366f1 on a light page: the wash is the brand hue at 58% saturation and
 * 88% lightness, the ink the same hue held down to 42% lightness so it reads
 * on that wash. Written out rather than computed — this page has one brand.
 */
const HERO_WASH = 'hsl(239 58% 88%)';
const ACCENT_INK = 'hsl(239 84% 42%)';

/** The portal login's masks: the wash dissolves into the form side with no seam. */
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

/** The portal login's fields: 48px, white, a border that holds on the wash and on white. */
const FIELD_CLASS =
  'h-12 w-full rounded-2xl border border-slate-900/20 bg-white px-4 text-[15px] text-slate-900 shadow-[0_1px_2px_rgb(15_23_42/0.04)] outline-none transition-colors placeholder:text-slate-400 hover:border-slate-900/30 focus-visible:border-primary/50 focus-visible:ring-3 focus-visible:ring-primary/20 disabled:opacity-60';

export default function AdminLoginPage() {
  const router = useRouter();
  const { login, user } = useAuthStore();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user) {
      router.push('/admin/dashboard');
    }
  }, [user, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(email, password);
      router.push('/admin/dashboard');
    } catch (err: any) {
      setError(err.message || 'Invalid email or password');
    } finally {
      setLoading(false);
    }
  };

  return (
    // Always light, as Northwind's login is: the wash and the slate inks are
    // drawn for a light page. `data-keep-light` holds it there in dark mode.
    <div data-keep-light className="relative min-h-screen overflow-hidden bg-white lg:grid lg:grid-cols-2">
      {/* Spans the whole page and is dissolved by the mask, so the two halves
          read as one surface with no seam down the middle. */}
      <div
        aria-hidden
        className="absolute inset-y-0 left-0 hidden w-full lg:block"
        style={{ backgroundColor: HERO_WASH, maskImage: WASH_MASK, WebkitMaskImage: WASH_MASK }}
      />

      {/* Below `lg` the hero column is hidden; the tint comes down from the top
          edge instead and fades out above the fields. */}
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
          <PlatformFactsHeadline accentInk={ACCENT_INK} />
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
          {/* The same facts at a phone scale, where the hero column is gone. */}
          <div className="mb-7 lg:hidden">
            <PlatformFactsHeadline accentInk={ACCENT_INK} compact />
          </div>

          <div className="mb-6 space-y-1.5">
            <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Sign in</h1>
            <p className="text-sm text-slate-500">Enter your email and password to access the Drive247 admin.</p>
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

            {/* pb-1 leaves room under the field for the out-of-flow Caps Lock
                notice, so it cannot shove the button mid-password. */}
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

          <div className="mt-6 flex flex-col items-center gap-2 text-center">
            <a
              href="/"
              className="group inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-slate-500 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <ArrowLeft className="h-3.5 w-3.5 transition-transform motion-safe:group-hover:-translate-x-0.5" aria-hidden="true" />
              Back to landing page
            </a>
            <p className="text-xs text-slate-400">Restricted to Drive247 super admins and sales agents.</p>
          </div>
        </div>
      </main>
    </div>
  );
}
