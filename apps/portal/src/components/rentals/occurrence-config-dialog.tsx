"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  CalendarClock, SkipForward, MoveRight, CalendarCheck, Undo2, FileSignature,
  ShieldCheck, Mail, Eye, Pencil, Plus, Trash2, Tag, DollarSign, Loader2,
  ExternalLink, Settings2, Check,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { formatCurrency } from "@/lib/formatters";
import { buildTemplateData, replaceVariables } from "@/lib/template-variables";
import { type BonzahCustomerDetails } from "@/components/rentals/bonzah-insurance-selector";
import type { CoverageOptions } from "@/hooks/use-bonzah-premium";
import { cn } from "@/lib/utils";

const EMPTY_COVERAGE: CoverageOptions = { cdw: false, rcli: false, sli: false, pai: false };
const COVERAGE_META: { key: keyof CoverageOptions; label: string; sub: string }[] = [
  { key: "cdw", label: "CDW", sub: "Collision Damage Waiver" },
  { key: "rcli", label: "RCLI", sub: "Rental Car Liability Insurance" },
  { key: "sli", label: "SLI", sub: "Supplemental Liability — requires RCLI" },
  { key: "pai", label: "PAI", sub: "Personal Accident Insurance" },
];

export interface OccurrenceExtra { id: string; label: string; amount: number }

export interface OccurrenceOverride {
  sendAgreement?: boolean;
  buyInsurance?: boolean;
  sendEmail?: boolean;
  emailSubject?: string;
  emailBody?: string;
  /** Override the period price (tax-inclusive) for this one renewal. null/undefined = use default. */
  priceOverride?: number | null;
  /** Extra one-off line items added to this renewal. */
  extras?: OccurrenceExtra[];
  /** Selected Bonzah coverage for this period. */
  insuranceCoverage?: CoverageOptions | null;
  insurancePremium?: number;
}

export interface OccurrenceContext {
  baseRate: number;
  currencyCode: string;
  periodUnit: "Daily" | "Weekly" | "Monthly";
  intervalCount: number;
  customerId?: string | null;
  customerEmail?: string | null;
  /** Full rental + vehicle so the agreement preview can fill {{variables}}. */
  rental?: any;
  vehicle?: any;
}

interface OccurrenceConfigDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  dateKey: string | null;
  isRenewal: boolean;
  exceptionType: "skip" | "move" | null;
  override: OccurrenceOverride;
  defaults: { emailSubject: string; emailBody: string; rateLabel: string; companyName: string; customerName: string; periodLabel: string };
  ctx: OccurrenceContext;
  onSkip: () => void;
  onMove: () => void;
  onMakeNext: () => void;
  onSetNext: () => void;
  onUndo: () => void;
  onChangeOverride: (cfg: OccurrenceOverride) => void;
}

function keyToDate(k: string) { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); }

function ScheduleBtn({ icon, label, desc, onClick, tone }: { icon: React.ReactNode; label: string; desc: string; onClick: () => void; tone: "rose" | "amber" | "violet" }) {
  const t = tone === "rose" ? "hover:border-rose-400/60 text-rose-500" : tone === "amber" ? "hover:border-amber-400/60 text-amber-500" : "hover:border-violet-400/60 text-violet-500";
  return (
    <button type="button" onClick={onClick} className={cn("flex-1 min-w-[150px] text-left rounded-lg border p-3 transition-colors hover:bg-muted/40", t.split(" ")[0])}>
      <div className={cn("flex items-center gap-1.5 text-sm font-medium", t.split(" ")[1])}>{icon}{label}</div>
      <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{desc}</div>
    </button>
  );
}

