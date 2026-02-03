"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  User,
  Car,
  Calendar,
  AlertTriangle,
  CreditCard,
  Hash,
  Shield,
  Loader2,
  Filter,
  FileText,
  File
} from "lucide-react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
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
import { isInsuranceExemptTenant } from "@/config/tenant-config";

// Entity icons - returns empty string (icons handled by Lucide components)
const getEntityEmoji = (category: string): string => {
  return "";
};

const getIcon = (iconName: string) => {
  switch (iconName) {
    case "user":
      return User;
    case "car":
      return Car;
    case "calendar":
      return Calendar;
    case "alert-triangle":
      return AlertTriangle;
    case "credit-card":
      return CreditCard;
    case "hash":
      return Hash;
    case "shield":
      return Shield;
    case "file-text":
      return FileText;
    case "file":
      return File;
    default:
      return Search;
  }
};

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
}

export const GlobalSearch = ({ open, onOpenChange }: GlobalSearchProps) => {
  const router = useRouter();
  const { tenant } = useTenant();
  const hideInsurance = isInsuranceExemptTenant(tenant?.id);
  const {
    query,
    setQuery,
    results,
    isLoading,
    totalResults,
    hasQuery,
    entityFilter,
    setEntityFilter,
    selectedIndex,
    navigateUp,
    navigateDown,
    getSelectedResult,
  } = useGlobalSearch();

  // Keyboard navigation
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowUp") {
        e.preventDefault();
        navigateUp();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        navigateDown();
      } else if (e.key === "Enter") {
        e.preventDefault();
        const selected = getSelectedResult();
        if (selected) {
          handleSelect(selected);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        onOpenChange(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, navigateUp, navigateDown, getSelectedResult, onOpenChange]);

  const handleSelect = (result: SearchResult) => {
    router.push(result.url);
    onOpenChange(false);
  };

  const renderGroup = (title: string, items: SearchResult[], emoji: string) => {
    if (items.length === 0) return null;

    return (
      <CommandGroup
        heading={
          <div className="flex items-center gap-2 px-2 py-1.5">
            {emoji && <span className="text-lg">{emoji}</span>}
            <span className="font-semibold text-xs uppercase tracking-wide text-foreground/70">{title}</span>
            <span className="ml-auto text-xs text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-full font-medium">
              {items.length}{items.length === 5 ? '+' : ''}
            </span>
          </div>
        }
        className="mb-2"
      >
        {items.map((item, index) => {
          const IconComponent = getIcon(item.icon || "search");
          const globalIndex = Object.values(results)
            .slice(0, Object.keys(results).indexOf(item.category.toLowerCase()))
            .flat().length + index;

          const isSelected = globalIndex === selectedIndex;

          return (
            <CommandItem
              key={`${item.category}-${item.id}`}
              onSelect={() => handleSelect(item)}
              className={`group flex items-center gap-3 p-3 mx-1 mb-1 cursor-pointer rounded-lg transition-all duration-150 border ${
                isSelected
                  ? 'bg-accent/50 border-primary/30 shadow-sm'
                  : 'border-transparent hover:border-border hover:bg-accent/30'
              }`}
            >
              <div className={`p-2 rounded-md transition-all duration-150 ${
                isSelected ? 'bg-primary/15' : 'bg-muted/60 group-hover:bg-muted'
              }`}>
                <IconComponent className={`h-4 w-4 transition-colors duration-150 ${
                  isSelected ? 'text-primary' : 'text-muted-foreground'
                }`} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm truncate text-foreground">{item.title}</div>
                <div className="text-xs text-muted-foreground truncate mt-0.5">{item.subtitle}</div>
              </div>
              <div className={`text-xs transition-opacity duration-150 ${
                isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-60'
              }`}>
                <kbd className="font-mono bg-muted/80 px-1.5 py-0.5 rounded text-[10px] border border-border/50">↵</kbd>
              </div>
            </CommandItem>
          );
        })}
      </CommandGroup>
    );
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <Command shouldFilter={false} className="rounded-xl shadow-2xl overflow-hidden">
        <div className="flex items-center gap-2 sm:gap-3 border-b px-3 sm:px-5 py-3 sm:py-4 bg-gradient-to-r from-background via-muted/5 to-background">
          <div className="p-2 rounded-lg bg-primary/10 flex-shrink-0">
            <Search className="h-4 w-4 text-primary" />
          </div>
          <CommandInput
            placeholder="Type to search customers, vehicles, rentals, and more..."
            value={query}
            onValueChange={setQuery}
            className="flex h-10 w-full bg-transparent text-sm sm:text-base outline-none placeholder:text-muted-foreground/50 disabled:cursor-not-allowed disabled:opacity-50 min-w-0"
          />
          <div className="flex items-center gap-2 flex-shrink-0 border-l pl-2 sm:pl-3">
            <Select value={entityFilter} onValueChange={setEntityFilter}>
              <SelectTrigger className="w-24 sm:w-32 h-9 text-xs font-medium border-border/60 hover:border-primary/50 transition-colors bg-background shadow-sm">
                <Filter className="h-3.5 w-3.5 mr-1 sm:mr-1.5" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-lg">
                <SelectItem value="all" className="font-medium">All</SelectItem>
                <SelectItem value="customers">Customers</SelectItem>
                <SelectItem value="vehicles">Vehicles</SelectItem>
                <SelectItem value="rentals">Rentals</SelectItem>
                <SelectItem value="fines">Fines</SelectItem>
                <SelectItem value="payments">Payments</SelectItem>
                {!hideInsurance && <SelectItem value="insurance">Insurance</SelectItem>}
                <SelectItem value="plates">Plates</SelectItem>
                <SelectItem value="invoices">Invoices</SelectItem>
                <SelectItem value="documents">Documents</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <CommandList className="max-h-[500px] p-2">
          {isLoading && hasQuery && (
            <div className="flex flex-col items-center justify-center p-12 gap-3">
              <div className="relative">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <div className="absolute inset-0 h-8 w-8 animate-ping text-primary/20">
                  <Loader2 className="h-8 w-8" />
                </div>
              </div>
              <span className="text-sm font-medium text-muted-foreground">Searching across your data...</span>
            </div>
          )}

          {!isLoading && hasQuery && totalResults === 0 && (
            <CommandEmpty>
              <div className="text-center p-12 space-y-4">
                <div className="mx-auto w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center">
                  <Search className="h-8 w-8 text-muted-foreground/50" />
                </div>
                <div className="space-y-2">
                  <p className="text-base font-semibold text-foreground">No results found</p>
                  <p className="text-sm text-muted-foreground">
                    We couldn't find anything matching <span className="font-medium text-foreground">"{query}"</span>
                  </p>
                </div>
                <div className="bg-muted/30 rounded-lg p-4 space-y-2">
                  <p className="text-xs font-semibold text-foreground">Search Tips:</p>
                  <ul className="text-xs text-muted-foreground space-y-1 text-left max-w-sm mx-auto">
                    <li>• Try different keywords or shorter terms</li>
                    <li>• Check for typos (fuzzy matching is enabled)</li>
                    <li>• Use the filter dropdown to narrow your search</li>
                  </ul>
                </div>
              </div>
            </CommandEmpty>
          )}

          {!hasQuery && (
            <div className="p-8 text-center space-y-6">
              <div className="mx-auto w-20 h-20 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
                <Search className="h-10 w-10 text-primary" />
              </div>
              <div className="space-y-2">
                <h3 className="text-lg font-semibold text-foreground">Search Everything</h3>
                <p className="text-sm text-muted-foreground max-w-md mx-auto">
                  Instantly find customers, vehicles, rentals, fines, payments{!hideInsurance ? ', insurance,' : ','} invoices, documents, and plates
                </p>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 max-w-2xl mx-auto">
                <div className="p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors cursor-default">
                  <User className="h-5 w-5 text-primary mx-auto mb-1.5" />
                  <p className="text-xs font-medium">Customers</p>
                </div>
                <div className="p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors cursor-default">
                  <Car className="h-5 w-5 text-primary mx-auto mb-1.5" />
                  <p className="text-xs font-medium">Vehicles</p>
                </div>
                <div className="p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors cursor-default">
                  <Calendar className="h-5 w-5 text-primary mx-auto mb-1.5" />
                  <p className="text-xs font-medium">Rentals</p>
                </div>
                <div className="p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors cursor-default">
                  <CreditCard className="h-5 w-5 text-primary mx-auto mb-1.5" />
                  <p className="text-xs font-medium">Payments</p>
                </div>
              </div>

              <div className="bg-muted/20 rounded-lg p-4 space-y-3 max-w-md mx-auto">
                <p className="text-xs font-semibold text-foreground flex items-center justify-center gap-2">
                  Keyboard Shortcuts
                </p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="flex items-center justify-between bg-background/50 rounded px-3 py-2">
                    <span className="text-muted-foreground">Navigate</span>
                    <kbd className="font-mono bg-muted px-2 py-1 rounded text-[10px]">↑ ↓</kbd>
                  </div>
                  <div className="flex items-center justify-between bg-background/50 rounded px-3 py-2">
                    <span className="text-muted-foreground">Select</span>
                    <kbd className="font-mono bg-muted px-2 py-1 rounded text-[10px]">Enter</kbd>
                  </div>
                  <div className="flex items-center justify-between bg-background/50 rounded px-3 py-2">
                    <span className="text-muted-foreground">Close</span>
                    <kbd className="font-mono bg-muted px-2 py-1 rounded text-[10px]">Esc</kbd>
                  </div>
                  <div className="flex items-center justify-between bg-background/50 rounded px-3 py-2">
                    <span className="text-muted-foreground">Open</span>
                    <kbd className="font-mono bg-muted px-2 py-1 rounded text-[10px]">⌘K</kbd>
                  </div>
                </div>
              </div>
            </div>
          )}

          {hasQuery && !isLoading && totalResults > 0 && (
            <div className="space-y-2">
              {renderGroup("Customers", results.customers, "")}
              {renderGroup("Vehicles", results.vehicles, "")}
              {renderGroup("Rentals", results.rentals, "")}
              {renderGroup("Fines", results.fines, "")}
              {renderGroup("Payments", results.payments, "")}
              {!hideInsurance && renderGroup("Insurance", results.insurance, "")}
              {renderGroup("Plates", results.plates, "")}
              {renderGroup("Invoices", results.invoices, "")}
              {renderGroup("Documents", results.documents, "")}
            </div>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
};