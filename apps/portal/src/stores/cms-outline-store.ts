import { create } from "zustand";

/**
 * The outline of the page open in the CMS visual editor, shared with the
 * sidebar.
 *
 * The sections live in an IFRAME — the embedded website reports them over
 * postMessage — and they are drawn in the SIDEBAR, which is a different
 * component tree entirely. There is no common ancestor to lift the state into
 * that is not the whole dashboard layout, so it goes in a store.
 *
 * Deliberately not React Query: this is not server state. Nothing here is
 * fetched, cached or revalidated — it is a live description of what the
 * embedded page is currently showing, and it is worthless the moment the
 * editor unmounts (which is why `clear()` exists and the editor calls it).
 *
 * `pick` is the reverse channel. The sidebar cannot postMessage into the
 * iframe itself — it has no ref to it — so the editor registers a callback
 * here and the sidebar invokes it. That keeps the iframe's origin check and
 * message protocol in one file instead of spreading it across the chrome.
 */

export type CmsOutlineSection = { id: string; label: string };

interface CmsOutlineState {
  /** Sections of the page currently open, in document order. Empty when the visual editor is not mounted. */
  sections: CmsOutlineSection[];
  /** The section the reader is looking at, or has just focused a field in. */
  activeId: string | null;
  /** Section ids carrying an unpublished edit. */
  dirtyIds: string[];
  /** Scrolls the embedded site to a section. Registered by the editor. */
  pick: ((id: string) => void) | null;

  setSections: (sections: CmsOutlineSection[]) => void;
  setActiveId: (id: string | null) => void;
  setDirtyIds: (ids: string[]) => void;
  setPick: (pick: ((id: string) => void) | null) => void;
  clear: () => void;
}

const EMPTY: CmsOutlineSection[] = [];

export const useCmsOutline = create<CmsOutlineState>((set) => ({
  sections: EMPTY,
  activeId: null,
  dirtyIds: [],
  pick: null,

  // Each setter no-ops when the value has not actually changed. The editor
  // republishes on every message from the iframe — including the ones fired by
  // its own MutationObserver — so without this the sidebar re-renders on every
  // keystroke of an edit happening two component trees away.
  setSections: (sections) =>
    set((s) =>
      s.sections.length === sections.length &&
      s.sections.every((x, i) => x.id === sections[i].id && x.label === sections[i].label)
        ? s
        : { sections }
    ),
  setActiveId: (activeId) => set((s) => (s.activeId === activeId ? s : { activeId })),
  setDirtyIds: (dirtyIds) =>
    set((s) =>
      s.dirtyIds.length === dirtyIds.length && s.dirtyIds.every((x, i) => x === dirtyIds[i])
        ? s
        : { dirtyIds }
    ),
  setPick: (pick) => set({ pick }),
  clear: () => set({ sections: EMPTY, activeId: null, dirtyIds: [], pick: null }),
}));
