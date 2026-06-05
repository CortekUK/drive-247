"use client";

import { use } from "react";
import { LeadWorkspace } from "@/components/leads/lead-workspace";

export default function LeadWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <LeadWorkspace leadId={id} />;
}
