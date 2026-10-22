"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Elements, PaymentElement } from "@stripe/react-stripe-js";
import type { Appearance } from "@stripe/stripe-js";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Loader2,
  Lock,
  RotateCw,
} from "lucide-react-nw";
import Link from "next/link";
import { useEffect } from "react";

import {
  describeElementLoadError,
  FAILURE_TITLES,
  LOAD_ERROR_COPY,
  outcomeDocumentsHref,
  useCardFormController,
  usePaymentPanelController,
  type BookingPaymentRequest,
  type PaymentOutcome,
  type PaymentPanelCopy,
  type PaymentReturn,
} from "@nw/components/booking/payment-panel-logic";
import { Button } from "@nw/components/ui/button";
import { Dialog } from "@nw/components/ui/dialog";
import type { BookingPaymentIntentResponse } from "@nw/hooks/use-payment-intent";
import { cn } from "@nw/lib/utils";
import { PvDialogContent } from "@nw/portal-v2/dialog";

/**
 * The card form, IN OUR PAGE — v2.
 *
 * Same exports and props as v1's `components/booking/payment-panel.tsx`. The
 * whole state machine — minting the intent, the 3-D Secure stash and resume,
 * confirming in-page, the outcome — is v1's, called through
 * `payment-panel-logic.ts`; only the dialog is redrawn: the v2 `PvDialogContent`
 * surface, calm sections, a Stripe field that matches the kit's `FIELD`, and a
 * brand pill pay button. See v1's header for why this is a modal at all, and
 * for the one case where Stripe does leave the page.
 */

export {
  bookingDocumentsHref,
  readPaymentReturn,
  type BookingPaymentRequest,
  type PaymentOutcome,
  type PaymentPanelCopy,
  type PaymentReturn,
} from "@nw/components/booking/payment-panel-logic";

/* ───────────────────────── the Stripe field, in v2 ───────────────────────── */

/**
 * Resolve a `--pv-*` colour to `rgb(...)` by painting it on a probe.
 *
 * The v2 tokens are `hsl()` expressions built from other custom properties, so
 * reading the raw property returns an unresolved string Stripe would reject.
 * Painting it as `color` on an element inside `.pv2-tokens` (the shell puts
 * that on <body>) and reading the computed colour back yields a literal the
 * Appearance API accepts.
 */
export function resolvePvColours(names: readonly string[]): Record<string, string> | null {
  if (typeof document === "undefined") return null;
  const host = document.querySelector(".pv2") ?? document.body;
  const probe = document.createElement("span");
  probe.style.display = "none";
  host.appendChild(probe);
  const out: Record<string, string> = {};
  try {
    for (const name of names) {
      probe.style.color = "";
      probe.style.color = `var(${name})`;
      const value = window.getComputedStyle(probe).color;
      if (value === "") return null;
      out[name] = value;
    }
  } finally {
    probe.remove();
  }
  return out;
}

const PV_COLOURS = [
  "--pv-primary",
  "--pv-fg",
  "--pv-muted-fg",
  "--pv-border",
  "--pv-bg",
  "--pv-tint",
  "--pv-danger",
] as const;

const V2_FONT_STACK = "Manrope, system-ui, -apple-system, sans-serif";

/** Manrope for the iframe — `next/font`'s self-hosted copy cannot reach it. */
export const V2_ELEMENTS_FONTS = [
  { cssSrc: "https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&display=swap" },
] as const;

/**
 * The Payment Element painted like the kit's `FIELD`: 44px, 10px radius, a 1px
 * `pv-border` rim, and the accent rim plus a soft ring on focus. Module-level,
 * so the controller's memo sees one stable reference.
 */
