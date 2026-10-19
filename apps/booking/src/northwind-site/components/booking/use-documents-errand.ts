'use client';

/**
 * The post-payment errand's LOGIC — who is done, what is still missing, and
 * the one send that drives both panels — shared by the v1 screen
 * (`documents-screen.tsx`) and the v2 one (`site-v2/booking/documents-screen.tsx`).
 * Only the markup is forked. Read `documents-screen.tsx`'s header for the rules:
 * the server decides a step is done, insurance is sent BEFORE identity, and no
 * success path says "confirmed".
 */

import { useCallback, useRef, useState } from 'react';

import type { IdentityCaptureHandle } from '@nw/components/booking/use-identity-capture';
import type { InsuranceUploadHandle } from '@nw/components/booking/use-insurance-upload';
import type { BookingDocumentsSession } from '@nw/hooks/use-booking-documents';
import { parseDateOnly } from '@nw/lib/domain';

export type StepKey = 'identity' | 'insurance';

export const STEP_LABEL: Record<StepKey, string> = {
  identity: 'Step 1 of 2',
  insurance: 'Step 2 of 2',
};

export function useDocumentsErrand(session: BookingDocumentsSession) {
  /*
    THE SERVER'S WORD IS THE STARTING POINT FOR BOTH PANELS. Only 'submitted'
    is done for identity — a rejection is not, and the identity panel renders
    its own retry state for it. `documentsStatus` 'submitted' is what
    `submit-insurance` writes.
  */
  const [identitySent, setIdentitySent] = useState(false);
  const [insuranceSent, setInsuranceSent] = useState(false);

  const identityDone = identitySent || session.identityStatus === 'submitted';
  const insuranceDone = insuranceSent || session.documentsStatus === 'submitted';

  /* What each panel says about itself, pushed up. */
  const [identityReady, setIdentityReady] = useState(false);
  const [identityMissing, setIdentityMissing] = useState<readonly string[]>([]);
  const [insuranceReady, setInsuranceReady] = useState(false);

  const identityRef = useRef<IdentityCaptureHandle>(null);
  const insuranceRef = useRef<InsuranceUploadHandle>(null);

  const [sending, setSending] = useState(false);
  const [sendProblem, setSendProblem] = useState<string | null>(null);

  const handleIdentitySubmitted = useCallback(() => {
    setIdentitySent(true);
  }, []);

  const handleInsuranceSubmitted = useCallback(() => {
    setInsuranceSent(true);
  }, []);

  /*
    Stable identities. Each is the dependency of an effect inside a panel, so a
    fresh closure on every shell render would re-fire that effect.
  */
  const handleIdentityReady = useCallback((ready: boolean) => {
    setIdentityReady(ready);
  }, []);
  const handleIdentityMissing = useCallback((missing: readonly string[]) => {
    setIdentityMissing(missing);
  }, []);
  const handleInsuranceReady = useCallback((ready: boolean) => {
    setInsuranceReady(ready);
  }, []);

  const bothDone = identityDone && insuranceDone;
  const outstanding = (identityDone ? 0 : 1) + (insuranceDone ? 0 : 1);

  /*
    "Present" is two facts joined by OR: the server has already filed it, or
    the customer has chosen it here.
  */
  const identityPresent = identityDone || identityReady;
  const insurancePresent = insuranceDone || insuranceReady;
  const canSend = identityPresent && insurancePresent && !sending;

  const missing: string[] = [
    ...(identityDone ? [] : identityMissing),
    ...(insurancePresent ? [] : ['your insurance document']),
  ];

  const handleSendEverything = useCallback(async () => {
    setSendProblem(null);
    setSending(true);
    try {
      /*
        INSURANCE FIRST. It is the call that essentially always works, and
        putting it behind the AI pass would let an outage in the AI pass block it.
      */
      let allWell = true;
      if (!insuranceDone) {
        const ok = (await insuranceRef.current?.submit()) ?? false;
        if (!ok) allWell = false;
      }
      if (!identityDone) {
        const ok = (await identityRef.current?.submit()) ?? false;
        if (!ok) allWell = false;
      }
      if (!allWell) {
        // Each panel has already rendered the specific reason. This line only
        // says where to look.
        setSendProblem(
          'Not everything went through. The part that did not is marked above, ' +
            'and anything that arrived has been kept — you only need to send the rest.',
        );
      }
    } finally {
      setSending(false);
    }
  }, [identityDone, insuranceDone]);

  return {
    identityDone,
    insuranceDone,
    bothDone,
    outstanding,
    canSend,
    missing,
    sending,
    sendProblem,
    identityRef,
    insuranceRef,
    handleIdentitySubmitted,
    handleInsuranceSubmitted,
    handleIdentityReady,
    handleIdentityMissing,
    handleInsuranceReady,
    handleSendEverything,
  };
}

/** "Still needed: a, b and c." — or null when nothing is. */
export function missingSentence(missing: readonly string[]): string | null {
  return missing.length === 0
    ? null
    : missing.length === 1
      ? `Still needed: ${missing[0]}.`
      : `Still needed: ${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]}.`;
}

/**
 * `start_date` and `end_date` are Postgres DATE columns, so they arrive as bare
 * "YYYY-MM-DD". `new Date()` would read them as UTC midnight and render the day
 * BEFORE for every viewer west of Greenwich. `parseDateOnly` is the one parser
 * that handles this; see the trap note at the top of `lib/domain/date-utils.ts`.
 */
export function formatDateRange(start: string | null, end: string | null): string | null {
  if (!start) return null;
  const format = (value: string) =>
    parseDateOnly(value).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  return end ? `${format(start)} — ${format(end)}` : format(start);
}
