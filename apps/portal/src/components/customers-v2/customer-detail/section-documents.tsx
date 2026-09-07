"use client";

/* ─────────────────────────────────────────────────────────────────────────────
 * Documents — the files THIS operator holds about the customer.
 *
 * Not to be confused with verification evidence: that is the provider's, it is
 * immutable, and it lives on the Verification section. These are uploaded here,
 * typed, given a validity window, and scanned.
 * ────────────────────────────────────────────────────────────────────────── */

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Download, FileText, Pencil, Plus, ScanLine, ShieldCheck, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui-v2/button";
import { useCustomerDocuments, useDeleteCustomerDocument, useDownloadDocument } from "@/hooks/use-customer-documents";
import AddCustomerDocumentDialog from "@/components/customers/add-customer-document-dialog";
import { EmptyHint, Panel, Pill, Section, Stat, Thumb, expiryOf, fmtDate, listCls } from "./kit";
import type { SectionProps } from "./sections";

const SCAN_TONE = { none: "neutral", scanning: "primary", passed: "success", flagged: "warning" } as const;
const SCAN_WORD = {
  none: "Not scanned",
  scanning: "Scanning",
  passed: "Scan passed",
  flagged: "Needs a look",
} as const;

/**
 * "Accept anyway" — a member of staff overruling the scanner.
 *
 * Tenant-guarded like every other write on this screen. `customer_documents`
 * has RLS policies, but the same rule applies as everywhere else in this
 * component tree: the filter is in the query, not assumed from the session.
 */
function useAcceptDocument(customerId: string) {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (documentId: string) => {
      const { error } = await (supabase as any)
        .from("customer_documents")
        .update({ verified: true })
        .eq("id", documentId)
        .eq("tenant_id", tenant!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customer-documents"] });
      toast({ title: "Document accepted", description: "Marked verified against the scanner's objection." });
    },
    onError: (e: any) => toast({ title: "Could not accept it", description: e.message, variant: "destructive" }),
  });
}

export function SectionDocuments({ c, onJump, canEdit }: SectionProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | undefined>();
  const { data: rawDocs } = useCustomerDocuments(c.id);
  const deleteDoc = useDeleteCustomerDocument();
  const download = useDownloadDocument();
  const accept = useAcceptDocument(c.id);

  const expiring = c.docs.filter((d) => expiryOf(d.until).state === "soon").length;
  const expired = c.docs.filter((d) => expiryOf(d.until).state === "expired").length;
  const flagged = c.docs.filter((d) => d.scan.status === "flagged").length;

  const rawById = new Map(((rawDocs as any[]) || []).map((d: any) => [d.id, d]));

  return (
    <Panel
      title="Documents"
      description="Files this operator holds about the customer — uploaded here, scanned, and given a validity window."
      right={
        canEdit ? (
          <Button
            variant="outline"
            onClick={() => {
              setEditingId(undefined);
              setAddOpen(true);
            }}
          >
            <Plus className="size-4" />
            Add document
          </Button>
        ) : undefined
      }
    >
      {/*
       * The distinction that matters, stated where it matters. Verification
       * photos belong to the PROVIDER: they are evidence of one verdict at one
       * moment, they cannot be edited, and they live on a different table.
       * Mixing the two makes both unreadable — an operator replacing a "licence
       * front" here would reasonably expect the verdict to update, and it
       * would not.
       */}
      <div className="flex items-start gap-3 rounded-4xl bg-muted/40 px-6 py-5 ring-1 ring-foreground/5">
        <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <p className="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground">
          These are the operator&apos;s own files. The licence photos and selfie the verification
          provider captured are its evidence, not yours — they cannot be replaced from here and they
          live on{" "}
          <button
            type="button"
            onClick={() => onJump("verification")}
            className="cursor-pointer font-medium text-primary underline-offset-2 hover:underline"
          >
            Verification
          </button>
          .
        </p>
      </div>

      {c.docs.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat
            label="On file"
            value={String(c.docs.length)}
            hint={`${c.docs.filter((d) => d.verified).length} marked verified`}
          />
          <Stat
            label="Expiring"
            value={String(expiring + expired)}
            hint={expired ? `${expired} already expired` : "Within 30 days"}
            tone={expired ? "destructive" : expiring ? "warning" : undefined}
          />
          <Stat
            label="Flagged by the scanner"
            value={String(flagged)}
            hint={flagged ? "Needs a human" : "Nothing outstanding"}
            tone={flagged ? "warning" : undefined}
          />
        </div>
      )}

      <Section title="Files">
        {c.docs.length === 0 ? (
          <EmptyHint>
            Nothing on file. A licence and a proof of address are what most operators ask for before
            the first handover.
          </EmptyHint>
        ) : (
          <div className="space-y-3">
            {c.docs.map((d) => {
              const exp = expiryOf(d.until);
              return (
                <div key={d.id} className={cn(listCls, "divide-y-0")}>
                  <div className="flex items-start gap-4 px-5 py-4">
                    <Thumb className="h-12 w-16 shrink-0" filled />

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-medium">{d.name}</p>
                        {d.verified && (
                          <Pill tone="success">
                            <Check className="size-3" />
                            Verified
                          </Pill>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {d.type}
                        {d.vehicle && ` · ${d.vehicle}`} · added {fmtDate(d.uploadedAt)}
                      </p>

                      <div className="mt-2.5 flex flex-wrap items-center gap-2">
                        <Pill tone={SCAN_TONE[d.scan.status]}>
                          <ScanLine className="size-3" />
                          {SCAN_WORD[d.scan.status]}
                          {d.scan.confidence !== null && ` · ${d.scan.confidence}%`}
                        </Pill>
                        {exp.state !== "none" && (
                          <Pill tone={exp.state === "valid" ? "neutral" : "warning"}>{exp.label}</Pill>
                        )}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                      {d.fileUrl && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const raw = rawById.get(d.id);
                            if (raw) download.mutate(raw);
                          }}
                        >
                          <Download className="size-3.5" />
                          Download
                        </Button>
                      )}
                      {canEdit && (
                        <>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Edit ${d.name}`}
                            onClick={() => {
                              setEditingId(d.id);
                              setAddOpen(true);
                            }}
                            className="text-muted-foreground"
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Remove ${d.name}`}
                            onClick={() => deleteDoc.mutate(d.id)}
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* The scanner's objection, in its own words, where the file
                      is — not behind a dialog that has to be gone looking for. */}
                  {d.scan.status === "flagged" && d.scan.reasons.length > 0 && (
                    <div className="mx-5 mb-4 rounded-2xl bg-warning-light/60 px-4 py-3 ring-1 ring-warning/25">
                      <p className="flex items-center gap-1.5 text-xs font-medium text-warning">
                        <AlertTriangle className="size-3.5" />
                        The scanner could not clear this one
                      </p>
                      <ul className="mt-1.5 space-y-1">
                        {d.scan.reasons.map((r) => (
                          <li key={r} className="text-xs leading-relaxed text-muted-foreground">
                            · {r}
                          </li>
                        ))}
                      </ul>
                      {canEdit && !d.verified && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button size="sm" onClick={() => accept.mutate(d.id)} disabled={accept.isPending}>
                            <ShieldCheck className="size-4" />
                            Accept anyway
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Section>

      <AddCustomerDocumentDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        customerId={c.id}
        documentId={editingId}
      />
    </Panel>
  );
}
