"use client";

import { use } from "react";
import { notFound } from "next/navigation";
import { LeadWorkspace } from "@/components/leads/lead-workspace";
import { useTenant } from "@/contexts/TenantContext";
import { useIsAreaHidden } from "@/lib/lean-context";

export default function LeadWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { tenantSlug } = useTenant();
  const leadsHidden = useIsAreaHidden("leads");
  if (leadsHidden) notFound();

  const { id } = use(params);
  return <LeadWorkspace leadId={id} />;
}
