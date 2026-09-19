import type { SearchResult } from "@/lib/search-service";

/**
 * The last few things opened from the global search, shown under "Recent"
 * before anything is typed.
 *
 * Kept in this browser only. It is a convenience, never a record: it holds a
 * title and a link the user just opened, it is per browser profile, and every
 * read and write is wrapped because storage can be unavailable (private
 * windows, blocked site data) — where it is, the search simply shows no recents.
 */
const KEY = "drive247:recent-searches";
const MAX = 5;

export function loadRecentSearches(): SearchResult[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((r) => r && typeof r.url === "string" && typeof r.title === "string").slice(0, MAX) : [];
  } catch {
    return [];
  }
}

export function rememberRecentSearch(result: SearchResult): SearchResult[] {
  const entry: SearchResult = {
    id: result.id,
    title: result.title,
    subtitle: result.subtitle,
    category: result.category,
    url: result.url,
    icon: result.icon,
    badges: result.badges,
    details: result.details,
    description: result.description,
    openLabel: result.openLabel,
  };
  const next = [entry, ...loadRecentSearches().filter((r) => r.url !== entry.url)].slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable — the list is a convenience, not a record */
  }
  return next;
}