export function buildSiteV2Appearance(): Appearance {
  const c = resolvePvColours(PV_COLOURS);
  const base: Appearance = {
    theme: "stripe",
    variables: { fontFamily: V2_FONT_STACK, fontSizeBase: "14px", borderRadius: "10px" },
  };
  if (c === null) return base;

  const primary = c["--pv-primary"];
  const ring = primary.replace(/^rgb\((.*)\)$/, "rgba($1, 0.15)");

  return {
    theme: "stripe",
    variables: {
      fontFamily: V2_FONT_STACK,
      fontSizeBase: "14px",
      fontWeightNormal: "400",
      fontWeightMedium: "500",
      fontWeightBold: "600",
      colorPrimary: primary,
      colorBackground: c["--pv-bg"],
      colorText: c["--pv-fg"],
      colorTextSecondary: c["--pv-muted-fg"],
      colorTextPlaceholder: c["--pv-muted-fg"],
      colorDanger: c["--pv-danger"],
      colorIcon: c["--pv-muted-fg"],
      colorIconTab: c["--pv-muted-fg"],
      colorIconTabSelected: primary,
      borderRadius: "10px",
      spacingUnit: "4px",
      focusBoxShadow: `0 0 0 3px ${ring}`,
      focusOutline: "none",
    },
    rules: {
      ".Input": {
        border: `1px solid ${c["--pv-border"]}`,
        boxShadow: "none",
        padding: "12px",
        fontSize: "14px",
        lineHeight: "20px",
      },
      ".Input:focus": {
        borderColor: primary,
        boxShadow: `0 0 0 3px ${ring}`,
        outline: "none",
      },
      ".Input--invalid": { borderColor: c["--pv-danger"], boxShadow: "none" },
      ".Label": {
        fontSize: "12px",
        fontWeight: "500",
        color: c["--pv-muted-fg"],
        marginBottom: "6px",
      },
      ".Error": { fontSize: "12px", lineHeight: "16px", color: c["--pv-danger"], marginTop: "6px" },
      ".Tab": {
        border: `1px solid ${c["--pv-border"]}`,
        boxShadow: "none",
        color: c["--pv-muted-fg"],
        padding: "12px",
      },
      ".Tab:hover": { backgroundColor: c["--pv-tint"], color: c["--pv-fg"] },
      ".Tab--selected": {
        border: `1px solid ${primary}`,
        backgroundColor: c["--pv-tint"],
        boxShadow: "none",
        color: c["--pv-fg"],
      },
      ".TabLabel": { fontSize: "12px", fontWeight: "600" },
      ".CheckboxInput": { borderColor: c["--pv-border"] },
      ".CheckboxInput--checked": { backgroundColor: primary, borderColor: primary },
    },
  };
}

/* ──────────────────────────────── the panel ──────────────────────────────── */

export interface PaymentPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Everything the server needs to price the charge. Ignored when `prepared` is set. */
  request: BookingPaymentRequest | null;
  /** An intent the CALLER already minted, mounted straight into `<Elements>`. */
  prepared?: BookingPaymentIntentResponse | null;
  /** `rentals.id`, stashed for a 3-D Secure return. Supply it alongside `prepared`. */
  rentalId?: string | null;
  /** Already formatted, e.g. "$1,215.00" — used only until the intent lands. */
  amountLabel: string;
  /** "2021 Chevrolet Camaro" — so the dialog says what is being paid for. */
  vehicleLabel: string;
  /** Non-null when this mount is a return from a Stripe redirect. */
  resume: PaymentReturn | null;
  /** Overrides merged over the booking wording. See `PaymentPanelCopy`. */
  copy?: Partial<PaymentPanelCopy>;
  /** Rendered inside the success view, above the close button. */
  outcomeFooter?: React.ReactNode;
  onSucceeded?: (outcome: PaymentOutcome) => void;
}

