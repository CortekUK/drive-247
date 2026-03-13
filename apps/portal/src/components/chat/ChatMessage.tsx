'use client';

import { User, Copy, Check } from 'lucide-react';
import { TraxIcon } from './TraxIcon';
import { useAuthStore } from '@/stores/auth-store';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';
import { ChatChart } from './ChatChart';
import { ChatRentalCards } from './ChatRentalCards';
import { ChatActionCard, ActionResultBadge } from './ChatActionCard';
import { useTenantBranding } from '@/hooks/use-tenant-branding';
import type { ChatMessage as ChatMessageType } from '@/types/chat';

interface ChatMessageProps {
  message: ChatMessageType;
  onConfirmAction?: (messageId: string) => void;
  onRejectAction?: (messageId: string) => void;
  onNavigate?: () => void;
  isLoading?: boolean;
}

export function ChatMessage({ message, onConfirmAction, onRejectAction, onNavigate, isLoading }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const [copied, setCopied] = useState(false);
  const { branding } = useTenantBranding();
  const { appUser } = useAuthStore();

  const accentColor = branding?.accent_color || '#6366f1';

  const copyToClipboard = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formattedTime = message.timestamp.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div
      className={cn(
        'group flex gap-3 py-3 animate-slide-up',
        isUser ? 'flex-row-reverse' : 'flex-row'
      )}
    >
      {/* Avatar */}
      {isUser ? (
        appUser?.avatar_url ? (
          <img
            src={appUser.avatar_url}
            alt={appUser.name || 'You'}
            className="h-7 w-7 shrink-0 rounded-full object-cover shadow-sm"
          />
        ) : (
          <div
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full shadow-sm"
            style={{ background: `linear-gradient(135deg, ${accentColor}, ${accentColor}dd)` }}
          >
            <User className="h-3.5 w-3.5 text-white" />
          </div>
        )
      ) : (
        <div
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
          style={{
            background: `${accentColor}15`,
            border: `1px solid ${accentColor}25`,
          }}
        >
          <TraxIcon size={18} color={accentColor} />
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
            'relative rounded-xl px-3.5 py-2.5 text-sm leading-relaxed',
            isUser
              ? 'text-white rounded-tr-sm'
              : 'bg-secondary/40 text-foreground rounded-tl-sm border border-border/40'
          )}
          style={isUser ? { background: `linear-gradient(135deg, ${accentColor}, ${accentColor}dd)` } : undefined}
        >
          {/* Message content — markdown for assistant, plain for user */}
          {isUser ? (
            <div className="whitespace-pre-wrap break-words">{message.content}</div>
          ) : (
            <div className="trax-markdown break-words">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                  strong: ({ children }) => (
                    <strong className="font-semibold text-foreground">{children}</strong>
                  ),
                  em: ({ children }) => (
                    <em className="text-muted-foreground italic">{children}</em>
                  ),
                  ul: ({ children }) => (
                    <ul className="mb-2 ml-4 list-disc space-y-1 last:mb-0">{children}</ul>
                  ),
                  ol: ({ children }) => (
                    <ol className="mb-2 ml-4 list-decimal space-y-1 last:mb-0">{children}</ol>
                  ),
                  li: ({ children }) => <li className="text-sm">{children}</li>,
                  pre: ({ children }) => (
                    <pre className="rounded-lg bg-secondary/60 border border-border/40 p-3 text-xs my-2 overflow-x-auto">
                      {children}
                    </pre>
                  ),
                  code: ({ children, className }) => {
                    // If it has a language class, it's inside a <pre> — let pre handle it
                    if (className) {
                      return <code className={className}>{children}</code>;
                    }
                    // Inline code
                    return (
                      <code
                        className="rounded px-1.5 py-0.5 text-xs font-medium bg-secondary/80 border border-border/40"
                        style={{ color: accentColor }}
                      >
                        {children}
                      </code>
                    );
                  },
                  h3: ({ children }) => (
                    <h3 className="text-sm font-semibold mt-3 mb-1">{children}</h3>
                  ),
                  h4: ({ children }) => (
                    <h4 className="text-sm font-medium mt-2 mb-1">{children}</h4>
                  ),
                  blockquote: ({ children }) => (
                    <blockquote
                      className="border-l-2 pl-3 my-2 text-muted-foreground italic"
                      style={{ borderColor: `${accentColor}40` }}
                    >
                      {children}
                    </blockquote>
                  ),
                  a: ({ children, href }) => (
                    <a
                      href={href}
                      className="underline underline-offset-2"
                      style={{ color: accentColor }}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {children}
                    </a>
                  ),
                  hr: () => <hr className="my-3 border-border/40" />,
                }}
              >
                {message.content}
              </ReactMarkdown>
            </div>
          )}

          {/* Copy button for assistant messages */}
          {!isUser && (
            <button
              onClick={copyToClipboard}
              className={cn(
                'absolute -right-2 -top-2 p-1.5 rounded-lg',
                'bg-background border border-border/50 shadow-sm',
                'opacity-0 group-hover:opacity-100 transition-all duration-200',
                'hover:bg-secondary hover:scale-110'
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

        {/* Rental request cards (if present, only for assistant messages) */}
        {!isUser && message.rentalRequests && (
          <div className="w-full animate-fade-in">
            <ChatRentalCards data={message.rentalRequests} onNavigate={onNavigate} />
          </div>
        )}

        {/* Action card (if AI proposed an action) */}
        {!isUser && message.action && onConfirmAction && onRejectAction && (
          <div className="w-full animate-fade-in">
            <ChatActionCard
              action={message.action}
              onConfirm={() => onConfirmAction(message.id)}
              onReject={() => onRejectAction(message.id)}
              isLoading={isLoading}
            />
          </div>
        )}

        {/* Action result badge */}
        {!isUser && message.actionResult && (
          <div className="animate-fade-in">
            <ActionResultBadge result={message.actionResult} onNavigate={onNavigate} />
          </div>
        )}

        {/* Footer with timestamp */}
        <div
          className={cn(
            'flex items-center gap-2 text-[11px] text-muted-foreground/60',
            isUser ? 'flex-row-reverse' : 'flex-row'
          )}
        >
          <span>{formattedTime}</span>
        </div>
      </div>
    </div>
  );
}
