import { create } from 'zustand';
import type { SystemNotificationDirection } from '@/lib/notifications-v2/catalog';

/**
 * Which notification the full-screen Notifications view has open, shared by its
 * left list (system-notifications-rail.tsx) and the page. The twin of the
 * operator portal's notifications-selection-store, with this dashboard's three
 * directions. Not in the URL, so moving between notifications never looks like
 * leaving the page.
 */

/** The list's "Setups" entry. */
export const SYSTEM_NOTIFICATIONS_SETUP = 'setup';

/** The setups behind the Setups entry. */
export type SystemSetupSection = 'email' | 'push';

/** Which of the chosen notification's two messages is open (nested under it in the list). */
export type SystemMessageKind = 'app' | 'email';

interface SystemNotificationsSelectionState {
  /** A catalog item key, SYSTEM_NOTIFICATIONS_SETUP, or null before the page picks its first. */
  selected: string | null;
  /** Which direction the list shows. */
  side: SystemNotificationDirection;
  /** App message or Email; back to App message when another notification is chosen. */
  message: SystemMessageKind;
  search: string;
  /** Which setup is open while `selected` is SYSTEM_NOTIFICATIONS_SETUP. */
  setupSection: SystemSetupSection;
  /** Item keys carrying an unsaved edit, published by the page for the list's dots. */
  pending: string[];

  select: (key: string, side?: SystemNotificationDirection, message?: SystemMessageKind) => void;
  setMessage: (message: SystemMessageKind) => void;
  openSetup: (section: SystemSetupSection) => void;
  setSide: (side: SystemNotificationDirection) => void;
  setSearch: (search: string) => void;
  setPending: (keys: string[]) => void;
  reset: () => void;
}

const INITIAL = {
  selected: null,
  side: 'super_admin_to_admin' as SystemNotificationDirection,
  message: 'app' as SystemMessageKind,
  search: '',
  setupSection: 'email' as SystemSetupSection,
  pending: [] as string[],
};

export const useSystemNotificationsSelection = create<SystemNotificationsSelectionState>((set, get) => ({
  ...INITIAL,
  select: (key, side, message) => {
    const next: Partial<SystemNotificationsSelectionState> = { selected: key };
    if (side && side !== get().side) next.side = side;
    if (message) next.message = message;
    else if (key !== get().selected) next.message = 'app';
    set(next);
  },
  setMessage: (message) => set({ message }),
  openSetup: (setupSection) => set({ selected: SYSTEM_NOTIFICATIONS_SETUP, setupSection }),
  setSide: (side) => set({ side }),
  setSearch: (search) => set({ search }),
  setPending: (keys) => {
    const current = get().pending;
    if (current.length === keys.length && current.every((k, i) => k === keys[i])) return;
    set({ pending: keys });
  },
  reset: () => set(INITIAL),
}));
