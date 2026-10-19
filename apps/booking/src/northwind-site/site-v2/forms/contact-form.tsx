'use client';

/**
 * Northwind booking site v2 — the contact form, in the `.pv2` language.
 *
 * The rules are the current form's, imported rather than copied: the vehicle
 * choices, the zod schema, the empty values and the submit all come from
 * `components/forms/contact-form-logic.ts`, so both versions accept and send
 * exactly the same thing. Only the markup is new.
 *
 * Outcomes are stated in the card itself (a sent panel, or a line above the
 * button), not toasted: no `<Toaster />` is mounted on the public site, so a
 * toast would be a message nobody sees.
 */

import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Check, ChevronDown } from 'lucide-react-nw';

import { Button } from '@nw/components/ui/button';
import {
  CONTACT_DEFAULT_VALUES,
  VEHICLE_OPTIONS,
  contactSchema,
  submitContact,
  type ContactValues,
} from '@nw/components/forms/contact-form-logic';
import { cn } from '@nw/lib/utils';
import { CARD, CardHeading, FIELD, FIELD_LABEL } from '@nw/site-v2/kit';

export function ContactForm() {
  const [submitted, setSubmitted] = useState(false);
  const [failed, setFailed] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ContactValues>({
    resolver: zodResolver(contactSchema),
    defaultValues: CONTACT_DEFAULT_VALUES,
  });

  async function onSubmit(values: ContactValues) {
    setFailed(false);
    try {
      await submitContact(values);
      setSubmitted(true);
    } catch {
      setFailed(true);
    }
  }

  if (submitted) {
    return (
      <div className={cn(CARD, 'pv2-enter flex flex-col items-center gap-3 px-6 py-12 text-center')}>
        <span className="grid size-12 place-items-center rounded-2xl bg-pv-success-light text-pv-success">
          <Check aria-hidden className="size-5" strokeWidth={2} />
        </span>
        <p className="text-[15px] font-semibold text-pv-fg">Message sent</p>
        <p className="max-w-xs text-[13px] text-pv-muted-fg">Thank you. We will be in touch shortly.</p>
        <Button
          type="button"
          variant="brand-outline"
          className="mt-2 h-11 px-5"
          onClick={() => {
            reset(CONTACT_DEFAULT_VALUES);
            setSubmitted(false);
          }}
        >
          Send another message
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className={cn(CARD, 'flex flex-col gap-5 p-5 sm:p-6')}>
      <CardHeading title="Send us a message" description="Tell us what you need and we will get back to you." />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field id="cf-fullName" label="Full name" error={errors.fullName?.message}>
          <input
            id="cf-fullName"
            autoComplete="name"
            placeholder="Your name"
            aria-invalid={!!errors.fullName}
            className={FIELD}
            {...register('fullName')}
          />
        </Field>
        <Field id="cf-email" label="Email" error={errors.email?.message}>
          <input
            id="cf-email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            aria-invalid={!!errors.email}
            className={FIELD}
            {...register('email')}
          />
        </Field>
        <Field id="cf-phone" label="Phone number" error={errors.phone?.message}>
          <input
            id="cf-phone"
            type="tel"
            autoComplete="tel"
            placeholder="Your phone number"
            aria-invalid={!!errors.phone}
            className={FIELD}
            {...register('phone')}
          />
        </Field>
        <Field id="cf-vehicle" label="Vehicle of interest" error={errors.vehicleOfInterest?.message}>
          <div className="relative">
            <select
              id="cf-vehicle"
              aria-invalid={!!errors.vehicleOfInterest}
              className={cn(FIELD, 'cursor-pointer appearance-none pr-9')}
              {...register('vehicleOfInterest')}
            >
              <option value="" disabled>
                Select an option
              </option>
              {VEHICLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <ChevronDown
              aria-hidden
              className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-pv-muted-fg"
            />
          </div>
        </Field>
      </div>

      <Field id="cf-details" label="Additional details">
        <textarea
          id="cf-details"
          rows={4}
          placeholder="Type your message here"
          className={cn(FIELD, 'h-auto min-h-[112px] resize-y py-2.5 leading-relaxed')}
          {...register('details')}
        />
      </Field>

      {failed ? (
        <p role="alert" className="rounded-[10px] bg-pv-danger-light px-3 py-2.5 text-[13px] text-pv-danger">
          We could not send your message. Please try again in a moment.
        </p>
      ) : null}

      <Button type="submit" variant="brand" disabled={isSubmitting} className="h-11 w-full px-6 sm:w-auto sm:self-start">
        {isSubmitting ? 'Sending…' : 'Send message'}
      </Button>
    </form>
  );
}

function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className={FIELD_LABEL}>
        {label}
      </label>
      {children}
      {error ? <p className="text-xs text-pv-danger">{error}</p> : null}
    </div>
  );
}
