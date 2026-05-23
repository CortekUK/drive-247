/**
 * LeadList — non-draggable list view used by Waitlist / Lost / Blacklisted tabs.
 * Spec Section 6.3 (Tabs).
 */
"use client";

import Link from "next/link";
import { Mail, Phone, Calendar } from "lucide-react";
import type { LeadRow } from "@/hooks/use-leads";
import { stageColor, stageLabel } from "@/lib/lead-stage-machine";
import { cn } from "@/lib/utils";

interface LeadListProps {
  leads: LeadRow[];
  emptyLabel?: string;
}

export function LeadList({ leads, emptyLabel = "No leads here" }: LeadListProps) {
  if (leads.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[#f1f5f9] bg-white py-16 text-center text-sm text-[#737373]">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-[#f1f5f9] bg-white">
      <table className="w-full text-sm">
        <thead className="bg-[#eef2ff] text-[11px] uppercase tracking-wide text-[#404040]">
          <tr>
            <th className="px-4 py-2 text-left font-semibold">Name</th>
            <th className="px-4 py-2 text-left font-semibold">Contact</th>
            <th className="px-4 py-2 text-left font-semibold">Requested</th>
            <th className="px-4 py-2 text-left font-semibold">Score</th>
            <th className="px-4 py-2 text-left font-semibold">Stage</th>
          </tr>
        </thead>
        <tbody>
          {leads.map((l) => {
            const hues = stageColor(l.stage);
            const range = l.start_date && l.end_date ? `${l.start_date} → ${l.end_date}` : "—";
            return (
              <tr key={l.id} className="border-t border-[#f1f5f9] hover:bg-[#f8fafc]">
                <td className="px-4 py-2">
                  <Link href={`/leads/${l.id}`} className="font-medium text-[#080812] hover:text-indigo-600">
                    {l.full_name}
                  </Link>
                </td>
                <td className="px-4 py-2 text-[#404040]">
                  <div className="flex items-center gap-1.5"><Mail className="h-3 w-3 text-[#737373]" />{l.email}</div>
                  <div className="flex items-center gap-1.5"><Phone className="h-3 w-3 text-[#737373]" />···{l.phone.replace(/\D/g, "").slice(-4)}</div>
                </td>
                <td className="px-4 py-2 text-[#404040]">
                  <div className="flex items-center gap-1.5"><Calendar className="h-3 w-3 text-[#737373]" />{range}</div>
                  <span className="text-xs text-[#737373]">{l.vehicle_class || (l.vehicle_id ? "Specific" : "Any")}</span>
                </td>
                <td className="px-4 py-2 text-[#404040]">
                  {l.lead_score != null ? `${l.lead_score} · ${l.score_band ?? ""}` : "—"}
                </td>
                <td className={cn("px-4 py-2 font-medium", hues.text)}>{stageLabel(l.stage)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