export function PaymentPanel({
  open,
  onOpenChange,
  request,
  prepared = null,
  rentalId = null,
  amountLabel,
  vehicleLabel,
  resume,
  copy,
  outcomeFooter,
  onSucceeded,
}: PaymentPanelProps) {
  const {
    state,
    outcome,
    loadError,
    setLoadError,
    handleOutcome,
    intent,
    paidRentalId,
    text,
    stripePromise,
    elementsOptions,
    retryAfterLoadError,
    retryAfterMintFailure,
  } = usePaymentPanelController({
    open,
    request,
    prepared,
    rentalId,
    resume,
    copy,
    onSucceeded,
    buildAppearance: buildSiteV2Appearance,
    elementsFonts: V2_ELEMENTS_FONTS,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/*
        The body is the only thing that scrolls; the header stays put. 16px of
        side padding on a phone keeps the Payment Element above the width where
        Stripe's own layout starts stacking. Outside clicks are ignored — a
        half-typed card must not vanish on a stray tap.
      */}
      <PvDialogContent variant="site"
        showCloseButton={false}
        className="max-h-[calc(100svh-1.5rem)] w-[calc(100%-1.5rem)] max-w-[460px] gap-0 overflow-hidden p-0 sm:max-h-[calc(100svh-4rem)] sm:max-w-[460px] sm:p-0"
        onInteractOutside={(event) => event.preventDefault()}
      >
        <PanelHeader vehicleLabel={vehicleLabel} title={text.title} />

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-5 sm:px-6 sm:pb-6">
          {outcome !== null ? (
            <OutcomeView
              outcome={outcome}
              text={text}
              footer={outcomeFooter}
              onClose={() => onOpenChange(false)}
            />
          ) : loadError !== null ? (
            <FailureView
              title={LOAD_ERROR_COPY.title}
              message={LOAD_ERROR_COPY.message}
              detail={loadError}
              cancelLabel={text.cancelLabel}
              onRetry={retryAfterLoadError}
              onClose={() => onOpenChange(false)}
            />
          ) : state.status === "creating" ? (
            <BusyView label="Preparing a secure form…" />
          ) : state.status === "failed" ? (
            <FailureView
              title={FAILURE_TITLES[state.failure.kind]}
              message={state.failure.message}
              detail={state.failure.detail}
              cancelLabel={text.cancelLabel}
              onRetry={retryAfterMintFailure}
              onClose={() => onOpenChange(false)}
            />
          ) : intent !== null && stripePromise !== null && elementsOptions !== null ? (
            <Elements
              key={intent.clientSecret}
              stripe={stripePromise}
              options={elementsOptions}
            >
              <CardForm
                intent={intent}
                rentalId={paidRentalId}
                amountLabel={amountLabel}
                text={text}
                isResume={resume !== null}
                onOutcome={handleOutcome}
                onLoadError={setLoadError}
                onCancel={() => onOpenChange(false)}
              />
            </Elements>
          ) : (
            <BusyView label="Preparing a secure form…" />
          )}
        </div>
      </PvDialogContent>
    </Dialog>
  );
}

/* ─────────────────────────────── the header ──────────────────────────────── */

/**
 * The title, what is being paid for, and a quiet "Secure" chip. No brand link
 * here on purpose: a one-tap route off a half-finished payment is a trap.
 */
function PanelHeader({ vehicleLabel, title }: { vehicleLabel: string; title: string }) {
  return (
    <div className="flex items-start justify-between gap-3 px-4 pt-5 pb-4 sm:px-6 sm:pt-6">
      <div className="min-w-0">
        <DialogPrimitive.Title className="text-[19px] font-bold tracking-[-0.02em] text-pv-fg">
          {title}
        </DialogPrimitive.Title>
        <DialogPrimitive.Description className="mt-0.5 truncate text-[13px] text-pv-muted-fg">
          {vehicleLabel}
        </DialogPrimitive.Description>
      </div>
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-pv-success-light px-2.5 py-1 text-[11px] font-medium text-pv-success">
        <Lock aria-hidden strokeWidth={2} className="size-3" />
        Secure
      </span>
    </div>
  );
}

/* ──────────────────────────────── the form ───────────────────────────────── */

