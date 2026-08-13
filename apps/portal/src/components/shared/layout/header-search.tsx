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
      {/* Mobile: icon-only search trigger */}
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => setSearchOpen(true)}
        aria-label="Search"
        className="sm:hidden inline-flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground/60 hover:text-muted-foreground border border-border/40 hover:border-border/60 hover:bg-accent/30 transition-all duration-200 cursor-pointer"
      >
        <Search className="size-3.5" />
      </Button>

      {/* sm+ : full-width search pill */}
      <Button
        variant="ghost"
        onClick={() => setSearchOpen(true)}
        className="hidden sm:flex group items-center gap-2 px-3 h-8 rounded-md text-muted-foreground/50 hover:text-muted-foreground border border-border/40 hover:border-border/60 bg-transparent hover:bg-accent/30 transition-all duration-200 cursor-pointer w-full"
      >
        <Search className="size-3.5 shrink-0" />
        <span className="flex-1 text-left text-[13px] font-normal truncate min-w-0">Search...</span>
        <div className="flex items-center gap-0.5">
          <kbd className="inline-flex items-center justify-center h-[18px] px-1 rounded text-[10px] font-mono bg-muted/50 border border-border/40 text-muted-foreground/40 min-w-[18px]">
            ⌘
          </kbd>
          <kbd className="inline-flex items-center justify-center h-[18px] px-1 rounded text-[10px] font-mono bg-muted/50 border border-border/40 text-muted-foreground/40 min-w-[18px]">
            K
          </kbd>
        </div>
      </Button>

      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </>
  );
};