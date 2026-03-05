'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Trash2, Bot } from 'lucide-react';

const Lottie = dynamic(() => import('lottie-react'), { ssr: false });
import traxBotAnimation from './trax-bot-animation.json';
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
      {/* Floating trigger button with glow effect — hidden when chat is open */}
      <SheetTrigger asChild>
        <button
          className={cn(
            "fixed bottom-6 right-6 z-[9999] h-14 w-14 rounded-full",
            "shadow-lg transition-all duration-300 hover:scale-110",
            "border border-white/20 flex items-center justify-center",
            "group cursor-pointer",
            isOpen && "hidden"
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
    { icon: '🚗', label: "Fleet overview", query: "Give me a fleet overview with a chart" },
    { icon: '📊', label: "Revenue breakdown", query: "Show me revenue breakdown by category" },
    { icon: '📋', label: "Active rentals", query: "How many active rentals do we have?" },
    { icon: '💰', label: "Pending payments", query: "What's our pending payment total?" },
    { icon: '🔧', label: "Vehicles by make", query: "Show me vehicles grouped by make" },
    { icon: '⚠️', label: "Unpaid fines", query: "How many unpaid fines do we have?" },
  ];

  return (
    <div className="flex flex-col items-center px-4 py-6">
      {/* Lottie bot animation */}
      <div className="relative mb-3 h-28 w-28">
        <Lottie
          animationData={traxBotAnimation}
          loop
          autoplay
          className="h-full w-full"
        />
        <div
          className="absolute inset-4 -z-10 rounded-full blur-2xl opacity-30 animate-pulse"
          style={{ background: accentColor }}
        />
      </div>

      <h3 className="text-lg font-semibold tracking-tight">How can I help?</h3>
      <p className="mt-1 max-w-[260px] text-xs text-muted-foreground text-center">
        Ask about your fleet, rentals, payments, fines, or any business metric.
      </p>

      {/* Suggestion cards — stacked list */}
      <div className="mt-5 flex w-full flex-col gap-2">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion.label}
            onClick={() => onSuggestionClick(suggestion.query)}
            className={cn(
              "group flex items-center gap-3 rounded-xl px-4 py-3 text-left",
              "bg-secondary/30 hover:bg-secondary/60",
              "border border-border/30 hover:border-border/60",
              "transition-all duration-200"
            )}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = `${accentColor}40`;
              e.currentTarget.style.boxShadow = `0 0 12px -4px ${accentColor}30`;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = '';
              e.currentTarget.style.boxShadow = '';
            }}
          >
            <span className="text-base">{suggestion.icon}</span>
            <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">
              {suggestion.label}
            </span>
            <svg className="ml-auto h-4 w-4 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        ))}
      </div>
    </div>
  );
}
