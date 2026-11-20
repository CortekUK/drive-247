"use client";

/**
 * The customer's own insurance on the Insurance stage (QA R7, Nov 14 2026).
 *
 * A certificate reaches a rental two ways, and until this file only one of them
 * showed here:
 *
 *   customer  uploaded in the customer portal (Insurances) → `customer_documents`,
 *             read by `scan-insurance-document` (AI fields in `ai_extracted_data`)
 *   staff     uploaded on this stage → `insurance_verifications`, read by
 *             `verify-insurance-document` (`extracted_fields`, `ai_findings`)
 *
 * The customer's upload was invisible on the rental: staff saw "Drop in the
 * customer's certificate" over a certificate already sitting in the database.
 *
 * Both are listed here, newest first; the newest is the one that counts
 * ("Latest"). Neither AI check knows the rental, so the rental checks are made
 * here, against what the AI read off the document (falling back to what the
 * customer typed):
 *
 *   expired               cover ended before today          → does not pass
 *   ends before the hire  cover ends before the return day  → does not pass
 *   starts after pickup   cover starts after the pickup day → needs a look
 *   another name          holder is not the renter          → does not pass
 *
 * What the customer typed is compared with what was read, so a typo or a
 * mismatch between the form and the document is visible too.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check, Loader2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import type { InsuranceVerification } from "@/hooks/use-insurance-verifications";
import { fmtDate, listCls } from "./_kit";

type Issue = { tone: "bad" | "warn"; text: string };

export type OwnCert = {
  id: string;
  source: "customer" | "staff";
  at: string;
  fileName: string;
  href: string | null;
  reading: boolean;
  failed: boolean;
  read: { insurer: string | null; policy: string | null; holder: string | null; from: string | null; to: string | null };
  typed: { insurer: string | null; policy: string | null; from: string | null; to: string | null } | null;
  /** The AI's own notes: review reasons or flags. */
  notes: string[];
  /** The AI says this is not an insurance document at all. */
  notInsurance: boolean;
  staffVerified: boolean;
};

const BUCKET = "customer-documents";
const day = (d: string | null | undefined) => (d ? String(d).slice(0, 10) : null);

/** The customer's insurance certificates for this rental (not another rental's). */
export function useCustomerInsuranceDocs(customerId: string | null | undefined, rentalId: string) {
  return useQuery({
    queryKey: ["rental-own-insurance", customerId, rentalId],
    enabled: !!customerId,
    queryFn: async (): Promise<OwnCert[]> => {
      const { data, error } = await (supabase as any)
        .from("customer_documents")
        .select(
          "id, created_at, file_url, file_name, insurance_provider, policy_number, start_date, end_date, ai_scan_status, ai_extracted_data, verified, rental_id, extension_id"
        )
        .eq("customer_id", customerId)
        .eq("document_type", "Insurance Certificate")
        .or(`rental_id.is.null,rental_id.eq.${rentalId}`)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const rows = (data ?? []) as any[];
      // Signed links up front, so "Open" is a plain link — it keeps working for
      // read-only roles, whose stage sits inside a disabled fieldset.
      const paths = rows.map((r) => r.file_url).filter((u: string) => u && !/^https?:/.test(u));
      const signed: Record<string, string> = {};
      if (paths.length) {
        const { data: s } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 3600);
        for (const x of s ?? []) if (x.path && x.signedUrl) signed[x.path] = x.signedUrl;
      }
      return rows.map((r) => {
        const ai = (r.ai_extracted_data ?? {}) as Record<string, any>;
        const st = String(r.ai_scan_status ?? "pending");
        return {
          id: r.id,
          source: "customer" as const,
          at: r.created_at,
          fileName: r.file_name ?? "Insurance certificate",
          href: /^https?:/.test(r.file_url ?? "") ? r.file_url : (signed[r.file_url] ?? null),
          reading: st === "pending" || st === "processing",
          failed: st === "failed" || !!ai.error,
          read: {
            insurer: ai.provider ?? null,
            policy: ai.policyNumber ?? null,
            holder: ai.policyHolderName ?? null,
            from: day(ai.effectiveDate),
            to: day(ai.expirationDate),
          },
          typed: {
            insurer: r.insurance_provider ?? null,
            policy: r.policy_number ?? null,
            from: day(r.start_date),
            to: day(r.end_date),
          },
          notes: Array.isArray(ai.reviewReasons) ? ai.reviewReasons.map(String) : [],
          notInsurance: ai.isValidDocument === false,
          staffVerified: r.verified === true,
        };
      });
    },
    // While the AI is still reading one, look again every few seconds.
    refetchInterval: (q) => ((q.state.data as OwnCert[] | undefined)?.some((c) => c.reading) ? 3000 : false),
  });
}

/** A staff upload (`insurance_verifications`) in the same shape. */
export function fromVerification(v: InsuranceVerification): OwnCert {
  const ex = v.extracted_fields;
  return {
    id: v.id,
    source: "staff",
    at: v.created_at,
    fileName: v.file_name,
    href: v.file_url || null,
    reading: v.status === "pending" || v.status === "processing",
    failed: v.status === "failed",
    read: {
      insurer: ex?.insurer ?? null,
      policy: ex?.policy_number ?? null,
      holder: ex?.policy_holder ?? null,
      from: day(ex?.start_date),
      to: day(ex?.end_date),
    },
    typed: null,
    notes: v.ai_findings?.flags ?? [],
    notInsurance: v.status === "rejected" || v.ai_findings?.is_insurance_document === false,
    staffVerified: false,
  };
}

const words = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1);

