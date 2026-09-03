"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
// The source worktree drew these in `@phosphor-icons/react`, which is not a
// dependency here and is not being added for a canary. Remaps:
//   MagnifyingGlass → Search   WarningCircle → AlertCircle
//   IdentificationCard → Hash (the same mark `global-search` already uses for
//   plates, so the two surfaces stay consistent)
//   Signature → FileSignature
import {
  Search,
  ArrowLeft,
  X,
  Users,
  Car,
  FileText,
  AlertCircle,
  CreditCard,
  Hash,
  ShieldCheck,
  Receipt,
  FileSignature,
} from "lucide-react";
import { useTenant } from "@/contexts/TenantContext";
import { searchService, type SearchResults } from "@/lib/search-service";

/**
 * What the field types out on a loop when it's empty.
 *
 * The verb is doing the work. Every hint used to be a record lookup, which
 * quietly taught operators the box only finds rows — so it got used like a
 * filing cabinet. Rotating the phrasing demonstrates the range of what the one
 * control will match, with no badge, no label and no extra pixel of chrome.
 *
 * Every line is kept under ~28 characters: the rail gives the placeholder
 * roughly 180px before it would reach the ⌘K badge.
 *
 * NOTE — divergence from the source worktree, deliberate. There the field is
 * also the door into Trax, so half these hints were "Ask …" / "Get help with …"
 * and the scene had a second, conversational lane. That lane needs
 * `use-chat-threads`, `stores/trax-rail-store` and the `trax/` message +
 * composer components, none of which exist on this branch, and none of which
 * this task is scoped to create. Advertising "Ask what's overdue" in a field
 * that can only ever run a record lookup would be a promise the rail cannot
 * keep, so the hints here describe what this build actually does. Trax is still
 * reachable from its own header button.
 */
export const SEARCH_HINTS = [
  "Search Model 3",
  "Search 8XKD214",
  "Search jordan@gmail.com",
  "Search R-4f2a9c",
  "Search unpaid fines",
  "Search POL-88213",
  "Search a booking ref",
  "Search by phone number",
  "Search this month's rentals",
  "Search a plate",
  "Search Bonzah policies",
  "Search speeding fines",
];

/**
 * Types one hint out a character at a time, holds it, deletes it, then moves
 * to the next. Goes quiet whenever `active` is false — the field having real
 * text, or the sidebar being collapsed — so the animation never competes with
 * something the user is actually typing.
 */
export function useTypedHint(active: boolean) {
  const [text, setText] = useState("");
  const [index, setIndex] = useState(0);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!active) return;
    const hint = SEARCH_HINTS[index % SEARCH_HINTS.length];

    if (!deleting && text === hint) {
      const hold = setTimeout(() => setDeleting(true), 1800);
      return () => clearTimeout(hold);
    }
    if (deleting && text === "") {
      setDeleting(false);
      setIndex((i) => (i + 1) % SEARCH_HINTS.length);
      return;
    }
    const tick = setTimeout(
      () => setText(hint.slice(0, text.length + (deleting ? -1 : 1))),
      deleting ? 35 : 70
    );
    return () => clearTimeout(tick);
  }, [active, text, deleting, index]);

  return text;
}

/**
 * Tappable examples for an empty field.
 *
 * Hard-coded for now. Once queries are logged this becomes the real top ten,
 * which is why the heading says "Popular" rather than "Try an example".
 */
const POPULAR = [
  "Model 3",
  "R-4f2a9c",
  "jordan@gmail.com",
  "8XKD214",
  "POL-88213",
  "speeding",
];

/**
 * Result buckets in the order they read best in a narrow rail — the entities
 * an operator reaches for most sit at the top. `insurance` (policies) and
 * `insurances` (uploaded documents) are two different buckets on SearchResults
 * despite the near-identical names, so both are listed with distinct labels.
 */
const GROUPS: { key: keyof SearchResults; label: string; icon: any }[] = [
  { key: "customers", label: "Customers", icon: Users },
  { key: "rentals", label: "Rentals", icon: FileText },
  { key: "vehicles", label: "Vehicles", icon: Car },
  { key: "invoices", label: "Invoices", icon: Receipt },
  { key: "payments", label: "Payments", icon: CreditCard },
  { key: "fines", label: "Fines", icon: AlertCircle },
  { key: "plates", label: "Plates", icon: Hash },
  { key: "insurance", label: "Policies", icon: ShieldCheck },
  { key: "insurances", label: "Insurance docs", icon: ShieldCheck },
  { key: "agreements", label: "Agreements", icon: FileSignature },
];

interface Props {
  query: string;
  onQueryChange: (next: string) => void;
  /** Leave the scene and put the normal navigation back. */
  onClose: () => void;
}

