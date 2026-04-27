'use client';

import { useState } from 'react';
import { Megaphone, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useCustomerAnnouncements } from '@/hooks/use-customer-announcements';
import type { AnnouncementWithViewState } from '@/hooks/use-customer-announcements';
import { AnnouncementBody } from './AnnouncementBody';
import { formatDistanceToNow } from 'date-fns';

export function AnnouncementsBell() {
  const { announcements, unreadCount, markSeen, markAllSeen } =
    useCustomerAnnouncements();
  const [open, setOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    // When the drawer opens, leave the unread state alone so the user can
    // visually identify "new" items. They can hit "Mark all as read" to clear.
  };

  const handleExpand = (a: AnnouncementWithViewState) => {
    setExpandedId((prev) => (prev === a.id ? null : a.id));
    if (!a.viewed) markSeen.mutate(a.id);
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="What's new">
          <Megaphone className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-primary text-xs font-medium text-primary-foreground flex items-center justify-center">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Button>
      </SheetTrigger>

      <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col">
        <SheetHeader className="px-5 py-4 border-b">
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            What's new
          </SheetTitle>
          <SheetDescription>
            Recent updates and feature releases
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1">
          {announcements.length === 0 ? (
            <div className="p-10 text-center">
              <Megaphone className="h-10 w-10 mx-auto mb-2 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No announcements yet</p>
            </div>
          ) : (
            <div className="divide-y">
              {announcements.map((a) => {
                const isExpanded = expandedId === a.id;
                return (
                  <div
                    key={a.id}
                    className={`px-5 py-4 cursor-pointer transition-colors hover:bg-muted/40 ${
                      !a.viewed ? 'bg-primary/5' : ''
                    }`}
                    onClick={() => handleExpand(a)}
                  >
                    <div className="flex items-start gap-3">
                      {!a.viewed && (
                        <span className="mt-1.5 h-2 w-2 rounded-full bg-primary flex-shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <h4 className="text-sm font-semibold leading-tight">
                            {a.title}
                          </h4>
                          {a.published_at && (
                            <span className="text-[11px] text-muted-foreground flex-shrink-0">
                              {formatDistanceToNow(new Date(a.published_at), {
                                addSuffix: true,
                              })}
                            </span>
                          )}
                        </div>
                        {a.summary && (
                          <p className="text-xs text-muted-foreground line-clamp-2">
                            {a.summary}
                          </p>
                        )}

                        {isExpanded && (
                          <div className="mt-3 space-y-3">
                            {a.image_url && (
                              <img
                                src={a.image_url}
                                alt=""
                                className="w-full rounded-md object-cover max-h-40"
                              />
                            )}
                            <AnnouncementBody
                              html={a.body_html}
                              className="prose prose-xs dark:prose-invert max-w-none text-foreground/90 [&_a]:text-primary text-xs"
                            />
                            {a.cta_label && a.cta_url && (
                              <a
                                href={a.cta_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-medium px-3 py-1.5"
                              >
                                {a.cta_label}
                              </a>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>

        {unreadCount > 0 && (
          <div className="border-t p-3">
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() => markAllSeen.mutate()}
              disabled={markAllSeen.isPending}
            >
              Mark all as read
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
