"use client";

/**
 * Reminders, before there is a single active one (lean tenants only — the
 * Reminders page decides when this renders).
 */

import { Bell, Plus } from "lucide-react";
import { TeachingEmptyState } from "@/components/empty-states/teaching-empty-state";
import { RemindersEmptyArt } from "@/components/illustrations-v2/scenes/reminders";

export function RemindersTeachingEmptyState({
  onNewReminder,
}: {
  /** Opens the New Reminder dialog. Omitted without edit access to Reminders. */
  onNewReminder?: () => void;
}) {
  return (
    <TeachingEmptyState
      icon={Bell}
      illustration={<RemindersEmptyArt />}
      headline="What needs doing, and when"
      body="Put a date on anything you must not miss. It stays here until you mark it done."
      primaryAction={
        onNewReminder
          ? {
              label: "New reminder",
              onClick: onNewReminder,
              icon: Plus,
              hint: "Give it a title, a date and time, and how urgent it is.",
            }
          : undefined
      }
    />
  );
}
