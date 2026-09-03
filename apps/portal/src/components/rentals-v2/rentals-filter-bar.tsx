"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Search, SlidersHorizontal } from "lucide-react";
import { Input } from "@/components/ui-v2/input";
import { RentalFilters } from "@/hooks/use-enhanced-rentals";
import {
  RentalsFilterPanel,
  countActiveRentalFilters,
} from "@/components/rentals-v2/rentals-filter-panel";

interface Props {
  filters: RentalFilters;
  onFiltersChange: (next: RentalFilters) => void;
  onClearFilters: () => void;
}

/**
 * The v2 rentals filter surface: a search field with the filter toggle sitting
 * inside it, and the panel it opens.
 *
 * This exists so the branch in `(dashboard)/rentals/page.tsx` is a single
 * swap of one component for one component — v1's `RentalsFilters` owned the
 * search box as well as the filters, so a panel alone would have taken search
 * off the screen for the canary. Everything the old bar did, this does; the
 * props are deliberately the same three the v1 component takes.
 *
 * It changes no filter semantics. It writes the same `RentalFilters` keys, to
 * the same `onFiltersChange` the page already owns, which serialises them to
 * the same query string the same hook already reads.
 */
export function RentalsFilterBar({ filters, onFiltersChange, onClearFilters }: Props) {
  const [showFilters, setShowFilters] = useState(false);
  const activeFilterCount = countActiveRentalFilters(filters);

  const reduceMotion = useReducedMotion();
  const swap = reduceMotion
    ? { duration: 0 }
    : { duration: 0.2, ease: [0.22, 1, 0.36, 1] as const };

  // Search is debounced into the URL rather than pushed per keystroke: each
  // push is a navigation, so a twenty-character term would be twenty of them.
  const [searchInput, setSearchInput] = useState(filters.search || "");
  useEffect(() => {
    setSearchInput(filters.search || "");
  }, [filters.search]);
  useEffect(() => {
    const t = setTimeout(() => {
      if (searchInput !== (filters.search || "")) {
        onFiltersChange({ ...filters, search: searchInput, page: 1 });
      }
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);


  return (
    <div className="space-y-4">
      <div className="group relative w-full sm:max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary" />
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search customer, reg, rental #…"
          className="border-border/60 bg-card pl-9 pr-11 shadow-sm transition-all placeholder:text-muted-foreground/70 hover:border-primary/30 focus-visible:border-primary focus-visible:bg-background"
        />
        <button
          type="button"
          aria-label={showFilters ? "Hide filters" : "Show filters"}
          aria-pressed={showFilters}
          onClick={() => setShowFilters((v) => !v)}
          className={`absolute right-1.5 top-1/2 flex size-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg transition-colors ${
            showFilters
              ? "bg-primary text-primary-foreground"
              : "bg-primary/10 text-primary hover:bg-primary/20"
          }`}
        >
          <SlidersHorizontal className="size-4" />
          {/* Only while the panel is shut. Open, the chips say it better —
              and closed, this is the sole thing on screen telling you the
              list you are reading is not the whole list. */}
          {!showFilters && activeFilterCount > 0 && (
            <span className="absolute -right-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
              {activeFilterCount}
            </span>
          )}
        </button>
      </div>

      <AnimatePresence initial={false}>
        {showFilters && (
          <motion.div
            key="filters"
            initial={{ opacity: 0, scale: 0.985 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.985 }}
            transition={swap}
          >
            <RentalsFilterPanel
              filters={filters}
              onChange={onFiltersChange}
              onClear={onClearFilters}
              onClose={() => setShowFilters(false)}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
