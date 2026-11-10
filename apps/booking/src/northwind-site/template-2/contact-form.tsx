'use client';

/**
 * Template 2 ("Glass") — the contact form, filling its pane under the
 * operator's name. Sending turns the pane into a conversation: your message
 * on the right, then the operator types for a
 * moment, then confirms when to expect an answer (their own response time
 * from `contact / contact_info`, when they gave one). Like the home page's
 * questions thread, so the site speaks one way throughout.
 *
 * The rules are site-v2's, imported rather than copied
 * (`components/forms/contact-form-logic.ts`): the vehicle choices, the
 * schema, the empty values and the submit. Outcomes are stated in the
 * thread, not toasted: no toaster is mounted on the public site.
 * Reduced motion: no typing, the reply is simply there.
 */

import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { ArrowUp, ChevronDown, RotateCcw } from 'lucide-react-nw';

import {
  CONTACT_DEFAULT_VALUES,
  VEHICLE_OPTIONS,
  contactSchema,
  submitContact,
  type ContactValues,
} from '@nw/components/forms/contact-form-logic';
import { cn } from '@nw/lib/utils';

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--g2-accent)]/50';
export const G2_FIELD =
  'h-12 w-full rounded-[16px] border border-[rgb(13_12_29/0.08)] bg-white/90 px-4 text-[15px] text-[var(--g2-ink)] outline-none transition-[border-color,box-shadow] duration-200 placeholder:text-[var(--g2-ink-soft)]/70 focus:border-[color-mix(in_oklab,var(--g2-accent)_45%,white)] focus:shadow-[0_0_0_4px_color-mix(in_oklab,var(--g2-accent)_14%,transparent)] aria-[invalid=true]:border-red-300';
const LABEL = 'text-[13px] font-semibold text-[var(--g2-ink)]';
const THEIRS = 'g2-glass-thin rounded-[22px] rounded-bl-[8px] px-4 py-3 text-[15px] leading-relaxed text-[var(--g2-ink)]';
const TYPING_MS = 900;

