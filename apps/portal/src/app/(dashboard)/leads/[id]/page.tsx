"use client";

import { use } from "react";
import { notFound } from "next/navigation";
import { LeadWorkspace } from "@/components/leads/lead-workspace";
import { useTenant } from "@/contexts/TenantContext";
import { isAreaHidden } from "@/lib/lean-areas";

export default function LeadWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { tenantSlug } = useTenant();
  if (isAreaHidden("leads", tenantSlug)) notFound();

  const { id } = use(params);
  return <LeadWorkspace leadId={id} />;
}
