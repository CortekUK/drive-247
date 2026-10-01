"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useGuardedRouter } from "@/lib/leave-guard";
import { Search, Loader2, CornerDownLeft } from "lucide-react";
import { Command, CommandList, CommandShortcut } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SIDEBAR_HIGHLIGHT_ACTIVE } from "@/components/ui-v2/sidebar";
import { useGlobalSearch } from "@/hooks/use-global-search";
import { SearchResult } from "@/lib/search-service";
import { useTenant } from "@/contexts/TenantContext";
import { toast } from "@/hooks/use-toast";
import { SearchTraxBrief, SearchTraxIdle } from "@/components/shared/layout/search-trax-brief";
import { useTraxOptional } from "@/components/trax/trax-provider";
import { useTraxSupportOptional } from "@/components/trax/support/trax-support-context";
import type { BriefKind } from "@/hooks/use-search-brief";

interface SearchTriggerProps {
  onClick: () => void;
}

export const SearchTrigger = ({ onClick }: SearchTriggerProps) => {
  return (
    <Button
      variant="ghost"
      onClick={onClick}
      className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors w-full justify-start"
    >
      <Search className="h-4 w-4" />
      <span className="text-sm">Search everything...</span>
      <CommandShortcut className="ml-auto">⌘K</CommandShortcut>
    </Button>
  );
};

interface GlobalSearchProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Seeds the field when the dialog opens. The top bar passes the term a list
   *  page's field was holding when the operator chose "Search everywhere". */
  initialQuery?: string;
}

/**
 * The v2 ⌘K search: a list of matches on the left, Trax on the right telling you
 * the useful part about the highlighted one, and the keys along the bottom.
 * "Continue with Trax" carries that into a real Trax conversation.
 *
 * A copy of global-search.tsx, which v1 still mounts through header-search.tsx
 * and stays as it is. Only the v2 top bar mounts this one. What it searches, and
 * the rules deciding what a person may see, are shared: hooks/use-global-search.ts.
 */