export function OccurrenceConfigDialog({
  open, onOpenChange, dateKey, isRenewal, exceptionType, override, defaults, ctx,
  onSkip, onMove, onMakeNext, onSetNext, onUndo, onChangeOverride,
}: OccurrenceConfigDialogProps) {
  const { tenant } = useTenant();
  const router = useRouter();
  const [editEmail, setEditEmail] = useState(false);
  const [showAgreement, setShowAgreement] = useState(false);

  const sendEmail = override.sendEmail !== false;
  const sendAgreement = !!override.sendAgreement;
  const buyInsurance = !!override.buyInsurance;

  // Tenant's active agreement template — the real document the customer will sign.
  const { data: agreement, isLoading: agreementLoading } = useQuery({
    queryKey: ["agreement-template-active", tenant?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("agreement_templates")
        .select("template_name, template_content")
        .eq("tenant_id", tenant!.id)
        .eq("is_active", true)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data as { template_name: string; template_content: string } | null;
    },
    enabled: open && sendAgreement && !!tenant?.id,
  });

  // Customer details — seed Bonzah premiums AND fill the agreement preview.
  const { data: customerDetails } = useQuery({
    queryKey: ["occurrence-customer", ctx.customerId],
    queryFn: async () => {
      const { data } = await supabase
        .from("customers")
        .select("id, name, email, phone, customer_type, date_of_birth, address, address_street, address_city, address_state, address_zip, license_number, license_state, id_number, nok_full_name, nok_phone, is_gig_driver")
        .eq("id", ctx.customerId!)
        .maybeSingle();
      return data as (BonzahCustomerDetails & Record<string, any>) | null;
    },
    enabled: open && !!ctx.customerId,
  });

  // The actual agreement the customer will see — {{variables}} filled in.
  const agreementHtml = useMemo(() => {
    if (!agreement?.template_content) return "";
    try {
      const data = buildTemplateData(
        ctx.rental ?? {},
        customerDetails ?? ctx.rental?.customers ?? {},
        ctx.vehicle ?? ctx.rental?.vehicles ?? {},
        tenant ?? {},
        ctx.currencyCode,
      );
      return replaceVariables(agreement.template_content, data);
    } catch {
      return agreement.template_content;
    }
  }, [agreement?.template_content, customerDetails, ctx.rental, ctx.vehicle, ctx.currencyCode, tenant]);

  const openAgreementInNewTab = () => {
    if (!agreementHtml) return;
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${agreement?.template_name || "Rental Agreement"}</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:820px;margin:48px auto;padding:0 28px;color:#1f2937;line-height:1.6}h1,h2,h3{color:#0f172a}</style></head><body>${agreementHtml}</body></html>`);
    w.document.close();
  };

  const editTemplate = () => {
    onOpenChange(false);
    router.push("/settings/agreement-templates");
  };

  if (!dateKey) return null;
  const dateLabel = format(keyToDate(dateKey), "EEE dd MMM yyyy");

  const subject = override.emailSubject ?? defaults.emailSubject;
  const body = override.emailBody ?? defaults.emailBody;
  const price = override.priceOverride != null ? override.priceOverride : ctx.baseRate;
  const extras = override.extras ?? [];
  const cov = override.insuranceCoverage ?? EMPTY_COVERAGE;
  const selectedCoverages = COVERAGE_META.filter((c) => cov[c.key]);
  const extrasTotal = extras.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  // Insurance is bought (and priced) when the renewal is auto-created, so it is
  // NOT part of the upfront total shown here — only the price + extras are known now.
  const grandTotal = (Number(price) || 0) + extrasTotal;
  const fmt = (n: number) => formatCurrency(n, ctx.currencyCode);
  const priceChanged = override.priceOverride != null && override.priceOverride !== ctx.baseRate;

  const toggleCoverage = (key: keyof CoverageOptions, on: boolean) => {
    const next = { ...cov, [key]: on };
    // SLI depends on RCLI — drop SLI if RCLI is turned off.
    if (key === "rcli" && !on) next.sli = false;
    patch({ insuranceCoverage: next });
  };

  const patch = (p: Partial<OccurrenceOverride>) => onChangeOverride({ ...override, ...p });
  const setExtras = (next: OccurrenceExtra[]) => patch({ extras: next });
  const addExtra = () => setExtras([...extras, { id: `x${extras.length + 1}-${dateKey}`, label: "", amount: 0 }]);
  const updateExtra = (id: string, p: Partial<OccurrenceExtra>) => setExtras(extras.map((e) => (e.id === id ? { ...e, ...p } : e)));
  const removeExtra = (id: string) => setExtras(extras.filter((e) => e.id !== id));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[88vh] overflow-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><CalendarClock className="h-5 w-5 text-violet-600" />Renewal · {dateLabel}</DialogTitle>
          <DialogDescription>Adjust the schedule and configure exactly what the customer is charged, signs, and receives for this one renewal.</DialogDescription>
        </DialogHeader>

        {/* Schedule */}
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Schedule</div>
          {exceptionType ? (
            <div className="flex items-center justify-between rounded-lg border p-3">
              <span className="text-sm">This renewal is <span className={exceptionType === "skip" ? "text-rose-500" : "text-amber-500"}>{exceptionType === "skip" ? "skipped" : "moved"}</span>.</span>
              <Button variant="outline" size="sm" onClick={onUndo} className="gap-1.5"><Undo2 className="h-3.5 w-3.5" />Undo</Button>
            </div>
          ) : isRenewal ? (
            <div className="flex flex-wrap gap-2">
              <ScheduleBtn tone="rose" icon={<SkipForward className="h-3.5 w-3.5" />} label="Skip" desc="No charge this period; next jumps forward." onClick={onSkip} />
              <ScheduleBtn tone="amber" icon={<MoveRight className="h-3.5 w-3.5" />} label="Move…" desc="Relocate just this one to another date." onClick={onMove} />
              <ScheduleBtn tone="violet" icon={<CalendarCheck className="h-3.5 w-3.5" />} label="Make next" desc="Re-base the whole schedule from here." onClick={onMakeNext} />
            </div>
          ) : (
            <ScheduleBtn tone="violet" icon={<CalendarCheck className="h-3.5 w-3.5" />} label="Set as next renewal" desc="Make this the next charge; the cadence continues from here." onClick={onSetNext} />
          )}
        </div>

        {isRenewal && !exceptionType && (
          <>
            <Separator />
            <div className="space-y-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">What happens on this renewal</div>

              {/* Price + extras */}
              <div className="rounded-lg border p-4 space-y-4">
                <div className="flex items-center gap-2 text-sm font-medium"><DollarSign className="h-4 w-4 text-violet-500" />Charge for this period</div>

                <div className="flex flex-wrap items-end gap-4">
                  <div className="space-y-1">
                    <Label className="text-xs">Period price (incl. tax)</Label>
                    <div className="relative">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">{ctx.currencyCode === "GBP" ? "£" : "$"}</span>
                      <Input
                        type="number" min={0} step="0.01"
                        value={Number.isFinite(price) ? price : 0}
                        onChange={(e) => {
                          const v = e.target.value;
                          patch({ priceOverride: v === "" ? null : Math.max(0, parseFloat(v) || 0) });
                        }}
                        className="h-9 w-36 pl-6"
                      />
                    </div>
                  </div>
                  {priceChanged && (
                    <Button variant="ghost" size="sm" onClick={() => patch({ priceOverride: null })} className="h-9 text-xs text-muted-foreground">
                      Reset to {fmt(ctx.baseRate)}
                    </Button>
                  )}
                  {!priceChanged && <span className="text-xs text-muted-foreground pb-2.5">Default rate · {fmt(ctx.baseRate)}</span>}
                </div>

                {/* Extras */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs flex items-center gap-1.5"><Tag className="h-3.5 w-3.5 text-muted-foreground" />Extras for this renewal</Label>
                    <Button type="button" variant="outline" size="sm" onClick={addExtra} className="h-7 gap-1 text-xs"><Plus className="h-3.5 w-3.5" />Add extra</Button>
                  </div>
                  {extras.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground">No extras. Add cleaning fees, mileage, add-ons, etc. — they're billed on top of the period price.</p>
                  ) : (
                    <div className="space-y-2">
                      {extras.map((ex) => (
                        <div key={ex.id} className="flex items-center gap-2">
                          <Input value={ex.label} placeholder="e.g. Cleaning fee" onChange={(e) => updateExtra(ex.id, { label: e.target.value })} className="h-8 text-sm flex-1" />
                          <div className="relative w-28">
                            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{ctx.currencyCode === "GBP" ? "£" : "$"}</span>
                            <Input type="number" min={0} step="0.01" value={ex.amount} onChange={(e) => updateExtra(ex.id, { amount: Math.max(0, parseFloat(e.target.value) || 0) })} className="h-8 text-sm pl-6" />
                          </div>
                          <Button type="button" variant="ghost" size="icon" onClick={() => removeExtra(ex.id)} className="h-8 w-8 text-rose-500 hover:text-rose-600"><Trash2 className="h-3.5 w-3.5" /></Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Total */}
                <div className="rounded-md bg-violet-500/[0.06] border border-violet-400/30 p-3 space-y-1 text-sm">
                  <div className="flex justify-between text-muted-foreground"><span>Period price</span><span>{fmt(Number(price) || 0)}</span></div>
                  {extrasTotal > 0 && <div className="flex justify-between text-muted-foreground"><span>Extras</span><span>{fmt(extrasTotal)}</span></div>}
                  <div className="flex justify-between font-semibold text-violet-700 dark:text-violet-200 pt-1 border-t border-violet-400/20"><span>Customer pays</span><span>{fmt(grandTotal)}</span></div>
                  {selectedCoverages.length > 0 && (
                    <div className="text-[11px] text-indigo-600 dark:text-indigo-300 pt-1">+ {selectedCoverages.map((c) => c.label).join(", ")} insurance — premium added automatically when the renewal is created.</div>
                  )}
                </div>
              </div>

              {/* Email */}
              <div className="rounded-lg border p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-medium"><Mail className="h-4 w-4 text-blue-500" />Email the customer a pay-link</div>
                  <Switch checked={sendEmail} onCheckedChange={(v) => patch({ sendEmail: v })} />
                </div>
                {sendEmail && (
                  <>
                    {/* Full rendered preview */}
                    <div className="rounded-lg border bg-muted/20 overflow-hidden">
                      <div className="border-b bg-background/60 px-3 py-2 text-[11px] text-muted-foreground space-y-0.5">
                        <div><span className="font-medium text-foreground/70">To:</span> {ctx.customerEmail || "— no email on file"}</div>
                        <div><span className="font-medium text-foreground/70">Subject:</span> {subject}</div>
                      </div>
                      <div className="p-4 text-sm bg-white dark:bg-zinc-900">
                        <p className="font-semibold mb-2 text-foreground">Time to renew your rental</p>
                        {body.split("\n").map((line, i) => (
                          line.trim() === "" ? <div key={i} className="h-2" /> : <p key={i} className="mb-2 text-foreground/90">{line}</p>
                        ))}
                        {extras.length > 0 && (
                          <div className="my-3 rounded-md border bg-muted/30 p-2 text-xs">
                            <div className="flex justify-between"><span>{ctx.periodUnit === "Monthly" ? "Monthly" : ctx.periodUnit === "Daily" ? "Daily" : "Weekly"} rate</span><span>{fmt(Number(price) || 0)}</span></div>
                            {extras.map((e) => <div key={e.id} className="flex justify-between text-muted-foreground"><span>{e.label || "Extra"}</span><span>{fmt(Number(e.amount) || 0)}</span></div>)}
                          </div>
                        )}
                        <div className="text-center my-4"><span className="inline-block bg-violet-600 text-white px-5 py-2 rounded-md text-sm font-semibold">Pay {fmt(grandTotal)} Now</span></div>
                        <p className="text-xs text-muted-foreground">If you've already paid or returned the vehicle, please disregard this email.</p>
                      </div>
                    </div>
                    <button type="button" onClick={() => setEditEmail((e) => !e)} className="inline-flex items-center gap-1.5 text-xs text-violet-600 hover:underline"><Pencil className="h-3 w-3" />{editEmail ? "Hide editor" : "Edit subject & message"}</button>
                    {editEmail && (
                      <div className="space-y-2 rounded-md border p-3 bg-muted/10">
                        <div className="space-y-1">
                          <Label className="text-xs">Subject</Label>
                          <Input value={subject} onChange={(e) => patch({ emailSubject: e.target.value })} className="h-8 text-sm" />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Message</Label>
                          <Textarea value={body} onChange={(e) => patch({ emailBody: e.target.value })} rows={5} className="text-sm" />
                          <p className="text-[11px] text-muted-foreground">The Pay-now button, amount and extras breakdown are added automatically.</p>
                        </div>
                        {(override.emailSubject != null || override.emailBody != null) && (
                          <Button variant="ghost" size="sm" onClick={() => patch({ emailSubject: undefined, emailBody: undefined })} className="text-xs h-7">Reset to default</Button>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Agreement */}
              <div className="rounded-lg border p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-medium"><FileSignature className="h-4 w-4 text-emerald-500" />Send a new rental agreement to e-sign</div>
                  <Switch checked={sendAgreement} onCheckedChange={(v) => patch({ sendAgreement: v })} />
                </div>
                {sendAgreement && (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-3">
                      <button type="button" onClick={() => setShowAgreement((s) => !s)} className="inline-flex items-center gap-1.5 text-xs text-violet-600 hover:underline"><Eye className="h-3 w-3" />{showAgreement ? "Hide agreement" : "Preview agreement"}</button>
                      <button type="button" onClick={openAgreementInNewTab} disabled={!agreementHtml} className="inline-flex items-center gap-1.5 text-xs text-violet-600 hover:underline disabled:opacity-40 disabled:no-underline"><ExternalLink className="h-3 w-3" />Open in new tab</button>
                      <button type="button" onClick={editTemplate} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"><Settings2 className="h-3 w-3" />Edit template in Settings</button>
                    </div>
                    {showAgreement && (
                      agreementLoading ? (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground p-3"><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading your agreement…</div>
                      ) : agreement ? (
                        <div className="rounded-md border bg-muted/20">
                          <div className="flex items-center justify-between border-b px-3 py-2">
                            <span className="text-xs font-medium text-foreground/70">{agreement.template_name}</span>
                            <span className="text-[10px] text-muted-foreground">Filled with this customer's details</span>
                          </div>
                          {looksLikeHtml(agreementHtml) ? (
                            <div className="max-h-72 overflow-auto p-4 text-xs leading-relaxed text-foreground/90 [&_p]:mb-2 [&_h1]:font-semibold [&_h1]:text-base [&_h2]:font-semibold [&_h2]:text-sm [&_ul]:list-disc [&_ul]:pl-5 [&_strong]:font-semibold" dangerouslySetInnerHTML={{ __html: agreementHtml }} />
                          ) : (
                            <div className="max-h-72 overflow-auto p-4 text-xs leading-relaxed whitespace-pre-wrap text-foreground/90">{agreementHtml}</div>
                          )}
                        </div>
                      ) : (
                        <p className="text-xs text-amber-600 rounded-md bg-amber-500/10 border border-amber-400/30 p-3">No active agreement template found. <button type="button" onClick={editTemplate} className="underline font-medium">Set one in Settings → Agreement Templates</button> first.</p>
                      )
                    )}
                  </div>
                )}
              </div>

              {/* Insurance — selection only; the policy is bought when the renewal is auto-created */}
              <div className="rounded-lg border p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-medium"><ShieldCheck className="h-4 w-4 text-indigo-500" />Add Bonzah insurance to this renewal</div>
                  <Switch checked={buyInsurance} onCheckedChange={(v) => patch({ buyInsurance: v, ...(v ? {} : { insuranceCoverage: null }) })} />
                </div>
                {buyInsurance && (
                  <div className="space-y-2">
                    <p className="text-[11px] text-muted-foreground">Pick the coverage to buy. You're <strong>not</strong> charged now — the policy is purchased and the premium added automatically when this renewal is created.</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {COVERAGE_META.map((c) => {
                        const checked = !!cov[c.key];
                        const disabled = c.key === "sli" && !cov.rcli;
                        return (
                          <button
                            key={c.key}
                            type="button"
                            disabled={disabled}
                            onClick={() => toggleCoverage(c.key, !checked)}
                            className={cn(
                              "flex items-start gap-2.5 rounded-lg border p-3 text-left transition-colors",
                              checked ? "border-indigo-400/60 bg-indigo-500/[0.06]" : "hover:bg-muted/40",
                              disabled && "opacity-45 cursor-not-allowed",
                            )}
                          >
                            <span className={cn("mt-0.5 flex h-4 w-4 items-center justify-center rounded border", checked ? "bg-indigo-600 border-indigo-600 text-white" : "border-muted-foreground/40")}>
                              {checked && <Check className="h-3 w-3" />}
                            </span>
                            <span>
                              <span className="block text-sm font-medium">{c.label}</span>
                              <span className="block text-[11px] text-muted-foreground leading-snug">{c.sub}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    {selectedCoverages.length === 0 && <p className="text-[11px] text-amber-600">No coverage selected yet — pick at least one, or turn this off.</p>}
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        <div className="flex justify-end pt-2 border-t">
          <Button onClick={() => onOpenChange(false)} className="bg-violet-600 hover:bg-violet-700 text-white">Done</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function looksLikeHtml(s: string | null | undefined) {
  return !!s && /<[a-z][\s\S]*>/i.test(s);
}
