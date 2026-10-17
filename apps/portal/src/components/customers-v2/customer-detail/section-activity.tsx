"use client";

/* ─────────────────────────────────────────────────────────────────────────────
 * Activity — the record's own timeline, from `audit_logs`.
 * ────────────────────────────────────────────────────────────────────────── */

import { ConnectedTimeline } from "@/components/timeline-v2/connected-timeline";
import { EmptyHint, Panel, ProducedFrom, Section, Timeline, fmtDate } from "./kit";
import type { SectionProps } from "./sections";

export function SectionActivity({ c, onJump }: SectionProps) {
  return (
    <Panel
      title="Activity"
      description="Everything that has happened on this record, oldest first."
    >
      <ProducedFrom
        sources={[
          { key: "identity", label: "Identity" },
          { key: "rentals", label: "Rentals" },
          { key: "money", label: "Money" },
        ]}
        onJump={onJump}
      />
      {/* The rentals board, moved here from the right rail's old Timeline tab
          (Oct 8 2026) when that rail became one fixed overview. */}
      <Section>
        <ConnectedTimeline scope={{ kind: "customer", id: c.id }} heading="Customer timeline" />
      </Section>
      {c.events.length === 0 ? (
        <EmptyHint>Nothing has happened on this account yet.</EmptyHint>
      ) : (
        <Section>
          <Timeline steps={c.events.map((e) => ({ ...e, at: e.at ? fmtDate(e.at) : undefined }))} />
        </Section>
      )}
    </Panel>
  );
}