/**
 * The sidebar's search mode. Replaces the whole nav rail rather than opening a
 * modal over it, so the results sit exactly where the field that produced them
 * is — the rail becomes the result list until it's dismissed.
 *
 * The field stays pinned to the TOP: you clicked the search box at the top of
 * the rail, so the caret stays exactly where you put it.
 */
export function SidebarSearchScene({ query, onQueryChange, onClose }: Props) {
  const { tenant } = useTenant();
  const router = useRouter();
  const [debounced, setDebounced] = useState(query);
  const inputRef = useRef<HTMLInputElement>(null);

  // Same 250ms the command dialog uses — keeps the two surfaces feeling alike
  // and stops a per-keystroke round trip across ten tables.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  // The scene replaces the rail's own field, so the caret has to land here or
  // the click that opened it would have nowhere to type.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Escape leaves the scene and puts the nav back.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const term = debounced.trim();

  const { data, isFetching } = useQuery({
    queryKey: ["sidebar-search", term, tenant?.id],
    queryFn: () =>
      searchService.searchAll(term, "all", tenant?.id, tenant?.currency_code || "USD"),
    // `!!tenant` is load-bearing, not a loading nicety: `searchAll` scopes every
    // one of its ten table reads by the tenant id it is handed, so firing it
    // before the tenant resolves would run them unscoped.
    enabled: term.length > 0 && !!tenant?.id,
    staleTime: 30_000,
  });

  const groups = useMemo(
    () =>
      data
        ? GROUPS.map((g) => ({ ...g, items: data[g.key] ?? [] })).filter((g) => g.items.length > 0)
        : [],
    [data]
  );
  const total = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Field — carries the query in from the rail, styled to match it so the
          swap reads as the same control rather than a new one. */}
      <div className="p-1.5 pb-1">
        <div className="flex h-8 w-full items-center gap-2 rounded-lg bg-primary/[0.07] px-2.5 ring-2 ring-inset ring-primary/40">
          <Search className="h-3.5 w-3.5 shrink-0 text-primary" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              // Enter follows what actually matched: typing a plate and
              // pressing Enter opens the vehicle.
              const topHit = groups[0]?.items[0];
              if (topHit) {
                router.push(topHit.url);
                onClose();
              }
            }}
            placeholder="Search anything"
            aria-label="Search anything"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
          />
          {query && (
            <button
              type="button"
              onClick={() => onQueryChange("")}
              aria-label="Clear search"
              className="shrink-0 cursor-pointer rounded text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Status + the way back out */}
      <div className="flex items-center justify-between gap-2 px-3 pb-1.5 text-[11px]">
        <span className="truncate text-muted-foreground">
          {!term ? "" : isFetching ? "Searching…" : `${total} result${total === 1 ? "" : "s"}`}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="flex shrink-0 cursor-pointer items-center gap-1 font-medium text-primary transition-colors hover:text-primary/80"
        >
          <ArrowLeft className="h-3 w-3" />
          Menu
        </button>
      </div>

      {/* `no-scrollbar` is a utility the source worktree defines in its own
          globals.css; this branch does not have it and globals.css is out of
          scope here, so the same two rules are inlined as arbitrary variants. */}
      <div className="min-h-0 flex-1 overflow-auto px-1.5 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {!term ? (
          <div>
            <SectionHeading>Popular</SectionHeading>
            {POPULAR.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                title={suggestion}
                onClick={() => onQueryChange(suggestion)}
                className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-muted-foreground transition-colors hover:bg-primary/[0.07] hover:text-foreground"
              >
                <Search className="h-3 w-3 shrink-0 opacity-60" />
                <span className="truncate font-mono">{suggestion}</span>
              </button>
            ))}
          </div>
        ) : total === 0 && !isFetching ? (
          <p className="px-3 py-8 text-center text-[12px] leading-relaxed text-muted-foreground">
            No matches for
            <br />
            <span className="font-medium text-foreground">“{term}”</span>
          </p>
        ) : (
          groups.map((group) => (
            <div key={group.key} className="mb-2">
              <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                <group.icon className="h-3 w-3 shrink-0" />
                <span className="truncate">{group.label}</span>
                <span className="ml-auto shrink-0 rounded bg-primary/10 px-1.5 text-[10px] text-primary">
                  {group.items.length}
                </span>
              </div>
              {group.items.map((item) => (
                <Link
                  key={`${group.key}-${item.id}`}
                  href={item.url}
                  onClick={onClose}
                  className="block rounded-md px-2 py-1.5 transition-colors hover:bg-primary/[0.07]"
                >
                  <div className="truncate text-[13px] font-medium text-foreground">
                    {item.title}
                  </div>
                  {item.subtitle && (
                    <div className="truncate text-[11px] text-muted-foreground">
                      {item.subtitle}
                    </div>
                  )}
                </Link>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function SectionHeading({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground ${className}`}
    >
      {children}
    </div>
  );
}
