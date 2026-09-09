'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, ArrowLeft, Loader2, Lock, Mail, ShieldCheck } from 'lucide-react';

import { PasswordInput } from '@/components/ui/password-input';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';

/**
 * One shell for both fields. It owns the border, the surface and the focus
 * ring (through `focus-within`, so the ring wraps the icon and the reveal
 * toggle too rather than just the text box).
 *
 * The split matters beyond looks: the input inside stays fully transparent,
 * which is the precondition for `.autofill-tamed` in app/globals.css — that
 * rule clips Chrome's autofill slab to the glyphs, and `background-clip` would
 * clip a background painted on the input itself right along with it.
 */
// Hover moves the surface, focus moves the border and the ring — deliberately
// different properties. Tailwind emits `hover:` AFTER `focus-within:`, so any
// property both states claim is won by hover, and a focused field would
// visibly lose its focus treatment the moment the pointer crossed it.
const FIELD_SHELL =
  'group flex items-center gap-3 rounded-3xl border border-border bg-muted/60 ' +
  'transition-[border-color,background-color,box-shadow] duration-200 ' +
  'hover:bg-muted ' +
  'focus-within:border-primary/40 focus-within:ring-3 focus-within:ring-primary/15';

/** The input: no surface, no border, no ring of its own — the shell has those. */
const FIELD_INPUT =
  'autofill-tamed h-12 w-full bg-transparent text-sm text-foreground ' +
  'placeholder:text-muted-foreground/70 ' +
  'focus-visible:border-transparent focus-visible:ring-0';

const FIELD_ICON =
  'h-4 w-4 shrink-0 text-muted-foreground transition-colors group-focus-within:text-primary';

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
    // `m-auto` on the child rather than `items-center` here: auto margins still
    // centre, but they leave the top of a too-tall card reachable instead of
    // clipping it off-screen, which is what `justify-content: center` does on a
    // short phone viewport.
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-muted bg-app-gradient px-4 py-10">
      {/* Halo behind the card, so it reads as lifted off the canvas rather than
          floating on nothing. Static — nothing here animates on its own. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 h-[34rem] w-[34rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/10 blur-3xl"
      />

      <div className="relative z-10 m-auto w-full max-w-md motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-3 motion-safe:duration-500">
        {/* Four distinct treatments rather than three stacked greys: a mark, the
            wordmark in the app's own type, a tinted eyebrow chip, then
            ink-and-muted copy inside the card. */}
        <header className="mb-7 flex flex-col items-center text-center">
          <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-3xl bg-gradient-to-br from-primary to-chart-3 text-primary-foreground shadow-lg shadow-primary/25">
            <ShieldCheck className="h-7 w-7" aria-hidden="true" />
          </div>

          {/* Plain Manrope, the app's own typeface, at the same weight and
              tracking idiom as the "Sign in" heading below it.

              It previously carried `gradient-text` plus `tracking-[0.14em]`.
              Neither is house style here: `gradient-text` appears in NO other
              file in apps/admin, and the only other wide-tracking use in the
              app (signup-plan-preview.tsx:117) is on an 11px uppercase eyebrow,
              where wide tracking is correct. Extrabold and letter-spaced on a
              4xl wordmark reads as a generic template rather than as this
              product — and letterspacing changes the perceived typeface enough
              that it looked like a different font from the rest of the app.
              The real wordmark elsewhere is the sidebar's "Drive247":
              font-semibold, no gradient, no tracking. */}
          <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            CORTEK
          </h1>

          <p className="mt-3 inline-flex items-center rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
            Super Admin Portal
          </p>
        </header>

        <div className="rounded-4xl bg-card p-6 shadow-xl shadow-foreground/[0.06] ring-1 ring-foreground/10 sm:p-8">
          <div className="mb-6">
            <h2 className="text-lg font-semibold tracking-tight text-foreground">Sign in</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Sign in to access the platform dashboard.
            </p>
          </div>

          <form className="space-y-5" onSubmit={handleSubmit}>
            {error && (
              // A tinted surface with coloured ink, the same treatment
              // components/ui/button.tsx gives `destructive` — legible as a
              // failure without turning the card into a red slab.
              <div
                role="alert"
                className="flex items-start gap-3 rounded-2xl border border-destructive/20 bg-destructive/[0.06] px-4 py-3 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
                <p className="text-sm leading-snug text-destructive">{error}</p>
              </div>
            )}

            <div className="space-y-2">
              <label htmlFor="email" className="block text-sm font-medium text-foreground">
                Email address
              </label>
              <div className={cn(FIELD_SHELL, 'px-4')}>
                <Mail className={FIELD_ICON} aria-hidden="true" />
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
                  className={cn(FIELD_INPUT, 'px-0 outline-none')}
                  placeholder="admin@example.com"
                />
              </div>
            </div>

            {/* pb-1 plus the form's 20px rhythm leaves 24px under the shell —
                the room the out-of-flow Caps Lock notice needs, reserved up
                front so it cannot shove the submit button mid-password. */}
            <div className="space-y-2 pb-1">
              <label htmlFor="password" className="block text-sm font-medium text-foreground">
                Password
              </label>
              <div className={cn(FIELD_SHELL, 'pl-4 pr-2')}>
                <Lock className={FIELD_ICON} aria-hidden="true" />
                <PasswordInput
                  id="password"
                  name="password"
                  autoComplete="current-password"
                  required
                  disabled={loading}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={cn(FIELD_INPUT, 'px-0 pr-11 outline-none')}
                  placeholder="Enter your password"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              aria-busy={loading}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-4xl bg-primary text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition-all duration-200 hover:bg-[hsl(var(--primary-hover))] hover:shadow-xl hover:shadow-primary/30 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card active:bg-[hsl(var(--primary-hover))] active:shadow-md motion-safe:active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70 disabled:shadow-none"
            >
              {loading ? (
                <>
                  {/* Slowed rather than stopped under reduced motion: a frozen
                      spinner would say the sign-in had died. */}
                  <Loader2
                    className="h-4 w-4 animate-spin motion-reduce:[animation-duration:1.5s]"
                    aria-hidden="true"
                  />
                  Signing in…
                </>
              ) : (
                'Sign in'
              )}
            </button>
          </form>
        </div>

        <div className="mt-6 flex flex-col items-center gap-2 text-center">
          <a
            href="/"
            className="group inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <ArrowLeft
              className="h-3.5 w-3.5 transition-transform motion-safe:group-hover:-translate-x-0.5"
              aria-hidden="true"
            />
            Back to landing page
          </a>
          <p className="text-xs text-muted-foreground/70">
            Restricted to Drive247 super admins and sales agents.
          </p>
        </div>
      </div>
    </div>
  );
}