export const GlobalSearchV2 = ({ open, onOpenChange, initialQuery }: GlobalSearchProps) => {
  // Asks a v2 page with unsaved edits first; exactly useRouter() everywhere else.
  const router = useGuardedRouter();
  const { tenant } = useTenant();
  const tenantName = tenant?.app_name || tenant?.company_name || null;
  const {
    query,
    setQuery,
    groups,
    isLoading,
    hasQuery,
    selectedIndex,
    allResults,
    remember,
    setSelectedIndex,
    navigateUp,
    navigateDown,
    getSelectedResult,
  } = useGlobalSearch();
  /* Nothing is picked until the operator moves to a row (arrows or the mouse):
     the shared hook falls back to the first row for Enter, but this window shows
     no highlight and Trax's empty state until something is actually chosen. */
  const picked = selectedIndex >= 0 && selectedIndex < allResults.length;
  const selectedResult = picked ? allResults[selectedIndex] : null;
  useEffect(() => {
    if (open) setSelectedIndex(-1);
  }, [open, setSelectedIndex]);
  useEffect(() => {
    if (open && initialQuery) setQuery(initialQuery);
    // Only on open: re-seeding while the dialog is up would overwrite typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // After useGlobalSearch: it reads `query`, which is declared there.
  const placeholder = useTypedPlaceholder(open && !query, tenantName);

  const pathname = usePathname();
  const trax = useTraxOptional();
  const traxSupport = useTraxSupportOptional();
  // The Trax link with nothing picked: just open the conversation.
  const openTrax = useCallback(() => {
    onOpenChange(false);
    trax?.openSheet();
  }, [onOpenChange, trax]);

  const [handoff, setHandoff] = useState<{ question: string; path: string | null } | null>(null);

  const absoluteUrl = (url: string) => (typeof window === "undefined" ? url : `${window.location.origin}${url}`);

  const openResult = useCallback(
    (result: SearchResult) => {
      remember(result);
      router.push(result.url);
      onOpenChange(false);
    },
    [remember, router, onOpenChange],
  );

  const openInNewTab = useCallback(
    (result: SearchResult) => {
      remember(result);
      window.open(result.url, "_blank", "noopener,noreferrer");
    },
    [remember],
  );

  const copyLink = useCallback(async (result: SearchResult) => {
    try {
      await navigator.clipboard.writeText(absoluteUrl(result.url));
      toast({ title: "Link copied", description: result.title });
    } catch {
      toast({ title: "Could not copy the link", description: "Your browser did not allow it.", variant: "destructive" });
    }
  }, []);

  /* "Continue with Trax": open the record (so Trax has it as page context),
     open the panel on a fresh thread, and ask the chosen question once Trax
     is ready on that page. The send waits in `handoff` because the panel's
     conversation only activates after it is shown. */
  const continueWithTrax = useCallback(
    (result: SearchResult, question: string, kind: BriefKind) => {
      remember(result);
      onOpenChange(false);
      const path = kind === "other" ? null : result.url;
      if (path && pathname !== path) router.push(path);
      if (traxSupport?.support.messages.length) traxSupport.startNew();
      trax?.openSheet();
      setHandoff({ question, path });
    },
    [remember, onOpenChange, pathname, router, trax, traxSupport],
  );

  const chat = traxSupport?.support;
  useEffect(() => {
    if (!handoff || !chat) return;
    if (handoff.path && pathname !== handoff.path) return;
    if (chat.isLoading) return;
    void chat.sendMessage(handoff.question);
    setHandoff(null);
  }, [handoff, chat, pathname]);

  // A navigation the leave guard refused never reaches the page: drop the ask.
  useEffect(() => {
    if (!handoff) return;
    const t = window.setTimeout(() => setHandoff(null), 15_000);
    return () => window.clearTimeout(t);
  }, [handoff]);

  // Keyboard: the four actions listed in the footer.
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (e.key === "ArrowUp") {
        e.preventDefault();
        navigateUp();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        navigateDown();
      } else if (e.key === "Enter") {
        e.preventDefault();
        const selected = getSelectedResult();
        if (selected) (meta ? openInNewTab : openResult)(selected);
      } else if (meta && (e.key === "l" || e.key === "L")) {
        const selected = getSelectedResult();
        if (selected) {
          e.preventDefault(); // otherwise the browser jumps to its address bar
          void copyLink(selected);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        onOpenChange(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, navigateUp, navigateDown, getSelectedResult, onOpenChange, openResult, openInNewTab, copyLink]);

  let rowIndex = -1;

  return (
    /* The shared CommandDialog's parts, composed here so the v2 search can blur
       the page behind it more than v1's does — CommandDialog takes no overlay class
       and is v1's to keep. */
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[900px] gap-0 overflow-hidden border-border/70 p-0 shadow-lg"
        overlayClassName="bg-black/50 backdrop-blur-md"
      >
        <DialogTitle className="sr-only">Search</DialogTitle>
        <DialogDescription className="sr-only">Type to search your portal. Use the up and down arrows to move, Enter to open.</DialogDescription>
      <Command shouldFilter={false} className="rounded-xl">
        {/* Two columns on one accent wash, each the full height of the window:
            searching on the left (a lighter veil over the wash, so the two sides
            read apart), Trax on the right. The dialog draws its close button in the top-right
            corner, over Trax. */}
        <div className="flex h-[540px] bg-gradient-to-br from-primary/20 via-primary/10 to-primary/25">
          <div className="flex w-full min-w-0 flex-col bg-background/60 pb-1.5 md:w-[42%] md:border-r">
            {/* Search field; it always searches everything. */}
            <div className="flex items-center gap-2 border-b px-4 py-3 pr-12 md:pr-4">
              <Search className="h-4 w-4 shrink-0 text-primary" />
              {/* A plain input, not cmdk's: that one brings its own icon and border,
                  and this palette filters and highlights rows itself. */}
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={placeholder}
                aria-label="Search"
                className="h-8 w-full min-w-0 flex-1 bg-transparent text-sm font-medium outline-none placeholder:font-semibold placeholder:text-foreground/80"
              />
            </div>

            <CommandList className="max-h-none min-h-0 flex-1 overflow-y-auto p-2 pb-1">
              {isLoading && allResults.length === 0 && (
                <div className="flex flex-col items-center justify-center gap-3 p-12">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  <span className="text-sm text-muted-foreground">Searching…</span>
                </div>
              )}

              {!isLoading && hasQuery && allResults.length === 0 && (
                <div className="space-y-2 p-10 text-center">
                  <p className="text-sm font-semibold">No results</p>
                  <p className="text-xs text-muted-foreground">
                    Nothing matches <span className="font-medium text-foreground">&quot;{query}&quot;</span>. Try fewer words, or a name, number or address.
                  </p>
                </div>
              )}

              {groups.map((group) => (
                <div key={group.key} className="mb-2 last:mb-0">
                  <div className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/80">
                    {group.title}
                  </div>
                  {group.items.map((item) => {
                    rowIndex += 1;
                    const index = rowIndex;
                    const isSelected = index === selectedIndex;
                    return (
                      <button
                        key={`${group.key}-${item.id}`}
                        type="button"
                        onMouseEnter={() => setSelectedIndex(index)}
                        onClick={() => openResult(item)}
                        className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
                          isSelected ? SIDEBAR_HIGHLIGHT_ACTIVE : ""
                        }`}
                      >
                        <span className="min-w-0 flex-1">
                          <span className={`block truncate text-[13px] font-medium ${isSelected ? "" : "text-foreground"}`}>{item.title}</span>
                          <span className="block truncate text-[11px] text-muted-foreground">{item.subtitle}</span>
                        </span>
                        {isSelected && (
                          <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}

              {isLoading && allResults.length > 0 && (
                <div className="flex items-center justify-center gap-2 py-3 text-[11px] text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Still searching your records…
                </div>
              )}
            </CommandList>
          </div>

          {/* Trax */}
          <aside className="hidden w-[58%] flex-col overflow-hidden md:flex">
            {selectedResult ? (
              <SearchTraxBrief
                key={selectedResult.url}
                result={selectedResult}
                onContinue={(question, kind) => continueWithTrax(selectedResult, question, kind)}
              />
            ) : (
              <SearchTraxIdle tenantName={tenantName} onOpenTrax={openTrax} />
            )}
          </aside>
        </div>
      </Command>
      </DialogContent>
    </Dialog>
  );
};

/**
 * What the search can find, typed into the empty field one example at a time,
 * so the field itself says what to type. Stops the moment anything is typed.
 * Each line is something the search really matches (lib/search-service.ts and
 * lib/search/portal-destinations.ts).
 */
const CAPABILITIES = [
  "a customer by name, email or phone",
  "a rental by its number",
  "a car by reg, make or VIN",
  "a payment by its amount",
  "an invoice, a fine or a promo code",
  "a page or a setting, like weekend pricing",
  "a team member, a lead or an enquiry",
];

function useTypedPlaceholder(active: boolean, tenantName: string | null): string {
  const resting = tenantName ? `Search ${tenantName}…` : "Search your portal…";
  const [text, setText] = useState(resting);

  useEffect(() => {
    if (!active) {
      setText(resting);
      return;
    }
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let line = 0;
    let chars = 0;
    let deleting = false;
    let timer: number;

    const tick = () => {
      const phrase = CAPABILITIES[line];
      if (reduced) {
        setText(`Find ${phrase}…`);
        line = (line + 1) % CAPABILITIES.length;
        timer = window.setTimeout(tick, 2600);
        return;
      }
      chars += deleting ? -1 : 1;
      setText(`Find ${phrase.slice(0, chars)}`);
      if (!deleting && chars === phrase.length) {
        deleting = true;
        timer = window.setTimeout(tick, 1600); // hold the full line
      } else if (deleting && chars === 0) {
        deleting = false;
        line = (line + 1) % CAPABILITIES.length;
        timer = window.setTimeout(tick, 250);
      } else {
        timer = window.setTimeout(tick, deleting ? 18 : 38);
      }
    };
    timer = window.setTimeout(tick, 600); // let the resting line show first
    return () => window.clearTimeout(timer);
  }, [active, resting]);

  return text;
}
