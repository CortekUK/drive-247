"use client";

/**
 * The customer's page · Verification section block for feat-003 (spec 03.7, 07, 08.19, 12.4):
 * the status with Verify / Remind, the red warning, the last check's moments and result lines,
 * the licence photos through 10-minute signed links, and Run again for a premium check that could not run.
 */

import { useState } from "react";
import { Image as ImageIcon, Loader2, RotateCw } from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { useToast } from "@/hooks/use-toast";
import { useVerificationActions, useVerificationPhotos, useVerificationStatus } from "@/hooks/use-verification-v2";
import { LINE_LABEL, momentText } from "@/lib/verification-v2/api";
import { ResultLines } from "./verify-dialog-v2";
import { VerificationCell } from "./verification-cell";

function fmt(iso: string) {
  return new Date(iso).toLocaleString("en-US", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

export function VerificationPanel({ customerId, customerName, canEdit }: {
  customerId: string;
  customerName: string;
  canEdit: boolean;
}) {
  const { toast } = useToast();
  const statusQ = useVerificationStatus(customerId);
  const { runPremium } = useVerificationActions(customerId);
  const [showPhotos, setShowPhotos] = useState(false);
  const data = statusQ.data;
  const warning = data?.warning ?? null;
  const photos = useVerificationPhotos(data?.session?.id, showPhotos);
  const rerunnable = (data?.checks ?? []).filter((c) => c.service_key !== "standard" && c.result === "could_not_check");

  return (
    <div className="grid gap-3 rounded-3xl border p-4" data-tour="customer-verification-v2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">Driver verification</span>
        {statusQ.isLoading ? <Loader2 className="size-4 animate-spin" /> : (
          <VerificationCell customerId={customerId} customerName={customerName} status={data?.status} warning={warning} size="sm" />
        )}
      </div>
      {data?.status === "verified" && warning && (
        <p className="rounded-2xl bg-[#dc2626]/10 px-3 py-2 text-sm text-[#dc2626]">{warning}</p>
      )}
      {data?.session && (
        <>
          <ol className="grid gap-1 text-sm">
            {data.events.map((e, i) => (
              <li key={i} className="flex justify-between gap-3">
                <span>{momentText(e)}</span>
                <span className="text-xs tabular-nums text-muted-foreground">{fmt(e.at)}</span>
              </li>
            ))}
          </ol>
          <ResultLines checks={data.checks} />
          <div className="flex flex-wrap gap-2">
            {data.checks.some((c) => c.service_key === "standard" && c.result !== "pending") && (
              <Button variant="outline" size="sm" onClick={() => setShowPhotos((v) => !v)}>
                <ImageIcon /> {showPhotos ? "Hide photos" : "Show photos"}
              </Button>
            )}
            {canEdit && rerunnable.map((c) => (
              <Button key={c.service_key} variant="outline" size="sm" disabled={runPremium.isPending}
                onClick={async () => {
                  try { await runPremium.mutateAsync(c.service_key); toast({ title: `${LINE_LABEL[c.service_key] ?? c.service_key} is running again` }); }
                  catch (e) { toast({ title: "Could not run it again", description: (e as Error).message, variant: "destructive" }); }
                }}>
                <RotateCw /> Run {LINE_LABEL[c.service_key] ?? c.service_key} again
              </Button>
            ))}
          </div>
          {showPhotos && (
            <div className="grid grid-cols-3 gap-2">
              {photos.isLoading ? <Loader2 className="size-4 animate-spin" /> : (["front", "back", "selfie"] as const).map((k) =>
                photos.data?.[k]
                  ? <a key={k} href={photos.data[k]!} target="_blank" rel="noreferrer"><img src={photos.data[k]!} alt={`Licence ${k}`} className="aspect-[4/3] w-full rounded-xl object-cover" /></a>
                  : <span key={k} className="flex aspect-[4/3] items-center justify-center rounded-xl border text-xs text-muted-foreground">No {k}</span>)}
            </div>
          )}
        </>
      )}
    </div>
  );
}