function CardForm({
  intent,
  rentalId,
  amountLabel,
  text,
  isResume,
  onOutcome,
  onLoadError,
  onCancel,
}: {
  intent: BookingPaymentIntentResponse;
  rentalId: string | null;
  amountLabel: string;
  text: PaymentPanelCopy;
  isResume: boolean;
  onOutcome: (outcome: PaymentOutcome) => void;
  onLoadError: (detail: string) => void;
  onCancel: () => void;
}) {
  const {
    setCardComplete,
    cardComplete,
    processing,
    error,
    checkingReturn,
    handleSubmit,
    ready,
    payLabel,
  } = useCardFormController({
    intent,
    rentalId,
    amountLabel,
    isResume,
    onOutcome,
  });

  if (checkingReturn) {
    return <BusyView label="Checking that payment…" />;
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* The amount, stated once before the card fields. */}
      <div className="flex items-baseline justify-between gap-3 rounded-xl bg-pv-muted px-4 py-3">
        <span className="text-[13px] font-medium text-pv-muted-fg">To pay now</span>
        <span className="text-lg font-bold tracking-[-0.02em] tabular-nums text-pv-fg">
          {payLabel}
        </span>
      </div>

      <div className="relative min-h-[132px]">
        <PaymentElement
          options={{ layout: "tabs" }}
          onChange={(event) => setCardComplete(event.complete)}
          onLoadError={(event) => onLoadError(describeElementLoadError(event.error))}
        />
        {!ready ? (
          <div className="absolute inset-0 grid place-items-center">
            <Loader2 aria-hidden className="size-5 animate-spin text-pv-muted-fg motion-reduce:animate-none" />
          </div>
        ) : null}
      </div>

      {/*
        OFF-SESSION MANDATE — required at the point the card is entered (see v1).
        The words are the shared `text.mandate`.
      */}
      <p className="rounded-xl border border-pv-border px-3.5 py-3 text-xs leading-relaxed text-pv-muted-fg">
        By paying you authorise{" "}
        <strong className="font-semibold text-pv-fg">Drive247</strong>{" "}
        {text.mandate}
      </p>

      {error !== null ? (
        <p
          role="alert"
          className="flex items-start gap-2.5 rounded-xl bg-pv-danger-light px-3.5 py-3 text-xs leading-relaxed text-pv-fg"
        >
          <AlertTriangle
            aria-hidden
            strokeWidth={1.75}
            className="mt-px size-3.5 shrink-0 text-pv-danger"
          />
          <span>{error}</span>
        </p>
      ) : null}

      <div className="space-y-2 pt-1">
        <Button
          type="submit"
          variant="brand"
          size="lg"
          className="h-12 w-full text-[15px]"
          disabled={!ready || !cardComplete || processing}
        >
          {processing ? (
            <>
              <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" />
              Processing…
            </>
          ) : (
            <>
              <Lock aria-hidden strokeWidth={2} />
              Pay {payLabel}
            </>
          )}
        </Button>

        <Button
          type="button"
          variant="brand-ghost"
          size="lg"
          className="h-11 w-full"
          disabled={processing}
          onClick={onCancel}
        >
          {text.cancelLabel}
        </Button>
      </div>

      {/* Stripe attribution, required when the card fields are embedded. */}
      <p className="flex items-center justify-center gap-1.5 text-[11px] leading-4 text-pv-muted-fg">
        <Lock aria-hidden strokeWidth={2} className="size-3" />
        Powered by Stripe · your card details never touch our servers
      </p>
    </form>
  );
}

/* ─────────────────────────────── the states ──────────────────────────────── */

function BusyView({ label }: { label: string }) {
  return (
    <div role="status" className="flex flex-col items-center gap-3 py-14">
      <span className="grid size-12 place-items-center rounded-2xl bg-pv-tint text-pv-primary">
        <Loader2 aria-hidden className="size-5 animate-spin motion-reduce:animate-none" />
      </span>
      <p className="text-sm text-pv-muted-fg">{label}</p>
    </div>
  );
}

