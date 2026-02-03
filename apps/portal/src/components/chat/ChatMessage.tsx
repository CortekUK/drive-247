'use client';

import { User, Sparkles, Copy, Check } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { ChatChart } from './ChatChart';
import { useTenantBranding } from '@/hooks/use-tenant-branding';
import type { ChatMessage as ChatMessageType } from '@/types/chat';

interface ChatMessageProps {
  message: ChatMessageType;
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const [copied, setCopied] = useState(false);
  const { branding } = useTenantBranding();

  // Get branding colors with fallbacks
  const accentColor = branding?.accent_color || '#E9B63E';

  const copyToClipboard = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Format timestamp
  const formattedTime = message.timestamp.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div
      className={cn(
        'group flex gap-3 py-4 animate-slide-up',
        isUser ? 'flex-row-reverse' : 'flex-row'
      )}
    >
      {/* Avatar */}
      {isUser ? (
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg shadow-sm"
          style={{ background: `linear-gradient(135deg, ${accentColor}, ${accentColor}dd)` }}
        >
          <User className="h-4 w-4 text-white" />
        </div>
      ) : (
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border"
          style={{
            background: `${accentColor}20`,
            borderColor: `${accentColor}50`,
          }}
        >
          <Sparkles className="h-4 w-4" style={{ color: accentColor }} />
        </div>
      )}

      {/* Message content */}
      <div
        className={cn(
          'flex max-w-[85%] flex-col gap-2',
          isUser ? 'items-end' : 'items-start'
        )}
      >
        {/* Message bubble */}
        <div
          className={cn(
            'relative rounded-2xl px-4 py-3 text-sm leading-relaxed',
            isUser
              ? 'text-white rounded-tr-sm'
              : 'bg-secondary/50 text-foreground rounded-tl-sm border border-border/50'
          )}
          style={isUser ? { background: `linear-gradient(135deg, ${accentColor}, ${accentColor}dd)` } : undefined}
        >
          {/* Message text with proper line breaks */}
          <div className="whitespace-pre-wrap break-words">
            {message.content}
          </div>

          {/* Copy button for assistant messages */}
          {!isUser && (
            <button
              onClick={copyToClipboard}
              className={cn(
                "absolute -right-2 -top-2 p-1.5 rounded-lg",
                "bg-background border border-border/50 shadow-sm",
                "opacity-0 group-hover:opacity-100 transition-all duration-200",
                "hover:bg-secondary hover:scale-110"
              )}
            >
              {copied ? (
                <Check className="h-3 w-3" style={{ color: accentColor }} />
              ) : (
                <Copy className="h-3 w-3 text-muted-foreground" />
              )}
            </button>
          )}
        </div>

        {/* Chart (if present, only for assistant messages) */}
        {!isUser && message.chart && (
          <div className="w-full animate-fade-in">
            <ChatChart chart={message.chart} />
          </div>
        )}

        {/* Footer with timestamp */}
        <div className={cn(
          "flex items-center gap-2 text-[11px] text-muted-foreground/70",
          isUser ? "flex-row-reverse" : "flex-row"
        )}>
          <span>{formattedTime}</span>
        </div>
      </div>
    </div>
  );
}
