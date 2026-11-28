"use client";

/**
 * What a v2 rental screen says about its customer's verification (spec 11.1 to 11.5).
 * Whether the rental may go ahead is NOT decided here: the existing manual-verify / waiver controls
 * beside it still decide that (spec 11.7).
 */

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { asStatus, STATUS_LABEL } from "@/lib/verification-v2/api";
import { licenceValidThrough } from "@/lib/verification-v2/expiry";
import { VerificationCell } from "./verification-cell";

function toDay(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  const s = String(value);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

function long(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function RentalVerificationNotice({ customerId, returnDate, className }: {
  customerId: string | null | undefined;
  returnDate: unknown;
  className?: string;
}) {
  const { tenant } = useTenant();
  const q = useQuery({
    queryKey: ["verification-v2-rental-notice", tenant?.id, customerId],
    enabled: !!tenant && !!customerId,
    queryFn: async () => {
      const { data } = await (supabase as any).from("customers")
        .select("id, name, verification_status, verification_warning, licence_expiry_date")
        .eq("id", customerId).eq("tenant_id", tenant!.id).maybeSingle();
      return data as { id: string; name: string; verification_status: string; verification_warning: string | null; licence_expiry_date: string | null } | null;
    },
  });
  const c = q.data;
  if (!c) return null;
  const status = asStatus(c.verification_status);
  const ret = toDay(returnDate);
  const expiryTooSoon = status === "verified" && !!c.licence_expiry_date && !!ret && !licenceValidThrough(c.licence_expiry_date, ret);

  const lines: string[] = [];
  if (status === "needs_review") lines.push(`${c.name}'s check needs a look.`);
  else if (status !== "verified") lines.push(`${c.name} is not verified (${STATUS_LABEL[status]}).`);
  if (status === "verified" && c.verification_warning) lines.push(c.verification_warning);
  if (expiryTooSoon) lines.push(`The licence on file runs out on ${long(c.licence_expiry_date!)}, before this rental ends on ${long(ret!)}.`);
  if (!lines.length) return null;

  return (
    <div className={`flex items-start gap-3 rounded-2xl border border-[#dc2626]/30 bg-[#dc2626]/5 p-3 text-sm ${className ?? ""}`} role="alert">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[#dc2626]" />
      <div className="grid flex-1 gap-1">
        {lines.map((l) => <p key={l}>{l}</p>)}
      </div>
      {status !== "verified" && <VerificationCell customerId={c.id} customerName={c.name} status={status} size="xs" className="shrink-0" />}
    </div>
  );
}
