"use client";

import { Menu } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { NAV_LINKS } from "@/lib/constants";

export function MobileNav() {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-11 lg:hidden"
          aria-label="Open menu"
        >
          <Menu className="size-5" />
        </Button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="w-[min(20rem,85vw)] overflow-y-auto bg-brand-cream p-6"
      >
        <SheetHeader className="px-0">
          <SheetTitle className="text-lg">Menu</SheetTitle>
          <SheetDescription className="sr-only">
            Site navigation and the booking link.
          </SheetDescription>
        </SheetHeader>
        <nav className="mt-2 flex flex-col">
          {NAV_LINKS.map((link) => (
            <SheetClose asChild key={link.href}>
              <Link
                href={link.href}
                className="border-b border-border py-4 text-base font-medium text-brand-text/90 hover:text-brand-text"
              >
                {link.label}
              </Link>
            </SheetClose>
          ))}
        </nav>
        <SheetClose asChild>
          <Button
            asChild
            variant="brand"
            className="mt-6 h-12 w-full"
          >
            <Link href="/booking">Rent a Car</Link>
          </Button>
        </SheetClose>
      </SheetContent>
    </Sheet>
  );
}
