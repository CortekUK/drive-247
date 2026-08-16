'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Sparkles,
  Trash2,
  ArrowRight,
  GraduationCap,
  BarChart3,
  X,
  Send,
} from 'lucide-react';
import { TraxIcon } from './TraxIcon';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChatMessage } from './ChatMessage';
import { ChatChart } from './ChatChart';
import { useChat } from '@/hooks/use-chat';
import { useTenantBranding } from '@/hooks/use-tenant-branding';
import { useAuth } from '@/stores/auth-store';
import { cn } from '@/lib/utils';
import type { ChatMessage as ChatMessageType } from '@/types/chat';

// ── Suggestion categories ─────────────────────────────────────────
const SUGGESTION_CATEGORIES = [
  {
    id: 'actions',
    icon: Sparkles,
    label: 'Actions',
    description: '3 actions available',
    suggestions: [
      { text: 'Which rentals have pending extension requests?', short: 'Extension requests' },
      { text: 'Show me rentals with cancellation requests', short: 'Cancellation requests' },
      { text: 'Remind me to follow up with the customer on rental payment next Monday', short: 'Set a reminder' },
    ],
  },
  {
    id: 'data',
    icon: BarChart3,
    label: 'Check your data',
    description: 'Business metrics & insights',
    suggestions: [
      { text: 'Give me a fleet overview with a chart', short: 'Fleet overview' },
      { text: 'Show me revenue breakdown by category', short: 'Revenue breakdown' },
      { text: 'How many active rentals do we have?', short: 'Active rentals' },
      { text: "What's our pending payment total?", short: 'Pending payments' },
    ],
  },
  {
    id: 'learn',
    icon: GraduationCap,
    label: 'Learn & navigate',
    description: 'Features & how-to guides',
    suggestions: [
      { text: 'How do installments work?', short: 'Installments' },
      { text: 'Explain dynamic pricing and surcharges', short: 'Dynamic pricing' },
      { text: 'Where can I change email templates?', short: 'Email templates' },
      { text: 'How does the e-signature flow work?', short: 'E-signatures' },
    ],
  },
];

// ── Header trigger button (exported for use in layout header) ─────
export function TraxHeaderButton({ onClick }: { onClick: () => void }) {
  const { branding } = useTenantBranding();
  const accentColor = branding?.accent_color || '#6366f1';

  return (
    <Button
      variant="ghost"
      onClick={onClick}
      className={cn(
        'group relative flex items-center gap-2 rounded-lg h-8',
        'px-3 flex-shrink-0',
        'transition-all duration-300',
        'cursor-pointer',
        'hover:shadow-lg',
      )}
      style={{
        border: `1px solid ${accentColor}30`,
        background: `${accentColor}08`,
        boxShadow: `0 0 12px -3px ${accentColor}25, 0 0 4px -1px ${accentColor}15`,
      }}
    >
      {/* Green online dot — positioned on the border */}
      <span
        className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-emerald-400 border-2 border-background"
        style={{ boxShadow: '0 0 6px 1px rgba(52,211,153,0.45)' }}
      />

      <TraxIcon size={18} color={accentColor} className="size-[18px] transition-transform duration-300 group-hover:scale-110" />
      <span className="hidden sm:inline text-[13px] font-medium" style={{ color: accentColor }}>
        Trax AI
      </span>
      <span
        className="hidden sm:inline text-[9px] font-semibold uppercase tracking-wider rounded px-1 py-px"
        style={{ background: `${accentColor}15`, color: `${accentColor}90` }}
      >
        Beta
      </span>
      <div className="hidden sm:flex items-center gap-0.5 ml-0.5">
        <kbd
          className="inline-flex items-center justify-center h-[18px] px-1 rounded text-[10px] font-mono min-w-[18px]"
          style={{ background: `${accentColor}10`, border: `1px solid ${accentColor}18`, color: `${accentColor}60` }}
        >
          ⌘
        </kbd>
        <kbd
          className="inline-flex items-center justify-center h-[18px] px-1 rounded text-[10px] font-mono min-w-[18px]"
          style={{ background: `${accentColor}10`, border: `1px solid ${accentColor}18`, color: `${accentColor}60` }}
        >
          J
        </kbd>
      </div>
    </Button>
  );
}

