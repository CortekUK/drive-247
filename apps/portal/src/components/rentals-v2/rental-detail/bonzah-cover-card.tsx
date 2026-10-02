"use client";

/**
 * The Bonzah card on the Insurance stage — pick the cover, see what it costs,
 * open the documents.
 *
 * Bonzah sells four covers, each priced per day of the hire:
 *
 *   CDW   Collision Damage Waiver        damage to, or theft of, the rental car
 *   RCLI  Rental Car Liability           injury and damage to other people
 *   SLI   Supplemental Liability         raises the liability limit
 *   PAI   Personal Accident              the renter's own medical cover
 *
 * TWO MODES, decided by whether Bonzah can actually sell for this account:
 *
 *   live   connected and sellable — changing the cover opens the real Bonzah
 *          purchase dialog, and documents are the policy's own PDFs fetched
 *          through `bonzah-download-pdf`.
 *   demo   not connected (Ghulam, Oct 2 2026: northwind stays "not integrated"
 *          for the demo, "just mock it out") — selecting, re-quoting and the
 *          documents all work on screen, nothing is sent to Bonzah and nothing
 *          is written. The card says DEMO so it can never pass for real cover.
 *
 * The per-day rates in demo are illustrative only.
 */

import { useMemo, useState } from "react";
import { Check, Download, FileText, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui-v2/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui-v2/dialog";
import type { InsurancePolicy } from "@/hooks/use-rental-insurance-policies";
import { fmtDate, insetCls, money, Surface } from "./_kit";

type Key = "cdw" | "rcli" | "sli" | "pai";

const COVERS: { key: Key; short: string; name: string; what: string; perDay: number }[] = [
  { key: "cdw", short: "CDW", name: "Collision Damage Waiver", what: "Damage to, or theft of, the rental car", perDay: 14.95 },
  { key: "rcli", short: "RCLI", name: "Rental Car Liability", what: "Injury and damage to other people", perDay: 7.95 },
  { key: "sli", short: "SLI", name: "Supplemental Liability", what: "Raises the liability limit to $1M", perDay: 9.95 },
  { key: "pai", short: "PAI", name: "Personal Accident", what: "The renter's own medical costs", perDay: 4.95 },
];

const picked = (ct: Record<string, unknown> | null | undefined) =>
  new Set<Key>((COVERS.map((c) => c.key) as Key[]).filter((k) => !!ct?.[k]));

export function BonzahCoverCard({
  policy,
  covered,
  live,
  sandbox,
  days,
  rentalStart,
  rentalEnd,
  customerName,
  tenantId,
  emptyNote,
  statusChip,
  gapDays,
  onRequote,
}: {
  policy: InsurancePolicy | null;
  covered: boolean;
  /** Bonzah can really sell for this account. False → demo mode. */
  live: boolean;
  sandbox: boolean;
  days: number;
  rentalStart: string | null;
  rentalEnd: string | null;
  customerName: string;
  tenantId: string | undefined;
  emptyNote: string | null;
  statusChip: React.ReactNode;
  gapDays: number | null;
  /** Live mode: open the real Bonzah purchase dialog. */
  onRequote: () => void;
}) {
  const { toast } = useToast();

  /* What is on the policy — or, in demo, on the demo policy once "bought". */
  const [demoPolicy, setDemoPolicy] = useState<{ keys: Set<Key>; at: string } | null>(null);
  const onPolicy = demoPolicy?.keys ?? picked(policy?.coverage_types as never);
  const [selection, setSelection] = useState<Set<Key> | null>(null);
  const sel = selection ?? onPolicy;
  const dirty = selection !== null && [...COVERS].some((c) => sel.has(c.key) !== onPolicy.has(c.key));

  /* Bonzah stores one premium per policy, not a price per cover. So the
     per-cover figures are the illustrative rates scaled to what the policy
     actually cost — the tiles always add up to the premium shown. */
  const baseFor = (keys: Set<Key>) => COVERS.filter((c) => keys.has(c.key)).reduce((s, c) => s + c.perDay * days, 0);
  const policyPremium = Number(policy?.premium_amount ?? 0);
  const factor = !demoPolicy && policyPremium > 0 && baseFor(onPolicy) > 0 ? policyPremium / baseFor(onPolicy) : 1;
  const rate = (c: (typeof COVERS)[number]) => c.perDay * factor;
  const premiumFor = (keys: Set<Key>) => Math.round(baseFor(keys) * factor * 100) / 100;
  const shownPremium = demoPolicy ? premiumFor(demoPolicy.keys) : Number(policy?.premium_amount ?? 0);
  const hasPolicy = !!policy || !!demoPolicy;

  const toggle = (k: Key) => {
    const next = new Set(sel);
    next.has(k) ? next.delete(k) : next.add(k);
    // RCLI is required alongside CDW on a Bonzah policy.
    if (k === "cdw" && next.has("cdw")) next.add("rcli");
    setSelection(next);
  };

  const apply = () => {
    if (live) return onRequote();
    setDemoPolicy({ keys: new Set(sel), at: new Date().toISOString() });
    setSelection(null);
    toast({
      title: hasPolicy ? "Cover updated — demo" : "Cover added — demo",
      description: "Bonzah isn't connected, so nothing was sent to Bonzah or charged.",
    });
  };

  /* ── documents ──────────────────────────────────────────────────────── */
  const [docsOpen, setDocsOpen] = useState(false);
  const [viewing, setViewing] = useState<Key | null>(null);
  const [downloading, setDownloading] = useState<Key | null>(null);
  const pdfIds = ((policy?.coverage_types as any)?.pdf_ids ?? {}) as Record<string, number | string>;

  const download = async (k: Key) => {
    if (!policy?.policy_id || !pdfIds[k] || !tenantId) return;
    setDownloading(k);
    try {
      const { data, error } = await supabase.functions.invoke("bonzah-download-pdf", {
        body: { tenant_id: tenantId, pdf_id: String(pdfIds[k]), policy_id: policy.policy_id },
      });
      if (error || !data?.documentBase64) throw new Error("Bonzah did not return the document.");
      const bytes = Uint8Array.from(atob(data.documentBase64), (c) => c.charCodeAt(0));
      window.open(URL.createObjectURL(new Blob([bytes], { type: "application/pdf" })), "_blank");
    } catch (e: any) {
      toast({ title: "Could not open it", description: e?.message, variant: "destructive" });
    } finally {
      setDownloading(null);
    }
  };

  const policyNo = policy?.policy_no ?? (demoPolicy ? "DEMO-" + (rentalStart ?? "").replaceAll("-", "") : null);

  return (
    <Surface className="flex flex-none flex-col p-6">
      {/* Who, state, documents. */}
      <div className="flex flex-wrap items-center gap-2.5">
        <h3 className="flex items-center gap-2 font-heading text-sm font-semibold">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/bonzah-logo.svg" alt="Bonzah" className="h-4 w-auto dark:hidden" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/bonzah-logo-dark.svg" alt="Bonzah" className="hidden h-4 w-auto dark:block" />
          cover
        </h3>
        {hasPolicy && statusChip}
        {(!live || (sandbox && hasPolicy)) && (
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {live ? "Sandbox" : "Demo"}
          </span>
        )}
        <span className="flex-1" />
        {hasPolicy && (
          <Button size="sm" variant="ghost" onClick={() => setDocsOpen(true)}>
            <FileText />
            Documents
          </Button>
        )}
      </div>

      {/* The policy at a glance — four facts, one row. */}
      <div className={cn(insetCls, "mt-4 grid grid-cols-2 gap-y-3 px-5 py-4 sm:grid-cols-4")}>
        <Fact label="Policy">{hasPolicy ? <span className="font-mono text-[13px]">{policyNo ?? "—"}</span> : "Not bought yet"}</Fact>
        <Fact label="Covers">
          {fmtDate(policy?.trip_start_date ?? rentalStart)} → {fmtDate(policy?.trip_end_date ?? rentalEnd)}
          {gapDays ? <span className="block text-xs text-warning">{gapDays} days short of the hire</span> : null}
        </Fact>
        <Fact label="Length">
          {days} day{days === 1 ? "" : "s"}
        </Fact>
        <Fact label="Premium">
          <span className="font-semibold">{hasPolicy ? money(shownPremium) : money(premiumFor(sel))}</span>
          <span className="ml-1.5 text-xs text-muted-foreground">
            {sel.size} of {COVERS.length} covers
          </span>
        </Fact>
      </div>

      {/* The cover — a tile each: what it is, what it pays for, what it costs. */}
      <div className="mt-3 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {COVERS.map((c) => {
          const on = sel.has(c.key);
          const wasOn = onPolicy.has(c.key);
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => toggle(c.key)}
              aria-pressed={on}
              className={cn(
                "flex flex-col gap-1.5 rounded-3xl px-4 py-3.5 text-left ring-1 transition-colors duration-200 ease-out motion-reduce:transition-none",
                on
                  ? "bg-primary/[0.06] ring-primary/30"
                  : "bg-muted/40 ring-foreground/5 hover:bg-muted/70"
              )}
            >
              <span className="flex items-center gap-2">
                {on ? (
                  <span className="flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <Check className="size-3" />
                  </span>
                ) : (
                  <span className="size-4 rounded-full ring-1 ring-foreground/20" />
                )}
                <span className={cn("text-sm font-semibold", on ? "text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]" : "text-muted-foreground")}>
                  {c.short}
                </span>
                {selection !== null && on !== wasOn && (
                  <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{on ? "Adding" : "Removing"}</span>
                )}
              </span>
              <span className={cn("text-[13px] font-medium", !on && "text-muted-foreground")}>{c.name}</span>
              <span className="text-xs leading-snug text-muted-foreground">{c.what}</span>
              <span className="mt-auto pt-1.5 text-xs tabular-nums text-muted-foreground">
                {money(rate(c))}/day × {days} ={" "}
                <span className={cn("font-semibold", on ? "text-foreground" : "")}>{money(rate(c) * days)}</span>
              </span>
            </button>
          );
        })}
      </div>

      {/* The change, once there is one. */}
      {(dirty || (!hasPolicy && sel.size > 0)) && (
        <div className="mt-3 flex items-center justify-end gap-2 text-sm text-muted-foreground">
          <span>{hasPolicy ? "New premium" : "Premium"}</span>
          {hasPolicy && <span className="line-through">{money(shownPremium)}</span>}
          <span className="font-semibold text-foreground">{money(premiumFor(sel))}</span>
          {dirty && (
            <Button size="sm" variant="ghost" onClick={() => setSelection(null)}>
              Undo
            </Button>
          )}
          <Button size="sm" disabled={sel.size === 0} onClick={apply}>
            {hasPolicy ? "Re-quote" : "Add cover"}
          </Button>
        </div>
      )}
      {!hasPolicy && sel.size === 0 && emptyNote && <p className="mt-3 text-xs text-muted-foreground">{emptyNote}</p>}

      {/* ── documents ────────────────────────────────────────────────────── */}
      <Dialog open={docsOpen} onOpenChange={(o) => (setDocsOpen(o), !o && setViewing(null))}>
        <DialogContent className="flex max-h-[90vh] flex-col gap-4 sm:max-w-3xl" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Bonzah documents</DialogTitle>
          </DialogHeader>
          <div className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-4">
            {COVERS.filter((c) => onPolicy.has(c.key)).map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => (live && pdfIds[c.key] ? void download(c.key) : setViewing(c.key))}
                className={cn(
                  insetCls,
                  "flex items-center gap-2.5 px-4 py-3 text-left transition-colors duration-200 ease-out hover:bg-primary/[0.06] motion-reduce:transition-none",
                  viewing === c.key && "bg-primary/[0.07] ring-primary/30"
                )}
              >
                {downloading === c.key ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4 text-muted-foreground" />}
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{c.short} certificate</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{live ? "Open the PDF" : "Preview"}</span>
                </span>
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto rounded-3xl bg-muted p-5 no-scrollbar">
            {viewing ? (
              <MockCertificate
                cover={COVERS.find((c) => c.key === viewing)!}
                policyNo={policyNo ?? "—"}
                insured={customerName}
                from={fmtDate(policy?.trip_start_date ?? rentalStart)}
                to={fmtDate(policy?.trip_end_date ?? rentalEnd)}
                state={policy?.pickup_state ?? "IL"}
              />
            ) : (
              <p className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                Pick a certificate above to read it.
              </p>
            )}
          </div>
          {viewing && (
            <div className="flex shrink-0 justify-end">
              <Button size="sm" variant="outline" onClick={() => window.print()}>
                <Download />
                Save or print
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Surface>
  );
}

/** One labelled fact in the policy strip. */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className="mt-1 truncate text-sm">{children}</div>
    </div>
  );
}