function StateIcon({
  tone,
  children,
}: {
  tone: "success" | "warning" | "primary";
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "grid size-12 place-items-center rounded-2xl",
        tone === "success" && "bg-pv-success-light text-pv-success",
        tone === "warning" && "bg-pv-warning-light text-pv-warning",
        tone === "primary" && "bg-pv-tint text-pv-primary",
      )}
    >
      {children}
    </span>
  );
}

function FailureView({
  title,
  message,
  detail,
  cancelLabel,
  onRetry,
  onClose,
}: {
  title: string;
  message: string;
  /** Engineering detail. Logged, never rendered. */
  detail: string | null;
  cancelLabel: string;
  onRetry: (() => void) | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (detail !== null) console.warn(`[payment] ${detail}`);
  }, [detail]);

  return (
    <div className="pt-2">
      <div className="flex flex-col items-center text-center">
        <StateIcon tone="warning">
          <AlertTriangle aria-hidden strokeWidth={1.75} className="size-5" />
        </StateIcon>
        <h3 className="mt-4 text-[15px] font-semibold text-pv-fg">{title}</h3>
        <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-pv-muted-fg">
          {message}
        </p>
      </div>

      <div className="mt-6 space-y-2">
        {onRetry !== null ? (
          <Button type="button" variant="brand" size="lg" className="h-12 w-full" onClick={onRetry}>
            <RotateCw strokeWidth={2} />
            Try again
          </Button>
        ) : null}
        <Button
          type="button"
          variant={onRetry === null ? "brand" : "brand-ghost"}
          size="lg"
          className={cn("w-full", onRetry === null ? "h-12" : "h-11")}
          onClick={onClose}
        >
          {cancelLabel}
        </Button>
      </div>
    </div>
  );
}

function OutcomeView({
  outcome,
  text,
  footer,
  onClose,
}: {
  outcome: PaymentOutcome;
  text: PaymentPanelCopy;
  footer: React.ReactNode;
  onClose: () => void;
}) {
  const succeeded = outcome.kind === "succeeded";
  /** See `outcomeDocumentsHref` for why this is succeeded-only and token-gated. */
  const documentsHref = outcomeDocumentsHref(outcome);

  return (
    <div className="pv2-enter pt-2">
      <div className="flex flex-col items-center text-center">
        <StateIcon tone={succeeded ? "success" : "primary"}>
          {succeeded ? (
            <CheckCircle2 aria-hidden strokeWidth={1.75} className="size-5" />
          ) : (
            <Clock aria-hidden strokeWidth={1.75} className="size-5" />
          )}
        </StateIcon>

        <h3 className="mt-4 text-[15px] font-semibold text-pv-fg">
          {succeeded ? text.succeededTitle : text.processingTitle}
        </h3>
        <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-pv-muted-fg">
          {succeeded ? text.succeededBody : text.processingBody}
        </p>

        {outcome.rentalNumber !== null ? (
          <p className="mt-4 rounded-full bg-pv-muted px-3 py-1 text-xs font-medium text-pv-muted-fg">
            {text.referencePrefix} {outcome.rentalNumber}
          </p>
        ) : null}
      </div>

      {footer !== undefined && footer !== null ? <div className="mt-5">{footer}</div> : null}

      {documentsHref !== null ? (
        <div className="mt-6 space-y-2">
          {/* The upload is the PRIMARY action — the booking is not finished yet. */}
          <Button asChild variant="brand" size="lg" className="h-12 w-full">
            <Link href={documentsHref}>
              {text.documentsCtaLabel}
              <ArrowRight aria-hidden strokeWidth={2} />
            </Link>
          </Button>
          <Button
            type="button"
            variant="brand-ghost"
            size="lg"
            className="h-11 w-full"
            onClick={onClose}
          >
            {text.documentsDeferLabel}
          </Button>
        </div>
      ) : (
        <Button type="button" variant="brand" size="lg" className="mt-6 h-12 w-full" onClick={onClose}>
          {text.doneLabel}
        </Button>
      )}
    </div>
  );
}
