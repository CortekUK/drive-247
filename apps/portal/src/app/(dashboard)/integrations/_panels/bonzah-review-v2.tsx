"use client";

/**
 * Bonzah application — Review & sign, the v2 way (Ghulam, Oct 2 2026:
 * "present this review and signing in a better way").
 *
 * Two screens instead of v1's one long step:
 *   1. Check your application — four summary cards (business, contact,
 *      banking, cover), each with an Edit link straight back to its stage.
 *   2. Sign and send — the three declarations as one tidy list, the
 *      signature pad, and the terms.
 *
 * Reads and writes the SAME react-hook-form fields v1's `Step8Review` does
 * (`declare_*`, `signature_data_url`, `agree_user_agreement`), so the draft,
 * the validation and the submission are unchanged. v1's file is not touched;
 * its `SignaturePad` is reused as-is.
 */

import { useFormContext } from "react-hook-form";
import { Check, PenLine } from "lucide-react";

import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui-v2/checkbox";
import { SignaturePad } from "@/components/settings/bonzah-onboarding/signature-pad";
import type { BonzahOnboardingFormData, FileUrls } from "@/components/settings/bonzah-onboarding/schema";
import { BONZAH_LINKS } from "@/lib/bonzah-compliance";

type Form = BonzahOnboardingFormData;

/** `minor` rows step aside on short screens, so the four cards never clip. */
function Row({ label, value, minor }: { label: string; value: React.ReactNode; minor?: boolean }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4 py-1", minor && "[@media(max-height:760px)]:hidden")}>
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right text-[13px] text-foreground">
        {value || <span className="text-muted-foreground/60">Not given</span>}
      </span>
    </div>
  );
}

function SummaryCard({
  title,
  onEdit,
  children,
}: {
  title: string;
  onEdit: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col rounded-2xl border bg-card px-4 py-3">
      <div className="mb-1 flex items-center justify-between">
        <h4 className="text-sm font-medium text-foreground">{title}</h4>
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex items-center gap-1 text-xs text-primary underline-offset-4 hover:underline dark:text-[hsl(var(--v2-link,var(--primary)))]"
        >
          <PenLine className="size-3" />
          Edit
        </button>
      </div>
      <div className="divide-y divide-border/60">{children}</div>
    </div>
  );
}

/** Screen 1 — what is about to be sent. */
export function BonzahReviewV2({
  fileUrls,
  onEdit,
}: {
  fileUrls: FileUrls;
  /** Jump back to a stage: 0 business, 1 people & payment, 2 cover. */
  onEdit: (stage: number) => void;
}) {
  const v = useFormContext<Form>().watch();
  const files = Object.values(fileUrls).reduce((n, arr) => n + (arr?.length ?? 0), 0);
  const name = `${v.primary_first_name || ""} ${v.primary_last_name || ""}`.trim();
  const drivers = v.additional_users?.length ?? 0;

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden [justify-content:safe_center]">
      <div className="space-y-1 text-center">
        <h3 className="text-lg font-medium text-foreground">Check your application.</h3>
        <p className="text-sm text-muted-foreground [@media(max-height:700px)]:hidden">This is what Bonzah will see. Anything wrong? Edit it before you sign.</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <SummaryCard title="Your business" onEdit={() => onEdit(0)}>
          <Row label="Trade name" value={v.business_trade_name} />
          <Row label="Legal name" value={v.business_legal_name} />
          <Row label="EIN" value={v.ein} />
          <Row minor label="Phone" value={v.business_phone} />
        </SummaryCard>
        <SummaryCard title="Main contact" onEdit={() => onEdit(1)}>
          <Row label="Name" value={name} />
          <Row label="Email" value={v.primary_email} />
          <Row label="Phone" value={v.primary_phone} />
          <Row minor label="Other drivers" value={drivers ? String(drivers) : "None"} />
        </SummaryCard>
        <SummaryCard title="Banking & card" onEdit={() => onEdit(1)}>
          <Row label="Bank" value={v.bank_name} />
          <Row label="Account type" value={v.bank_account_type} />
          <Row label="Account holder" value={v.bank_account_name} />
          <Row minor label="Card" value={v.card_name ? "On file" : ""} />
        </SummaryCard>
        <SummaryCard title="Your cover" onEdit={() => onEdit(2)}>
          <Row label="Current carrier" value={v.current_insurance_carrier} />
          <Row label="Documents" value={files ? `${files} uploaded` : ""} />
          <Row label="GPS tracking" value={v.vehicles_have_gps} />
          <Row minor label="Minimum renter age" value={v.minimum_age_renters} />
        </SummaryCard>
      </div>
    </div>
  );
}

const DECLARATIONS: { name: "declare_complete_accurate" | "declare_authorized" | "declare_authorize_bonzah"; text: string }[] = [
  { name: "declare_complete_accurate", text: "Everything on this application is complete, true and accurate." },
  { name: "declare_authorized", text: "I'm authorized to submit it for my business." },
  { name: "declare_authorize_bonzah", text: "Bonzah may ask anyone for further information it needs." },
];

/** Screen 2 — the declarations, the signature, the terms. */
export function BonzahSignV2() {
  const form = useFormContext<Form>();
  const v = form.watch();
  const errors = form.formState.errors;
  const set = (name: keyof Form, value: unknown) =>
    form.setValue(name, value as never, { shouldDirty: true, shouldTouch: true, shouldValidate: !!errors[name] });

  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col gap-3 overflow-hidden [justify-content:safe_center]">
      <div className="space-y-1 text-center">
        <h3 className="text-lg font-medium text-foreground">Sign and send.</h3>
        <p className="text-sm text-muted-foreground">Confirm the three points below, then sign with your mouse or finger.</p>
      </div>

      <div className="divide-y rounded-2xl border bg-card">
        {DECLARATIONS.map((d) => {
          const on = v[d.name] === true;
          return (
            <label key={d.name} className="flex cursor-pointer items-center gap-3 px-4 py-2.5">
              <Checkbox checked={on} onCheckedChange={(c) => set(d.name, c === true)} />
              <span className={cn("text-sm", errors[d.name] && !on ? "text-destructive" : "text-foreground")}>{d.text}</span>
              {on && <Check className="ml-auto size-4 shrink-0 text-success" />}
            </label>
          );
        })}
      </div>

      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between px-1">
          <span className="text-xs font-medium text-muted-foreground">Your signature</span>
          {errors.signature_data_url && !v.signature_data_url && (
            <span className="text-xs text-destructive">Please sign in the box</span>
          )}
        </div>
        <div className="[&_canvas]:rounded-2xl [&_canvas]:bg-card [&>div>div:first-child]:rounded-2xl">
          <SignaturePad value={v.signature_data_url} onChange={(val) => set("signature_data_url", val)} height={96} />
        </div>
      </div>

      <label className="flex cursor-pointer items-center gap-3 px-1">
        <Checkbox checked={v.agree_user_agreement === true} onCheckedChange={(c) => set("agree_user_agreement", c === true)} />
        <span className={cn("text-sm", errors.agree_user_agreement && !v.agree_user_agreement ? "text-destructive" : "text-muted-foreground")}>
          I agree to Bonzah&rsquo;s{" "}
          <a
            href={BONZAH_LINKS.businessPartnerTerms}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline-offset-4 hover:underline dark:text-[hsl(var(--v2-link,var(--primary)))]"
          >
            Business Partner Terms
          </a>
          .
        </span>
      </label>
    </div>
  );
}
