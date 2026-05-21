"use client";

import Link from "next/link";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sparkles, ExternalLink, AlertTriangle, FileImage } from "lucide-react";
import {
  useRentalInsuranceVerifications,
} from "@/hooks/use-insurance-verifications";
import {
  ScorePill,
  VerificationStatusChip,
} from "./verification-score-badge";

export function RentalInsuranceVerificationsCard({
  rentalId,
}: {
  rentalId: string;
}) {
  const { data: verifications = [], isLoading } =
    useRentalInsuranceVerifications(rentalId);

  if (!isLoading && verifications.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-indigo-600" />
          AI-Verified Insurance Documents
          <span className="text-sm font-normal text-muted-foreground">
            ({verifications.length})
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading && (
          <div className="h-16 bg-muted animate-pulse rounded" />
        )}
        {verifications.map((v) => {
          const ex = v.extracted_fields;
          const findings = v.ai_findings;
          return (
            <div
              key={v.id}
              className="rounded-lg border p-3 space-y-2 hover:bg-muted/30 transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 font-medium text-sm">
                    <FileImage className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="truncate">{v.file_name}</span>
                  </div>
                  {ex?.insurer && (
                    <div className="text-xs text-muted-foreground mt-1">
                      {ex.insurer}
                      {ex.policy_number && (
                        <>
                          {" · "}
                          <span className="font-mono">{ex.policy_number}</span>
                        </>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <VerificationStatusChip status={v.status} />
                  <ScorePill score={v.ai_score} />
                </div>
              </div>

              {ex && (ex.start_date || ex.end_date || ex.coverage_type) && (
                <div className="grid grid-cols-3 gap-2 text-xs pt-1">
                  {ex.coverage_type && (
                    <div>
                      <div className="text-muted-foreground">Coverage</div>
                      <div className="font-medium">{ex.coverage_type}</div>
                    </div>
                  )}
                  {ex.start_date && (
                    <div>
                      <div className="text-muted-foreground">Start</div>
                      <div className="font-medium">{ex.start_date}</div>
                    </div>
                  )}
                  {ex.end_date && (
                    <div>
                      <div className="text-muted-foreground">End</div>
                      <div className="font-medium">{ex.end_date}</div>
                    </div>
                  )}
                </div>
              )}

              {findings?.flags && findings.flags.length > 0 && (
                <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 px-2 py-1.5 text-xs">
                  <div className="flex items-center gap-1 text-amber-700 dark:text-amber-300 font-medium mb-0.5">
                    <AlertTriangle className="h-3 w-3" />
                    {findings.flags.length} flag
                    {findings.flags.length === 1 ? "" : "s"}
                  </div>
                  <ul className="list-disc list-inside text-amber-700 dark:text-amber-300 space-y-0.5">
                    {findings.flags.slice(0, 3).map((f, i) => (
                      <li key={i}>{f}</li>
                    ))}
                    {findings.flags.length > 3 && (
                      <li className="list-none italic opacity-70">
                        + {findings.flags.length - 3} more
                      </li>
                    )}
                  </ul>
                </div>
              )}

              <div className="flex items-center justify-between pt-1">
                <span className="text-[11px] text-muted-foreground">
                  Verified{" "}
                  {format(new Date(v.created_at), "MMM dd, yyyy HH:mm")}
                </span>
                <div className="flex gap-1">
                  {v.file_url && (
                    <Button size="sm" variant="ghost" className="h-7" asChild>
                      <a href={v.file_url} target="_blank" rel="noreferrer">
                        <ExternalLink className="h-3.5 w-3.5 mr-1" />
                        View
                      </a>
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" className="h-7" asChild>
                    <Link href="/insurances?tab=verifications">
                      Manage
                    </Link>
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