/** A demo certificate, laid out like Bonzah's own — marked as a demo. */
function MockCertificate({
  cover,
  policyNo,
  insured,
  from,
  to,
  state,
}: {
  cover: (typeof COVERS)[number];
  policyNo: string;
  insured: string;
  from: string;
  to: string;
  state: string;
}) {
  const rows = [
    ["Policy number", policyNo],
    ["Named insured", insured],
    ["Coverage", `${cover.name} (${cover.short})`],
    ["Covers", cover.what],
    ["Period", `${from} – ${to}`],
    ["State", state],
    ["Underwriter", "Bonzah Insurance Services (demo)"],
  ];
  return (
    <div className="relative mx-auto max-w-xl overflow-hidden rounded-2xl bg-white p-8 text-[#14141f] shadow-sm">
      <span className="pointer-events-none absolute right-6 top-6 rotate-12 rounded-md border-2 border-[#d6336c]/40 px-2 py-0.5 text-xs font-bold tracking-widest text-[#d6336c]/60">
        DEMO
      </span>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/bonzah-logo.svg" alt="Bonzah" className="h-7 w-auto" />
      <p className="mt-6 text-lg font-semibold">Certificate of Insurance</p>
      <p className="text-sm text-[#55556a]">{cover.name}</p>
      <dl className="mt-6 divide-y divide-[#ececf2] border-y border-[#ececf2]">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-4 py-2.5 text-sm">
            <dt className="w-36 shrink-0 text-[#77778a]">{k}</dt>
            <dd className="font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-6 text-[11px] leading-relaxed text-[#77778a]">
        This is a demonstration certificate. It is not a contract of insurance and provides no cover.
      </p>
    </div>
  );
}
