"use client";

import Link from "next/link";
import { format } from "date-fns";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  FileImage,
  ExternalLink,
  RefreshCw,
  Link2,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
} from "lucide-react";
import type { InsuranceVerification } from "@/hooks/use-insurance-verifications";
import {
  ScorePill,
  VerificationStatusChip,
} from "./verification-score-badge";
import {
  useReverifyInsurance,
} from "@/hooks/use-insurance-verifications";

function Field({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-3 gap-3 text-sm">
      <div className="text-muted-foreground col-span-1">{label}</div>
      <div className="col-span-2 font-medium break-words">
        {value ?? <span className="text-muted-foreground italic">—</span>}
      </div>
    </div>
  );
}

export function VerificationDetailSheet({
  verification,
  open,
  onOpenChange,
  onAttachClick,
}: {
  verification: InsuranceVerification | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAttachClick: (verificationId: string) => void;
}) {
  const reverify = useReverifyInsurance();

  if (!verification) return null;

  const ex = verification.extracted_fields;
  const findings = verification.ai_findings;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <FileImage className="h-5 w-5" />
            {verification.file_name}
          </SheetTitle>
          <SheetDescription>
            Uploaded {format(new Date(verification.created_at), "MMM dd, yyyy HH:mm")}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-5">
          <div className="flex items-center justify-between">
            <VerificationStatusChip
              status={verification.status}
              score={verification.ai_score}
            />
            <ScorePill score={verification.ai_score} />
          </div>

          {verification.ai_error && (
            <div className="rounded-md border border-red-200 bg-red-50 dark:bg-red-950/30 p-3 text-sm text-red-700 dark:text-red-300">
              <div className="flex items-center gap-2 font-medium">
                <AlertTriangle className="h-4 w-4" />
                AI could not analyze this file
              </div>
              <p className="mt-1 text-xs">{verification.ai_error}</p>
            </div>
          )}

          {/* Preview */}
          {verification.file_url && (
            <div className="rounded-lg border overflow-hidden bg-muted/30">
              {(verification.mime_type || "").startsWith("image/") ? (
                <img
                  src={verification.file_url}
                  alt={verification.file_name}
                  className="w-full max-h-72 object-contain"
                />
              ) : (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  <FileImage className="h-8 w-8 mx-auto mb-2" />
                  Preview not available
                </div>
              )}
            </div>
          )}

          {findings && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-indigo-600" />
                AI Analysis
              </h3>
              {findings.reasoning && (
                <p className="text-sm text-muted-foreground">
                  {findings.reasoning}
                </p>
              )}
              {findings.flags?.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Flags
                  </p>
                  <ul className="space-y-1">
                    {findings.flags.map((f, i) => (
                      <li
                        key={i}
                        className="flex gap-2 items-start text-sm rounded-md bg-amber-50 dark:bg-amber-950/30 px-2 py-1.5"
                      >
                        <AlertTriangle className="h-3.5 w-3.5 mt-0.5 text-amber-600 shrink-0" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {findings.is_insurance_document === false && (
                <p className="text-xs text-red-600 font-medium">
                  AI does not believe this is an insurance document.
                </p>
              )}
            </div>
          )}

          {ex && (
            <>
              <Separator />
              <div className="space-y-2">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  Extracted Details
                </h3>
                <div className="space-y-2">
                  <Field label="Insurer" value={ex.insurer} />
                  <Field label="Policy number" value={ex.policy_number} />
                  <Field label="Policy holder" value={ex.policy_holder} />
                  <Field label="Coverage" value={ex.coverage_type} />
                  <Field label="Vehicle" value={ex.vehicle_info} />
                  <Field
                    label="Start date"
                    value={ex.start_date}
                  />
                  <Field label="End date" value={ex.end_date} />
                  <Field label="Premium" value={ex.premium_amount} />
                  <Field label="Country" value={ex.country} />
                </div>
              </div>
            </>
          )}

          <Separator />

          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Attached rental</h3>
            {verification.rental_id ? (
              <div className="flex items-center justify-between text-sm rounded-md border p-2.5">
                <div className="min-w-0">
                  <Link
                    href={`/rentals/${verification.rental_id}`}
                    className="text-indigo-600 hover:underline font-medium"
                  >
                    {verification.rentals?.rental_number ||
                      verification.rental_id.slice(0, 8)}
                  </Link>
                  {verification.rentals?.customers?.name && (
                    <span className="ml-2 text-muted-foreground">
                      · {verification.rentals.customers.name}
                    </span>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onAttachClick(verification.id)}
                >
                  Change
                </Button>
              </div>
            ) : (
              <Button
                variant="outline"
                onClick={() => onAttachClick(verification.id)}
                className="w-full"
              >
                <Link2 className="h-4 w-4 mr-2" />
                Attach to a rental
              </Button>
            )}
          </div>

          <Separator />

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => reverify.mutate(verification.id)}
              disabled={reverify.isPending}
            >
              <RefreshCw
                className={`h-4 w-4 mr-2 ${reverify.isPending ? "animate-spin" : ""}`}
              />
              Re-run AI
            </Button>
            {verification.file_url && (
              <Button variant="outline" size="sm" asChild>
                <a
                  href={verification.file_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Open file
                </a>
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
