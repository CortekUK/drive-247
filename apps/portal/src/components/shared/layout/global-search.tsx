"use client";

import { useCallback, useEffect } from "react";
import { useGuardedRouter } from "@/lib/leave-guard";
import {
  Search,
  User,
  Car,
  Calendar,
  CalendarDays,
  AlertTriangle,
  CreditCard,
  Hash,
  Shield,
  Loader2,
  Filter,
  FileText,
  FileSignature,
  LayoutDashboard,
  Settings,
  Plug,
  LifeBuoy,
  Users,
  UserPlus,
  MapPin,
  Tag,
  Package,
  Bell,
  Newspaper,
  Sparkles,
  Compass,
  Globe,
  Clock,
  Receipt,
  Wrench,
  Wallet,
  BarChart3,
  TrendingUp,
  Crown,
  MessageSquare,
  History,
  Workflow,
  Link2,
  ArrowUpRight,
  CornerDownLeft,
  Gift,
} from "lucide-react";
import {
  Command,
  CommandDialog,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useGlobalSearch } from "@/hooks/use-global-search";
import { SearchResult } from "@/lib/search-service";
import { useTenant } from "@/contexts/TenantContext";
import { toast } from "@/hooks/use-toast";

const ICONS: Record<string, typeof Search> = {
  user: User,
  users: Users,
  "user-plus": UserPlus,
  car: Car,
  calendar: Calendar,
  "calendar-days": CalendarDays,
  "alert-triangle": AlertTriangle,
  "credit-card": CreditCard,
  hash: Hash,
  shield: Shield,
  "file-text": FileText,
  "file-signature": FileSignature,
  dashboard: LayoutDashboard,
  settings: Settings,
  plug: Plug,
  "life-buoy": LifeBuoy,
  "map-pin": MapPin,
  tag: Tag,
  package: Package,
  bell: Bell,
  newspaper: Newspaper,
  sparkles: Sparkles,
  compass: Compass,
  globe: Globe,
  clock: Clock,
  receipt: Receipt,
  wrench: Wrench,
  wallet: Wallet,
  "bar-chart": BarChart3,
  "trending-up": TrendingUp,
  crown: Crown,
  gift: Gift,
  "message-square": MessageSquare,
  history: History,
  workflow: Workflow,
};

const getIcon = (iconName: string) => ICONS[iconName] ?? Search;

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

/** One keyboard hint in the footer, e.g. "↵ Open". */
const Hint = ({ keys, label }: { keys: string; label: string }) => (
  <span className="flex items-center gap-1.5">
    <kbd className="rounded border border-border/60 bg-muted/70 px-1.5 py-0.5 font-mono text-[10px] leading-none text-muted-foreground">{keys}</kbd>
    <span>{label}</span>
  </span>
);

interface GlobalSearchProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * The portal's ⌘K search: a list of matches on the left, a preview of the
 * highlighted one on the right, and the keys you can press along the bottom.
 *
 * What it searches, and the rules deciding what a person may see, are in
 * hooks/use-global-search.ts; this file is the window.
 */
