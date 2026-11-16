/**
 * The phone tab bar's Search (mobile-tab-bar.tsx) asks the top bar
 * (top-bar-v2.tsx) to open search with this window event; the top bar owns
 * the page field and the global dialog. Its own module so the top bar does
 * not import the tab bar (and its permission hooks) just for a name.
 */
export const OPEN_PHONE_SEARCH_EVENT = "open-phone-search";
