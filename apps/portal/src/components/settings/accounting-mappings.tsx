/**
 * AccountingMappings — Sprint 3 surface (Spec §10.4 + §13).
 *
 * Settings → Accounting → Configure mappings. Tells Drive247 which provider
 * account each Drive247 event type should land in, plus the tax rate to
 * stamp on the invoice line. Also sets the bank/clearing account for
 * recordPayment calls.
 *
 * Editor mode — operator changes any row → "Save mappings" enabled → bulk
 * UPSERT via save-accounting-mappings edge fn. New lines on new invoices
 * pick up the new mapping; existing invoices in the provider stay untouched.
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Loader2, Save, Sparkles, AlertCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  useAccountingAccounts,
  useAccountingMappings,
  useAccountingTaxRates,
  useSaveAccountingMappings,
  type MappingSavePayload,
} from "@/hooks/use-accounting-sync";
import type { AccountingProvider } from "@/hooks/use-accounting-connection";

const EVENT_TYPES_FOR_MAPPING_UI: Array<{ key: string; label: string; description: string }> = [
  { key: "rental_charge",     label: "Rental charge",     description: "Daily/weekly/monthly rental fee" },
  { key: "extension_charge",  label: "Extension charge",  description: "Rental extension — gets its own invoice" },
  { key: "insurance_charge",  label: "Insurance charge",  description: "Bonzah or other insurance line" },
  { key: "damage_charge",     label: "Damage charge",     description: "Damage assessed and added to ledger" },
  { key: "mileage_charge",    label: "Mileage charge",    description: "Excess mileage charge" },
  { key: "late_fee",          label: "Late fee",          description: "Late-return penalty" },
  { key: "charging_cost",     label: "Charging cost",     description: "Tesla supercharger pass-through" },
  { key: "deposit_capture",   label: "Deposit (captured)",description: "Security deposit captured at end of rental" },
  { key: "discount",          label: "Discount",          description: "Discount applied — negative invoice line" },
];

interface Props {
  provider: AccountingProvider;
  onBack: () => void;
}

export function AccountingMappings({ provider, onBack }: Props) {
  const mappingsQuery = useAccountingMappings(provider);
  const accountsQuery = useAccountingAccounts(provider);
  const taxRatesQuery = useAccountingTaxRates(provider);
  const save = useSaveAccountingMappings();

  // Local form state — keyed by event_type, plus a special "payment_account" key.
  type DraftRow = { external_account_code: string; external_tax_code: string | null };
  const [draft, setDraft] = useState<Record<string, DraftRow>>({});
  const [paymentDraft, setPaymentDraft] = useState<{ external_account_code: string } | null>(null);

  // Seed draft once mappings load
  useEffect(() => {
    if (!mappingsQuery.data) return;
    if (Object.keys(draft).length > 0) return;
    const seeded: Record<string, DraftRow> = {};
    let payment: { external_account_code: string } | null = null;
    for (const row of mappingsQuery.data) {
      if (row.is_payment_account_sentinel) {
        payment = { external_account_code: row.external_account_code };
      } else if (row.event_type) {
        seeded[row.event_type] = {
          external_account_code: row.external_account_code,
          external_tax_code: row.external_tax_code,
        };
      }
    }
    setDraft(seeded);
    setPaymentDraft(payment);
  }, [mappingsQuery.data, draft]);

  // Dirty check — compare draft against fetched mappings.
  // We MUST apply the same "skip empty" filter that onSave applies, otherwise
  // event types the user hasn't filled in (external_account_code === "") will
  // never have a server-side row to match against → isDirty stays true forever
  // even right after a successful save.
  const isDirty = useMemo(() => {
    if (!mappingsQuery.data) return false;
    const existingByEvent = new Map<string, DraftRow>();
    let existingPayment: string | null = null;
    for (const row of mappingsQuery.data) {
      if (row.is_payment_account_sentinel) {
        existingPayment = row.external_account_code;
      } else if (row.event_type) {
        existingByEvent.set(row.event_type, {
          external_account_code: row.external_account_code,
          external_tax_code: row.external_tax_code,
        });
      }
    }
    if ((paymentDraft?.external_account_code ?? null) !== existingPayment) return true;
    for (const [key, d] of Object.entries(draft)) {
      // Skip empty drafts — they aren't saved, so they can't be "dirty"
      // against server state. Consistent with onSave's filter.
      if (!d.external_account_code) continue;
      const e = existingByEvent.get(key);
      if (!e) return true;
      if (e.external_account_code !== d.external_account_code) return true;
      if ((e.external_tax_code ?? null) !== (d.external_tax_code ?? null)) return true;
    }
    return false;
  }, [draft, paymentDraft, mappingsQuery.data]);

  const onSave = async () => {
    const mappings: MappingSavePayload[] = [];
    for (const e of EVENT_TYPES_FOR_MAPPING_UI) {
      const d = draft[e.key];
      if (!d || !d.external_account_code) continue;
      mappings.push({
        event_type: e.key,
        external_account_code: d.external_account_code,
        external_tax_code: d.external_tax_code ?? null,
      });
    }
    if (paymentDraft?.external_account_code) {
      mappings.push({
        is_payment_account_sentinel: true,
        external_account_code: paymentDraft.external_account_code,
      });
    }
    await save.mutateAsync({ provider, mappings });
  };

  const isLoading = mappingsQuery.isLoading || accountsQuery.isLoading || taxRatesQuery.isLoading;
  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-96 w-full rounded-lg" />
      </div>
    );
  }

  const accountsError = accountsQuery.error as Error | null;
  const taxRatesError = taxRatesQuery.error as Error | null;
  const accounts = accountsQuery.data ?? [];
  const taxRates = taxRatesQuery.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <button onClick={onBack} className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3 w-3" /> Back to Accounting
        </button>
        <h2 className="text-lg font-semibold">
          Configure mappings — {provider === "xero" ? "Xero" : "Zoho Books"}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Tell Drive247 which {provider === "xero" ? "Xero" : "Zoho"} account each type of charge should go to,
          and which tax rate to apply.
        </p>
      </div>

      {(accountsError || taxRatesError) && (
        <Card className="border-amber-200 bg-amber-50/40">
          <CardContent className="flex items-start gap-2 py-4 text-xs text-amber-800">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">Couldn&apos;t reach {provider === "xero" ? "Xero" : "Zoho"}.</p>
              <p className="mt-0.5">
                {(accountsError?.message ?? taxRatesError?.message ?? "Unknown error")}
              </p>
              <p className="mt-1">
                If the connection has expired, reconnect from the Accounting tab. Otherwise this is usually transient — try again in a minute.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Default-mappings hint */}
      {mappingsQuery.data && mappingsQuery.data.some((m) => m.is_default) && (
        <Card className="border-indigo-200 bg-indigo-50/40">
          <CardContent className="flex items-start gap-2 py-3 text-xs text-indigo-900">
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-600" />
            <p>
              We&apos;ve suggested defaults based on a typical car rental business. Review and save — you can change these any time.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Event-type mapping table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Event types</CardTitle>
          <CardDescription>
            One mapping per Drive247 event type. New invoice lines pick up the new mapping immediately;
            existing invoices in your provider aren&apos;t changed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-[1fr_220px_180px] gap-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <div>Event type</div>
            <div>Account</div>
            <div>Tax rate</div>
          </div>
          <div className="mt-2 space-y-2">
            {EVENT_TYPES_FOR_MAPPING_UI.map((e) => {
              const d = draft[e.key] ?? { external_account_code: "", external_tax_code: null };
              return (
                <div key={e.key} className="grid grid-cols-[1fr_220px_180px] items-center gap-3 rounded-md border border-border bg-background px-3 py-2">
                  <div>
                    <div className="text-sm font-medium">{e.label}</div>
                    <div className="text-[11px] text-muted-foreground">{e.description}</div>
                  </div>
                  <Select
                    value={d.external_account_code}
                    onValueChange={(v) => setDraft((prev) => ({ ...prev, [e.key]: { ...d, external_account_code: v } }))}
                  >
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue placeholder="Pick account…" />
                    </SelectTrigger>
                    <SelectContent>
                      {accounts.length === 0 ? (
                        <div className="px-2 py-1 text-[11px] text-muted-foreground">No accounts loaded</div>
                      ) : accounts.map((a) => (
                        <SelectItem key={a.code} value={a.code} className="text-xs">
                          {a.code} — {a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={d.external_tax_code ?? "__none__"}
                    onValueChange={(v) => setDraft((prev) => ({ ...prev, [e.key]: { ...d, external_tax_code: v === "__none__" ? null : v } }))}
                  >
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue placeholder="Pick tax…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__" className="text-xs">No tax</SelectItem>
                      {taxRates.map((t) => (
                        <SelectItem key={t.code} value={t.code} className="text-xs">
                          {t.name}{typeof t.rate === "number" ? ` (${t.rate.toFixed(2)}%)` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Payment account sentinel */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payment account</CardTitle>
          <CardDescription>
            When Drive247 records a payment in {provider === "xero" ? "Xero" : "Zoho Books"}, which bank or
            clearing account should it post against?
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Select
            value={paymentDraft?.external_account_code ?? ""}
            onValueChange={(v) => setPaymentDraft({ external_account_code: v })}
          >
            <SelectTrigger className="h-9 max-w-md text-xs">
              <SelectValue placeholder="Pick bank/clearing account…" />
            </SelectTrigger>
            <SelectContent>
              {accounts
                .filter((a) => !a.type || ["BANK", "CURRENT", "CURRLIAB", "PAYMENTS"].includes(a.type.toUpperCase()))
                .map((a) => (
                  <SelectItem key={a.code} value={a.code} className="text-xs">
                    {a.code} — {a.name}{a.type ? ` · ${a.type}` : ""}
                  </SelectItem>
                ))}
              {accounts.length > 0 && (
                <>
                  <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">Other accounts</div>
                  {accounts
                    .filter((a) => a.type && !["BANK", "CURRENT", "CURRLIAB", "PAYMENTS"].includes(a.type.toUpperCase()))
                    .map((a) => (
                      <SelectItem key={a.code} value={a.code} className="text-xs">
                        {a.code} — {a.name}{a.type ? ` · ${a.type}` : ""}
                      </SelectItem>
                    ))}
                </>
              )}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Save bar */}
      <div className="sticky bottom-0 flex items-center justify-end gap-3 border-t border-border bg-background/80 py-3 backdrop-blur">
        {isDirty && <Badge variant="outline" className="bg-amber-50 text-amber-700">Unsaved changes</Badge>}
        <Button variant="outline" onClick={onBack} disabled={save.isPending}>
          Cancel
        </Button>
        <Button onClick={onSave} disabled={!isDirty || save.isPending} className="bg-[#0f172a] text-white hover:bg-[#0f172a]/90">
          {save.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
          Save mappings
        </Button>
      </div>
    </div>
  );
}