export const GlobalSearch = ({ open, onOpenChange }: GlobalSearchProps) => {
  // Asks a v2 page with unsaved edits first; exactly useRouter() everywhere else.
  const router = useGuardedRouter();
  const { tenant } = useTenant();
  const tenantName = tenant?.app_name || tenant?.company_name || null;
  const {
    query,
    setQuery,
    groups,
    filterOptions,
    isLoading,
    totalResults,
    hasQuery,
    entityFilter,
    setEntityFilter,
    activeIndex,
    selectedResult,
    allResults,
    remember,
    setSelectedIndex,
    navigateUp,
    navigateDown,
    getSelectedResult,
  } = useGlobalSearch();

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
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      contentClassName="max-w-[860px] gap-0 border-border/70"
      title="Search"
      description="Type to search your portal. Use the up and down arrows to move, Enter to open."
    >
      <Command shouldFilter={false} className="rounded-xl">
        {/* Search field and filter. The dialog draws its own close button in the corner. */}
        <div className="flex items-center gap-2 border-b px-4 py-3 pr-12">
          <Search className="h-4 w-4 shrink-0 text-primary" />
          {/* A plain input, not cmdk's: that one brings its own icon and border,
              and this palette filters and highlights rows itself. */}
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tenantName ? `Search or ask for anything in ${tenantName}…` : "Search pages, settings, support, customers, vehicles…"}
            aria-label="Search"
            className="h-8 w-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
          />
          <Select value={entityFilter} onValueChange={setEntityFilter}>
            <SelectTrigger className="h-8 w-28 shrink-0 border-border/60 bg-background text-xs font-medium shadow-sm sm:w-36">
              <Filter className="mr-1.5 h-3.5 w-3.5" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-lg">
              {/* Only what this user can search — see use-global-search.ts. */}
              {filterOptions.map((option) => (
                <SelectItem key={option.value} value={option.value} className={option.value === "all" ? "font-medium" : undefined}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Results, and a preview of the highlighted one */}
        <div className="flex h-[430px]">
          <CommandList className="w-full max-h-none overflow-y-auto border-r p-2 md:w-1/2">
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
              <div key={group.key} className="mb-2">
                <div className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/80">
                  {group.title}
                </div>
                {group.items.map((item) => {
                  rowIndex += 1;
                  const index = rowIndex;
                  const Icon = getIcon(item.icon || "search");
                  const isSelected = index === activeIndex;
                  return (
                    <button
                      key={`${group.key}-${item.id}`}
                      type="button"
                      onMouseEnter={() => setSelectedIndex(index)}
                      onClick={() => openResult(item)}
                      className={`group flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors ${
                        isSelected ? "bg-primary/10 dark:bg-muted" : "hover:bg-muted/60"
                      }`}
                    >
                      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${isSelected ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-foreground">{item.title}</span>
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

          {/* Preview */}
          <aside className="hidden w-1/2 flex-col overflow-y-auto p-5 md:flex">
            {selectedResult ? (
              <PreviewPanel
                result={selectedResult}
                onOpen={() => openResult(selectedResult)}
                onCopy={() => void copyLink(selectedResult)}
                onNewTab={() => openInNewTab(selectedResult)}
              />
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
                  <Search className="h-5 w-5 text-muted-foreground" />
                </span>
                <p className="text-sm font-medium">Search your whole portal</p>
                <p className="max-w-[240px] text-xs text-muted-foreground">
                  Pages, settings, integrations, support tickets, customers, vehicles, rentals, payments and more.
                </p>
              </div>
            )}
          </aside>
        </div>

        {/* Keys, and how many matched */}
        <div className="flex items-center justify-between gap-3 border-t px-4 py-2 text-[11px] text-muted-foreground">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <Hint keys="↑↓" label="Navigate" />
            <Hint keys="↵" label="Open" />
            <span className="hidden sm:flex"><Hint keys="⌘↵" label="Open in new tab" /></span>
            <span className="hidden sm:flex"><Hint keys="⌘L" label="Copy link" /></span>
            <Hint keys="Esc" label="Close" />
          </div>
          <span className="shrink-0">
            {hasQuery ? `${totalResults} ${totalResults === 1 ? "result" : "results"}` : "Recent and suggested"}
          </span>
        </div>
      </Command>
    </CommandDialog>
  );
};

/** The right-hand side: what the highlighted result is, and what to do with it. */
const PreviewPanel = ({
  result,
  onOpen,
  onCopy,
  onNewTab,
}: {
  result: SearchResult;
  onOpen: () => void;
  onCopy: () => void;
  onNewTab: () => void;
}) => {
  const Icon = getIcon(result.icon || "search");
  const details = result.details ?? [];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </span>
        <div className="flex items-center gap-1">
          <button type="button" onClick={onCopy} aria-label="Copy link" className="rounded-md border border-border/60 p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <Link2 className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={onNewTab} aria-label="Open in a new tab" className="rounded-md border border-border/60 p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <ArrowUpRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {result.badges && result.badges.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          {result.badges.map((badge, i) => (
            <span
              key={`${badge}-${i}`}
              className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${
                i === 0 ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
              }`}
            >
              {badge}
            </span>
          ))}
        </div>
      )}

      <h3 className="mt-3 text-lg font-semibold leading-tight text-foreground">{result.title}</h3>
      <p className="mt-1 text-xs text-muted-foreground">{result.description || result.subtitle}</p>

      {details.length > 0 && (
        <dl className="mt-5 space-y-0 border-t">
          {details.map((d, i) => (
            <div key={`${d.label}-${i}`} className="flex items-start justify-between gap-4 border-b py-2.5">
              <dt className="text-xs text-muted-foreground">{d.label}</dt>
              <dd className="max-w-[60%] truncate text-right text-xs font-medium text-foreground">{d.value}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="mt-auto flex items-center gap-2 pt-5">
        <Button onClick={onOpen} className="flex-1">
          {result.openLabel || "Open"}
        </Button>
        <Button variant="outline" onClick={onCopy}>
          Copy link
        </Button>
      </div>
    </div>
  );
};
