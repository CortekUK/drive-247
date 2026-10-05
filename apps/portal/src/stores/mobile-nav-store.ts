import { create } from "zustand";

/**
 * The phone's "More" screen (v2 chrome, northwind) — its open state, and the
 * navigation it lists.
 *
 * WHY THE NAV IS PUBLISHED RATHER THAN RECOMPUTED. Everything a row needs to
 * decide whether it exists — manager grants, lean-hidden areas, tenant feature
 * switches, the user's own sidebar arrangement, badge counts — is resolved in
 * exactly one place, `app-sidebar-v2.tsx`. A second copy of that logic here
 * would be a second answer to "what may this person open", and the two would
 * drift. So the sidebar, which is always mounted under the v2 chrome (on a
 * phone as a closed sheet), publishes what it computed and this screen only
 * draws it.
 */

export interface MobileNavItem {
  name: string;
  href: string;
  icon: any;
  badge?: number;
  badgeTone?: "destructive" | "amber";
}

export interface MobileNavGroup {
  label: string;
  items: MobileNavItem[];
}

export interface MobileCmsPage {
  id: string;
  name: string;
  href: string;
  icon: any;
  published: boolean;
}

export interface MobileNavModel {
  /** The flat daily rows (Availability, Agreements, Finances, Support…). */
  more: MobileNavItem[];
  /** Second-level groups (Bookings, Fleet, Pipeline, Owners, Finance, Records). */
  groups: MobileNavGroup[];
  /** The tenant's website pages, for the Website half of the switch. */
  cmsPages: MobileCmsPage[];
  canSeeCms: boolean;
}

interface MobileNavState {
  open: boolean;
  setOpen: (open: boolean) => void;
  model: MobileNavModel;
  setModel: (model: MobileNavModel) => void;
}

export const useMobileNavStore = create<MobileNavState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  model: { more: [], groups: [], cmsPages: [], canSeeCms: false },
  setModel: (model) => set({ model }),
}));
