import { create } from "zustand";

export type FeedbackCategory = "bug" | "improvement" | "feature_request" | "note";

/**
 * Which entry point opened the dialog. These exact strings are persisted to
 * `tenant_feedback.source`, which carries a matching CHECK constraint — a typo
 * here becomes a failed insert, not a bad analytics label.
 */
export type FeedbackSource = "sidebar" | "rental_close" | "forced";

/**
 * Why a store and not local state: three unrelated call sites open the SAME
 * dialog — the sidebar button, the rental-completion follow-up, and the
 * forced-next-login trigger in the dashboard layout. Routing that through
 * props would mean threading state through the whole layout tree.
 */
interface FeedbackState {
  isOpen: boolean;
  prefillCategory: FeedbackCategory | null;
  /** Where the dialog was opened from — recorded on the submission. */
  source: FeedbackSource | null;
  open: (opts?: { category?: FeedbackCategory; source?: FeedbackSource }) => void;
  close: () => void;
}

export const useFeedbackStore = create<FeedbackState>((set) => ({
  isOpen: false,
  prefillCategory: null,
  source: null,
  open: (opts) =>
    set({
      isOpen: true,
      prefillCategory: opts?.category ?? null,
      source: opts?.source ?? null,
    }),
  close: () => set({ isOpen: false, prefillCategory: null, source: null }),
}));
