"use client";

/* ─────────────────────────────────────────────────────────────────────────────
 * Activity — the record's own timeline, from `audit_logs`.
 * ────────────────────────────────────────────────────────────────────────── */

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
