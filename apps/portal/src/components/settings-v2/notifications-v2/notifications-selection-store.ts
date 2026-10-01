import { create } from "zustand";
import type { NotificationDirection } from "@/lib/notifications-v2/types";

/**
 * Which notification the v2 Notifications page has open, shared with the rail.
 *
 * The rail is the SIDEBAR (app-sidebar-v2 swaps itself for
 * notifications-rail.tsx on `/settings?tab=notifications`) and the editors are
 * the settings page body: two component trees with no common ancestor short of
 * the dashboard layout, so the choice lives here (as cms-outline-store does).
 *
 * Deliberately NOT in the URL: the settings page's leave guard treats any
 * change of search as leaving the page, so picking another notification with
 * an unsaved edit would ask "Save or discard?" although nothing is being left.
 * Drafts are page state keyed per notification, so moving between them is safe.
 */

/** The rail's "Setups" entry: channel setup and What's sent today. */
export const NOTIFICATIONS_SETUP = "setup";

/** The four setups behind the rail's Setups menu. */
export type SetupSection = "email" | "push" | "in_app" | "today";

/** Which of the chosen notification's two messages is open (nested under it in the list). */
export type NotificationMessageKind = "app" | "email";

interface NotificationsSelectionState {
  /** A catalog item key, NOTIFICATIONS_SETUP, or null before the page picks its first. */
  selected: string | null;
  /** Which way the rail lists: messages to your team, or to customers. */
  side: NotificationDirection;
  /** App message or Email; reset to App message when another notification is chosen. */
  message: NotificationMessageKind;
  search: string;
  /** Which setup is open while `selected` is NOTIFICATIONS_SETUP. */
  setupSection: SetupSection;
  /** Item keys carrying an unsaved edit, published by the page for the rail's dots. */
  pending: string[];

  select: (key: string, side?: NotificationDirection, message?: NotificationMessageKind) => void;
  setMessage: (message: NotificationMessageKind) => void;
  openSetup: (section: SetupSection) => void;
  setSide: (side: NotificationDirection) => void;
  setSearch: (search: string) => void;
  setPending: (keys: string[]) => void;
  reset: () => void;
}

const INITIAL = {
  selected: null,
  side: "customer_to_team" as NotificationDirection,
  message: "app" as NotificationMessageKind,
  search: "",
  setupSection: "email" as SetupSection,
  pending: [] as string[],
};

export const useNotificationsSelection = create<NotificationsSelectionState>((set, get) => ({
  ...INITIAL,
  select: (key, side, message) => {
    const next: Partial<NotificationsSelectionState> = { selected: key };
    if (side && side !== get().side) next.side = side;
    if (message) next.message = message;
    else if (key !== get().selected) next.message = "app";
    set(next);
  },
  setMessage: (message) => set({ message }),
  openSetup: (setupSection) => set({ selected: NOTIFICATIONS_SETUP, setupSection }),
  setSide: (side) => set({ side }),
  setSearch: (search) => set({ search }),
  setPending: (keys) => {
    const current = get().pending;
    if (current.length === keys.length && current.every((k, i) => k === keys[i])) return;
    set({ pending: keys });
  },
  reset: () => set(INITIAL),
}));