// ── Empty state with categorized suggestions ──────────────────────
function EmptyState({
  onSuggestionClick,
  accentColor,
  userName,
}: {
  onSuggestionClick: (msg: string) => void;
  accentColor: string;
  userName?: string;
}) {
  return (
    <div className="flex flex-col items-center px-4 py-6 sm:px-6 sm:py-10">
      {/* Hero section */}
      <div className="relative mb-6 sm:mb-8">
        <div
          className="flex h-12 w-12 sm:h-14 sm:w-14 items-center justify-center rounded-2xl"
          style={{
            background: `linear-gradient(135deg, ${accentColor}20, ${accentColor}08)`,
            border: `1px solid ${accentColor}25`,
          }}
        >
          <TraxIcon size={28} color={accentColor} />
        </div>
        {/* Ambient glow */}
        <div
          className="absolute inset-0 -z-10 blur-3xl opacity-20 scale-[2.5]"
          style={{ background: accentColor }}
        />
      </div>

      <h3 className="text-lg sm:text-xl font-semibold tracking-tight text-foreground text-center">
        {userName ? `Hey ${userName}, how can I help?` : 'How can I help?'}
      </h3>
      <p className="mt-2 max-w-[360px] text-[13px] text-muted-foreground text-center leading-relaxed">
        {userName
          ? "I'm here to help you navigate, learn features, or pull up your data."
          : 'Navigate the portal, learn how features work, or check your business data.'}
      </p>

      {/* Suggestions — categories stacked vertically, chips wrap to fill width */}
      <div className="mt-6 sm:mt-8 w-full max-w-[440px] flex flex-col gap-5">
        {SUGGESTION_CATEGORIES.map((category) => {
          const Icon = category.icon;

          return (
            <div key={category.id} className="flex flex-col gap-2.5">
              {/* Category header */}
              <div className="flex items-center gap-2">
                <div
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
                  style={{
                    background: `${accentColor}12`,
                    color: accentColor,
                  }}
                >
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                  {category.label}
                </span>
              </div>

              {/* Suggestion chips */}
              <div className="flex flex-wrap gap-2">
                {category.suggestions.map((suggestion) => (
                  <button
                    key={suggestion.short}
                    type="button"
                    onClick={() => onSuggestionClick(suggestion.text)}
                    className={cn(
                      'group/chip inline-flex items-center gap-1.5 rounded-full',
                      'border border-border/50 bg-secondary/20 px-3 py-1.5',
                      'text-[12.5px] text-muted-foreground',
                      'hover:text-foreground hover:border-border hover:bg-secondary/50',
                      'transition-all duration-150 cursor-pointer'
                    )}
                  >
                    <span>{suggestion.short}</span>
                    <ArrowRight className="size-3 shrink-0 -ml-1 opacity-0 transition-all duration-150 group-hover/chip:ml-0 group-hover/chip:opacity-60" />
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Message input ─────────────────────────────────────────────────
function TraxInput({
  onSend,
  isLoading,
  accentColor,
}: {
  onSend: (message: string) => void;
  isLoading: boolean;
  accentColor: string;
}) {
  const [value, setValue] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    const trimmed = value.trim();
    if (trimmed && !isLoading) {
      onSend(trimmed);
      setValue('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
    const textarea = e.target;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
  };

  return (
    <div className="border-t border-border/50 bg-background/80 backdrop-blur-sm px-3 py-3 sm:px-5 sm:py-4">
      <div
        className={cn(
          'relative flex items-end gap-2 rounded-xl',
          'bg-secondary/30 border transition-all duration-200'
        )}
        style={{
          borderColor: isFocused ? `${accentColor}40` : undefined,
          boxShadow: isFocused ? `0 0 0 3px ${accentColor}10` : undefined,
        }}
      >
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder="Ask Trax anything..."
          disabled={isLoading}
          rows={1}
          className={cn(
            'flex-1 field-sizing-fixed resize-none border-0 bg-transparent rounded-none px-3 py-3 sm:px-4',
            'text-sm placeholder:text-muted-foreground/50',
            'transition-none focus:outline-none focus-visible:border-transparent focus-visible:ring-0 disabled:opacity-50',
            'min-h-[44px] max-h-[120px]'
          )}
        />

        <div className="pr-2 py-[5px]">
          <Button
            onClick={handleSend}
            disabled={!value.trim() || isLoading}
            size="icon"
            className={cn(
              'h-9 w-9 rounded-lg transition-all duration-200',
              !value.trim() || isLoading
                ? 'bg-secondary text-muted-foreground'
                : 'text-white hover:scale-105'
            )}
            style={
              value.trim() && !isLoading
                ? {
                    background: `linear-gradient(135deg, ${accentColor}, ${accentColor}cc)`,
                    boxShadow: `0 4px 12px -2px ${accentColor}40`,
                  }
                : undefined
            }
          >
            {isLoading ? (
              <Sparkles className="h-4 w-4 animate-spin" style={{ color: accentColor }} />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
      <p className="mt-2 text-center text-[10px] sm:text-[11px] text-muted-foreground/35 px-2">
        <span className="hidden sm:inline">
          Trax AI is in beta and can make mistakes. Please double-check important information. · Enter to send · Shift+Enter for new line
        </span>
        <span className="sm:hidden">
          Trax AI is in beta. Please double-check important info.
        </span>
      </p>
    </div>
  );
}

// ── Thinking indicator ────────────────────────────────────────────
function ThinkingIndicator({ accentColor }: { accentColor: string }) {
  return (
    <div className="flex items-start gap-3 py-4 animate-fade-in">
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
        style={{
          background: `${accentColor}15`,
          border: `1px solid ${accentColor}25`,
        }}
      >
        <TraxIcon size={18} color={accentColor} className="animate-pulse" />
      </div>
      <div className="flex items-center gap-2 pt-2">
        <div className="flex gap-1">
          {['-0.3s', '-0.15s', '0s'].map((delay) => (
            <span
              key={delay}
              className="h-1.5 w-1.5 animate-bounce rounded-full"
              style={{
                backgroundColor: accentColor,
                animationDelay: delay,
              }}
            />
          ))}
        </div>
        <span className="text-xs text-muted-foreground">Thinking...</span>
      </div>
    </div>
  );
}

// ── Dialog inner content (reusable) ──────────────────────────────
export function TraxAIDialogInner({ isOpen, setIsOpen }: { isOpen: boolean; setIsOpen: (open: boolean) => void }) {
  const { messages, isLoading, sendMessage, confirmAction, rejectAction, clearChat } = useChat();
  const { branding } = useTenantBranding();
  const { appUser } = useAuth();
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  const accentColor = branding?.accent_color || '#6366f1';
  const firstName = appUser?.name?.split(' ')[0] || null;

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollAreaRef.current) {
      const scrollContainer = scrollAreaRef.current.querySelector(
        '[data-radix-scroll-area-viewport]'
      );
      if (scrollContainer) {
        setTimeout(() => {
          scrollContainer.scrollTop = scrollContainer.scrollHeight;
        }, 50);
      }
    }
  }, [messages, isLoading]);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[9998] bg-black/60 backdrop-blur-sm animate-in fade-in-0 duration-200"
        onClick={() => setIsOpen(false)}
      />

      {/* Dialog */}
      <div
        className={cn(
          'fixed z-[9999] flex flex-col',
          'bg-background border-l border-border/50 shadow-2xl',
          'animate-in fade-in-0 slide-in-from-right-6 duration-300',
          'right-0 top-0 h-dvh w-[calc(100vw-16px)] sm:w-[520px] max-w-[520px]',
        )}
        style={{
          boxShadow: `-24px 0 70px -24px rgba(0,0,0,0.45), 0 0 60px -30px ${accentColor}20`,
        }}
      >
        {/* Header */}
        <div className="relative flex items-center justify-between px-3 py-3 sm:px-5 sm:py-4 border-b border-border/50 shrink-0">
          <div
            className="absolute inset-x-0 top-0 h-px rounded-t-2xl"
            style={{
              background: `linear-gradient(90deg, transparent, ${accentColor}60, transparent)`,
            }}
          />

          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-xl"
              style={{
                background: `linear-gradient(135deg, ${accentColor}20, ${accentColor}08)`,
                border: `1px solid ${accentColor}25`,
              }}
            >
              <TraxIcon size={24} color={accentColor} />
            </div>
            <div>
              <h2 className="text-[15px] font-semibold tracking-tight">Trax AI</h2>
              <p className="text-xs text-muted-foreground">Your portal assistant</p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {messages.length > 0 && (
              <Button
                variant="ghost"
                size="icon"
                onClick={clearChat}
                className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsOpen(false)}
              className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Messages area */}
        <ScrollArea ref={scrollAreaRef} className="flex-1 min-h-0">
          <div className="flex flex-col gap-1 px-3 py-2 sm:px-5">
            {messages.length === 0 ? (
              <EmptyState
                onSuggestionClick={(msg) => {
                  sendMessage(msg);
                }}
                accentColor={accentColor}
                userName={firstName || undefined}
              />
            ) : (
              messages.map((message) => (
                <ChatMessage
                  key={message.id}
                  message={message}
                  onConfirmAction={confirmAction}
                  onRejectAction={rejectAction}
                  onNavigate={() => setIsOpen(false)}
                  isLoading={isLoading}
                />
              ))
            )}

            {isLoading && <ThinkingIndicator accentColor={accentColor} />}
          </div>
        </ScrollArea>

        {/* Input */}
        <TraxInput onSend={sendMessage} isLoading={isLoading} accentColor={accentColor} />
      </div>
    </>
  );
}

// ── Main exported component (manages state + keyboard shortcut) ───
export function TraxAIDialog() {
  const [isOpen, setIsOpen] = useState(false);

  // Keyboard shortcut: ⌘J to toggle
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'j') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  return (
    <>
      <TraxHeaderButton onClick={() => setIsOpen(true)} />
      <TraxAIDialogInner isOpen={isOpen} setIsOpen={setIsOpen} />
    </>
  );
}