export function Template2ContactForm({ operator, replyTime }: { operator: string; replyTime: string }) {
  const [sent, setSent] = useState<ContactValues | null>(null);
  const [typing, setTyping] = useState(false);
  const [failed, setFailed] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ContactValues>({ resolver: zodResolver(contactSchema), defaultValues: CONTACT_DEFAULT_VALUES });

  useEffect(() => {
    if (!typing) return;
    const timer = window.setTimeout(() => setTyping(false), TYPING_MS);
    return () => window.clearTimeout(timer);
  }, [typing]);

  async function onSubmit(values: ContactValues) {
    setFailed(false);
    try {
      await submitContact(values);
      setSent(values);
      setTyping(!window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch {
      setFailed(true);
    }
  }

  const firstName = sent?.fullName.trim().split(/\s+/)[0] ?? '';
  const when = replyTime ? replyTime.replace(/\s+$/, '') : 'shortly';

  return (
    <div className="g2-well g2-tray flex h-full min-h-[560px] flex-col lg:min-h-0 overflow-hidden rounded-[28px]">
      <div className="flex items-center gap-3 border-b border-white/60 px-5 py-4">
        <span aria-hidden className="g2-cta grid size-10 shrink-0 place-items-center rounded-full text-[15px] font-semibold">
          {operator.charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0">
          <h2 className="truncate text-[16px] font-semibold text-[var(--g2-ink)]">Message {operator}</h2>
          <p className="text-[12.5px] text-[var(--g2-ink-soft)]">{replyTime ? `Usually replies ${replyTime.trim()}` : 'We reply by email or phone'}</p>
        </div>
      </div>

      <div role="log" aria-live="polite" className={cn('flex-col gap-3 px-4 py-5 sm:px-6', sent ? 'flex flex-1' : 'hidden')}>
        {sent ? (
          <>
            <div className="g2-msg-in ml-auto max-w-[80%] rounded-[22px] rounded-br-[8px] bg-[var(--g2-accent)] px-4 py-3 text-[15px] leading-relaxed text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.3),0_8px_18px_-12px_var(--g2-accent)]">
              {sent.details?.trim() || `I am interested in ${VEHICLE_OPTIONS.find((o) => o.value === sent.vehicleOfInterest)?.label ?? 'a car'}.`}
              <span className="mt-1.5 block text-[12.5px] text-white/80">
                {sent.fullName}, {sent.email}
              </span>
            </div>
            {typing ? (
              <span aria-label={`${operator} is typing`} className="g2-glass-thin flex h-10 w-fit items-center gap-1 rounded-[22px] rounded-bl-[8px] px-4">
                <span className="g2-dot" />
                <span className="g2-dot [animation-delay:150ms]" />
                <span className="g2-dot [animation-delay:300ms]" />
              </span>
            ) : (
              <p className={cn(THEIRS, 'g2-msg-in max-w-[86%]')}>
                Thanks{firstName ? `, ${firstName}` : ''}. We have your message and will get back to you {when}.
              </p>
            )}
            <div className="mt-auto flex justify-center pt-4">
              <button
                type="button"
                onClick={() => {
                  reset(CONTACT_DEFAULT_VALUES);
                  setSent(null);
                }}
                className={cn(
                  'inline-flex h-11 items-center gap-2 rounded-full bg-white px-5 text-[14.5px] font-semibold text-[var(--g2-on-light)] shadow-[0_6px_16px_-10px_rgb(13_12_29/0.4),inset_0_1px_0_#fff]',
                  FOCUS,
                )}
              >
                <RotateCcw aria-hidden className="size-4" />
                Send another message
              </button>
            </div>
          </>
        ) : null}
      </div>

      {sent ? null : (
        // The reply box.
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-1 flex-col gap-4 p-4 sm:p-6">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field id="g2-cf-name" label="Full name" error={errors.fullName?.message}>
              <input id="g2-cf-name" autoComplete="name" placeholder="Your name" aria-invalid={!!errors.fullName} className={G2_FIELD} {...register('fullName')} />
            </Field>
            <Field id="g2-cf-email" label="Email" error={errors.email?.message}>
              <input id="g2-cf-email" type="email" autoComplete="email" placeholder="you@example.com" aria-invalid={!!errors.email} className={G2_FIELD} {...register('email')} />
            </Field>
            <Field id="g2-cf-phone" label="Phone number" error={errors.phone?.message}>
              <input id="g2-cf-phone" type="tel" autoComplete="tel" placeholder="Your phone number" aria-invalid={!!errors.phone} className={G2_FIELD} {...register('phone')} />
            </Field>
            <Field id="g2-cf-vehicle" label="Vehicle of interest" error={errors.vehicleOfInterest?.message}>
              <div className="relative">
                <select id="g2-cf-vehicle" aria-invalid={!!errors.vehicleOfInterest} className={cn(G2_FIELD, 'cursor-pointer appearance-none pr-10')} {...register('vehicleOfInterest')}>
                  <option value="" disabled>
                    Select an option
                  </option>
                  {VEHICLE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <ChevronDown aria-hidden className="pointer-events-none absolute right-4 top-1/2 size-4 -translate-y-1/2 text-[var(--g2-ink-soft)]" />
              </div>
            </Field>
          </div>

          {failed ? (
            <p role="alert" className="rounded-[14px] bg-red-50 px-4 py-3 text-[14px] text-red-700">
              Your message was not sent. Check your connection and try again.
            </p>
          ) : null}

          <div className="flex flex-1 flex-col gap-1.5">
            <label htmlFor="g2-cf-details" className={LABEL}>
              Message
            </label>
            <div className="flex flex-1 flex-col gap-3">
              <textarea
                id="g2-cf-details"
                placeholder="What can we help you with?"
                className={cn(G2_FIELD, 'block h-auto min-h-[140px] w-full flex-1 resize-none py-3.5 leading-snug lg:min-h-[88px]')}
                {...register('details')}
              />
              <button
                type="submit"
                disabled={isSubmitting}
                className={cn('g2-cta inline-flex h-12 items-center justify-center gap-2 self-end rounded-full px-6 text-[15px] font-semibold disabled:opacity-60 max-sm:self-stretch', FOCUS)}
              >
                {isSubmitting ? 'Sending' : 'Send message'}
                <ArrowUp aria-hidden className="size-4" strokeWidth={2.5} />
              </button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      {children}
      {error ? <p className="text-[13px] text-red-600">{error}</p> : null}
    </div>
  );
}
