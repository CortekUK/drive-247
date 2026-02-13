'use client';

import { useEffect, useRef, useState } from 'react';
import { Trash2, Bot } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { useChat } from '@/hooks/use-chat';
import { useTenantBranding } from '@/hooks/use-tenant-branding';
import { cn } from '@/lib/utils';

export function ChatSidebar() {
  const { messages, isLoading, sendMessage, clearChat } = useChat();
  const { branding } = useTenantBranding();
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);

  // Get branding colors with fallbacks
  const accentColor = branding?.accent_color || '#E9B63E';
  const primaryColor = branding?.primary_color || '#223331';

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollAreaRef.current) {
      const scrollContainer = scrollAreaRef.current.querySelector(
        '[data-radix-scroll-area-viewport]'
      );
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    }
  }, [messages]);

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      {/* Floating trigger button with glow effect */}
      <SheetTrigger asChild>
        <button
          className={cn(
            "fixed bottom-6 right-6 z-[9999] h-14 w-14 rounded-full",
            "shadow-lg transition-all duration-300 hover:scale-110",
            "border border-white/20 flex items-center justify-center",
            "group cursor-pointer"
          )}
          style={{
            background: `linear-gradient(135deg, ${accentColor}, ${accentColor}dd)`,
            boxShadow: `0 10px 40px -10px ${accentColor}80`,
          }}
        >
          {/* Ping ring */}
          <span
            className="absolute inset-0 rounded-full animate-ping opacity-30"
            style={{ backgroundColor: accentColor }}
          />
          {/* Outer pulse ring */}
          <span
            className="absolute -inset-1 rounded-full animate-pulse opacity-20"
            style={{ border: `2px solid ${accentColor}` }}
          />
          <Bot className="h-6 w-6 text-white relative z-10 group-hover:animate-[wiggle_0.5s_ease-in-out]" />
          <span className="sr-only">Open AI assistant</span>
        </button>
      </SheetTrigger>

      {/* Chat panel */}
      <SheetContent
        side="right"
        className={cn(
          "flex w-full flex-col p-0 sm:max-w-[420px]",
          "bg-gradient-to-b from-background via-background to-background/95",
          "border-l border-border/50 backdrop-blur-xl"
        )}
      >
        {/* Header */}
        <div className="relative flex items-center justify-between border-b border-border/50 px-5 py-4">
          {/* Gradient accent line */}
          <div
            className="absolute inset-x-0 top-0 h-[2px]"
            style={{ background: `linear-gradient(90deg, transparent, ${accentColor}, transparent)` }}
          />

          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-xl border animate-float"
              style={{
                background: `${accentColor}20`,
                borderColor: `${accentColor}50`,
              }}
            >
              <Bot className="h-5 w-5" style={{ color: accentColor }} />
            </div>
            <div>
              <h2 className="font-semibold tracking-tight">Trax</h2>
              <p className="text-xs text-muted-foreground">Powered by GPT-4</p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {messages.length > 0 && (
              <Button
                variant="ghost"
                size="icon"
                onClick={clearChat}
                className="h-9 w-9 rounded-lg text-muted-foreground hover:text-foreground"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

        {/* Messages area */}
        <ScrollArea ref={scrollAreaRef} className="flex-1">
          <div className="flex flex-col gap-1 p-4">
            {messages.length === 0 ? (
              <EmptyState onSuggestionClick={sendMessage} accentColor={accentColor} appName={branding?.app_name} />
            ) : (
              messages.map((message) => (
                <ChatMessage key={message.id} message={message} />
              ))
            )}

            {/* Thinking indicator */}
            {isLoading && (
              <div className="flex items-start gap-3 py-4">
                <div
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border"
                  style={{
                    background: `${accentColor}20`,
                    borderColor: `${accentColor}50`,
                  }}
                >
                  <Bot className="h-4 w-4 animate-spin-slow" style={{ color: accentColor }} />
                </div>
                <div className="flex items-center gap-2 pt-2">
                  <div className="flex gap-1">
                    <span
                      className="h-2 w-2 animate-bounce rounded-full [animation-delay:-0.3s]"
                      style={{ backgroundColor: accentColor }}
                    />
                    <span
                      className="h-2 w-2 animate-bounce rounded-full [animation-delay:-0.15s]"
                      style={{ backgroundColor: accentColor }}
                    />
                    <span
                      className="h-2 w-2 animate-bounce rounded-full"
                      style={{ backgroundColor: accentColor }}
                    />
                  </div>
                  <span className="text-sm text-muted-foreground">Thinking...</span>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Input area */}
        <ChatInput onSend={sendMessage} isLoading={isLoading} />
      </SheetContent>
    </Sheet>
  );
}

// Empty state component
function EmptyState({
  onSuggestionClick,
  accentColor,
  appName,
}: {
  onSuggestionClick: (msg: string) => void;
  accentColor: string;
  appName?: string | null;
}) {
  const suggestions = [
    { label: "Active rentals", query: "How many active rentals do we have?" },
    { label: "Available vehicles", query: "Show me vehicles that are available" },
    { label: "Revenue this month", query: "What's our revenue this month?" },
    { label: "Pending payments", query: "What's our pending payment total?" },
  ];

  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      {/* Animated gradient orb */}
      <div className="relative mb-6">
        <div
          className="h-20 w-20 rounded-2xl border flex items-center justify-center animate-float"
          style={{
            background: `${accentColor}20`,
            borderColor: `${accentColor}50`,
          }}
        >
          <Bot className="h-10 w-10 animate-pulse" style={{ color: accentColor }} />
        </div>
        <div
          className="absolute -inset-1 -z-10 rounded-2xl blur-xl animate-glow"
          style={{ background: `${accentColor}30` }}
        />
      </div>

      <h3 className="text-xl font-semibold tracking-tight">How can I help?</h3>
      <p className="mt-2 max-w-[280px] text-sm text-muted-foreground">
        Ask me anything about your customers, vehicles, rentals, payments, or business metrics.
      </p>

      {/* Suggestion chips */}
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion.label}
            onClick={() => onSuggestionClick(suggestion.query)}
            className={cn(
              "rounded-full px-4 py-2 text-sm",
              "bg-secondary/50 hover:bg-secondary",
              "border border-border/50",
              "text-muted-foreground hover:text-foreground",
              "transition-all duration-200 hover:shadow-sm hover:scale-105"
            )}
            style={{
              '--hover-border-color': `${accentColor}50`,
            } as React.CSSProperties}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = `${accentColor}50`;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = '';
            }}
          >
            {suggestion.label}
          </button>
        ))}
      </div>
    </div>
  );
}