/** Same person? Every word of the shorter name appears in the longer one. */
export function sameName(a: string, b: string): boolean {
  const x = words(a), y = words(b);
  if (!x.length || !y.length) return true; // nothing to compare — not a finding
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.every((w) => long.includes(w));
}

/** The rental checks — the part neither AI check can do. */
export function checkCert(
  c: OwnCert,
  rental: { start: string | null; end: string | null },
  renter: string | null,
  today: string
): Issue[] {
  if (c.reading) return [];
  const out: Issue[] = [];
  if (c.failed) out.push({ tone: "warn", text: "Trax could not read this document. Check it by hand." });
  if (c.notInsurance) out.push({ tone: "bad", text: "Trax says this is not an insurance certificate." });
  const from = c.read.from ?? c.typed?.from ?? null;
  const to = c.read.to ?? c.typed?.to ?? null;
  if (to && to < today) out.push({ tone: "bad", text: `Expired on ${fmtDate(to)}.` });
  if (to && rental.start && to < rental.start)
    out.push({ tone: "bad", text: `Cover ends ${fmtDate(to)}, before the rental starts on ${fmtDate(rental.start)}. No day of the hire is covered.` });
  else if (to && rental.end && to < rental.end)
    out.push({ tone: "bad", text: `Cover ends ${fmtDate(to)}, before the rental ends on ${fmtDate(rental.end)}.` });
  if (from && rental.start && from > rental.start)
    out.push({ tone: "warn", text: `Cover starts ${fmtDate(from)}, after the pickup on ${fmtDate(rental.start)}.` });
  if (!to && !c.failed) out.push({ tone: "warn", text: "No end date could be read, so the dates are not checked." });
  if (c.read.holder && renter && !sameName(c.read.holder, renter))
    out.push({ tone: "bad", text: `In another name: ${c.read.holder}. The renter is ${renter}.` });
  // What the customer typed against what the document says.
  if (c.typed) {
    const diff: string[] = [];
    if (c.typed.policy && c.read.policy && c.typed.policy.replace(/\s/g, "") !== c.read.policy.replace(/\s/g, ""))
      diff.push(`policy ${c.typed.policy} (document: ${c.read.policy})`);
    if (c.typed.from && c.read.from && c.typed.from !== c.read.from)
      diff.push(`start ${fmtDate(c.typed.from)} (document: ${fmtDate(c.read.from)})`);
    if (c.typed.to && c.read.to && c.typed.to !== c.read.to)
      diff.push(`end ${fmtDate(c.typed.to)} (document: ${fmtDate(c.read.to)})`);
    if (diff.length) out.push({ tone: "warn", text: `The customer typed ${diff.join(", ")}.` });
  }
  return out;
}

export function OwnInsuranceList({
  certs,
  rental,
  renter,
}: {
  certs: OwnCert[];
  rental: { start: string | null; end: string | null };
  renter: string | null;
}) {
  const today = useMemo(() => new Date().toLocaleDateString("en-CA"), []);
  return (
    <div className={listCls}>
      {certs.map((c, i) => {
        const issues = checkCert(c, rental, renter, today);
        const bad = issues.some((x) => x.tone === "bad");
        const warn = !bad && issues.length > 0;
        const latest = i === 0;
        const read = [
          c.read.insurer,
          c.read.policy,
          c.read.holder,
          c.read.from || c.read.to ? `${fmtDate(c.read.from)} → ${fmtDate(c.read.to)}` : null,
        ].filter(Boolean);
        return (
          <div key={`${c.source}-${c.id}`} className={cn("space-y-1.5 px-5 py-3.5", !latest && "opacity-70")}>
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="flex min-w-0 items-center gap-2 text-sm font-medium">
                  {c.href ? (
                    <a href={c.href} target="_blank" rel="noreferrer" className="truncate underline-offset-2 hover:underline">
                      {c.read.insurer || c.fileName}
                    </a>
                  ) : (
                    <span className="truncate">{c.read.insurer || c.fileName}</span>
                  )}
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {latest ? "Latest" : "Earlier"} · {c.source === "customer" ? "from the customer" : "uploaded here"} ·{" "}
                    {fmtDate(c.at)}
                  </span>
                </p>
              </div>
              <span
                className={cn(
                  "flex shrink-0 items-center gap-1.5 text-xs font-medium",
                  c.reading ? "text-muted-foreground" : bad ? "text-destructive" : warn ? "text-warning" : "text-success"
                )}
              >
                {c.reading ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : bad ? (
                  <X className="size-3.5" />
                ) : warn ? (
                  <AlertTriangle className="size-3.5" />
                ) : (
                  <Check className="size-3.5" />
                )}
                {c.reading ? "Checking…" : bad ? "Does not pass" : warn ? "Needs a look" : "Covers this rental"}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {c.reading
                ? "Trax is reading the document…"
                : read.length
                  ? <>Read from the document: <span className="text-foreground">{read.join(" · ")}</span></>
                  : "Nothing could be read off the document."}
            </p>
            {issues.map((x) => (
              <p
                key={x.text}
                className={cn(
                  "flex items-start gap-1.5 text-xs font-medium",
                  x.tone === "bad" ? "text-destructive" : "text-warning"
                )}
              >
                <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                {x.text}
              </p>
            ))}
            {!c.reading && c.notes.length > 0 && (
              <p className="text-[11px] text-muted-foreground">Trax noted: {c.notes.join(" · ")}</p>
            )}
            {c.staffVerified && <p className="text-[11px] text-success">Marked verified by your team.</p>}
          </div>
        );
      })}
    </div>
  );
}
