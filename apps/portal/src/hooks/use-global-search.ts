import { useState, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { searchService, SearchResults } from "@/lib/search-service";
import { useTenant } from "@/contexts/TenantContext";

export const useGlobalSearch = () => {
  const { tenant } = useTenant();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [entityFilter, setEntityFilter] = useState<string>("all");
  const [selectedIndex, setSelectedIndex] = useState(-1);

  // Debounce search query (reduced to 250ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
      setSelectedIndex(-1); // Reset selection when query changes
    }, 250);

    return () => clearTimeout(timer);
  }, [query]);

  // Search query
  const {
    data: results,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["global-search", debouncedQuery, entityFilter, tenant?.id],
    queryFn: () => searchService.searchAll(debouncedQuery, entityFilter, tenant?.id),
    enabled: debouncedQuery.length > 0,
    staleTime: 30000, // 30 seconds
  });

  const openSearch = useCallback(() => {
    setIsOpen(true);
  }, []);

  const closeSearch = useCallback(() => {
    setIsOpen(false);
    setQuery("");
    setDebouncedQuery("");
    setEntityFilter("all");
    setSelectedIndex(-1);
  }, []);

  const clearSearch = useCallback(() => {
    setQuery("");
    setDebouncedQuery("");
    setSelectedIndex(-1);
  }, []);

  // Get total results count
  const totalResults = results
    ? Object.values(results).reduce((total, categoryResults) => total + categoryResults.length, 0)
    : 0;

  // Get flattened results for navigation (including insurance, invoices, documents)
  const allResults = results
    ? [
        ...results.customers,
        ...results.vehicles,
        ...results.rentals,
        ...results.fines,
        ...results.payments,
        ...results.plates,
        ...results.insurance,
        ...results.invoices,
        ...results.documents,
      ]
    : [];

  // Navigation helpers
  const navigateUp = useCallback(() => {
    setSelectedIndex(prev => prev > 0 ? prev - 1 : allResults.length - 1);
  }, [allResults.length]);

  const navigateDown = useCallback(() => {
    setSelectedIndex(prev => prev < allResults.length - 1 ? prev + 1 : 0);
  }, [allResults.length]);

  const getSelectedResult = useCallback(() => {
    return selectedIndex >= 0 ? allResults[selectedIndex] : null;
  }, [allResults, selectedIndex]);

  return {
    query,
    setQuery,
    results: results || {
      customers: [],
      vehicles: [],
      rentals: [],
      fines: [],
      payments: [],
      plates: [],
      insurance: [],
      invoices: [],
      documents: [],
    },
    isLoading,
    error,
    isOpen,
    openSearch,
    closeSearch,
    clearSearch,
    totalResults,
    allResults,
    hasQuery: debouncedQuery.length > 0,
    entityFilter,
    setEntityFilter,
    selectedIndex,
    setSelectedIndex,
    navigateUp,
    navigateDown,
    getSelectedResult,
  };
};