"use client";

import { useState, useEffect } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GlobalSearch } from "./global-search";

export const HeaderSearch = () => {
  const [searchOpen, setSearchOpen] = useState(false);

  // Global keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <>
      <Button
        variant="outline"
        onClick={() => setSearchOpen(true)}
        className="group relative gap-2 sm:gap-3 px-2 sm:px-4 h-10 w-full text-muted-foreground hover:text-foreground border-border hover:border-primary/50 transition-all duration-200 hover:bg-accent/50 justify-start shadow-sm"
      >
        <Search className="h-4 w-4 shrink-0 transition-transform duration-200 group-hover:scale-110 text-muted-foreground" />
        <span className="flex-1 text-left text-sm font-normal text-muted-foreground truncate min-w-0">Search for anything...</span>
        <div className="hidden sm:flex items-center gap-1">
          <kbd className="inline-flex items-center justify-center h-6 px-2 rounded text-[11px] font-mono bg-muted border border-border text-muted-foreground min-w-[24px]">
            ⌘
          </kbd>
          <kbd className="inline-flex items-center justify-center h-6 px-2 rounded text-[11px] font-mono bg-muted border border-border text-muted-foreground min-w-[24px]">
            K
          </kbd>
        </div>
      </Button>

      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </>
  );
};