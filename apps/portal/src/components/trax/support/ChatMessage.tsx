'use client';

import { User, Copy, Check, LifeBuoy, RotateCcw } from 'lucide-react';
import { TraxIcon } from '@/components/chat/TraxIcon';
import { useAuthStore } from '@/stores/auth-store';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';
import { ChatChart } from '@/components/chat/ChatChart';
import { ChatRentalCards } from '@/components/chat/ChatRentalCards';
import { ChatActionCard, ActionResultBadge } from '@/components/chat/ChatActionCard';
import { useTenantBranding } from '@/hooks/use-tenant-branding';
import { PaymentEvidence } from './PaymentEvidence';
import type { ChatMessage as ChatMessageType, TraxNavigation } from '@/types/trax-support';

interface ChatMessageProps {
  message: ChatMessageType;
  onConfirmAction?: (messageId: string) => void;
  onRejectAction?: (messageId: string) => void;
  onNavigate?: () => void;
  isLoading?: boolean;
  onVerifyNavigation?: (action: TraxNavigation) => Promise<boolean>;
  onCheckAgain?: () => Promise<void>;
  /** Open the ticket the server created for this issue, in the portal's Support section. */
  onOpenSupport?: (target: { ticketId?: string; issueId?: string }) => void;
  /** Retry an automatic handoff that did not persist. */
  onRetryTicket?: () => void;
}

export function ChatMessage({ message, onConfirmAction, onRejectAction, onNavigate, onVerifyNavigation, onCheckAgain, onOpenSupport, onRetryTicket, isLoading }: ChatMessageProps) {
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

  const formattedTime = message.timestamp.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div
      className={cn(
        'group flex gap-3 py-3 animate-slide-up motion-reduce:animate-none',
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
          /* Both avatars wear the same tinted surface from the theme — the one the
             v2 bubble primitive uses — rather than a chat-only colour. */
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary dark:bg-primary/25">
            <User className="h-3.5 w-3.5" />
          </div>
        )
      ) : (
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary dark:bg-primary/25">
          <TraxIcon size={18} color="currentColor" />
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
              ? 'bg-primary text-primary-foreground rounded-tr-sm'
              : 'bg-secondary/40 text-foreground rounded-tl-sm border border-border/40'
          )}
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
                  // Only server-verified navigation buttons may open destinations.
                  a: ({ children }) => <span>{children}</span>,
                  img: () => null,
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

        {!isUser && message.provenance && (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
              {message.provenance.engine==='model'?'AI answer':'Prepared guidance fallback'} · {message.provenance.liveDataChecked?'Live records checked':'Live records not checked'}
            </summary>
            <p className="mt-1">{message.sources?.map((source) => source.title).filter(Boolean).join(', ') || 'Phase 1 support scope'} · Guide {message.provenance.knowledgeVersion}. Release match has not been verified. This conversation is kept in browser memory only.</p>
          </details>
        )}
        {!isUser && message.evidence?.filter(result=>result.checks.length||result.findings.length||result.limitations.length).map((result,index)=>(
          <div key={index} className="w-full rounded-lg border border-border/60 bg-background/60 p-3 text-xs">
            <p className="font-medium">{result.status==='verified'?'Record check':result.status==='needs_input'?'More context needed':'Incomplete check'} · {new Date(result.observedAt).toLocaleString()}</p>
            {result.findings.length>0 && <ul className="mt-2 space-y-2">{result.findings.map((finding,i)=><li key={i}>{finding.summary}</li>)}</ul>}
            {result.status==='verified'&&!result.findings.some(f=>f.blocking)&&result.checks.some(c=>['website_visibility','rental_occupancy','checkout_overlap_precheck'].includes(c))&&<p className="mt-2">No blocker found in the evaluated checks.</p>}
            {!!result.limitations.length && <p className="mt-2 text-muted-foreground">{result.limitations.join(' ')}</p>}
            {Array.isArray(result.data?.paymentCards) && <div className="mt-2"><PaymentEvidence cards={result.data!.paymentCards!} totals={result.data!.totals} explanations={result.data!.explanations} /></div>}
          </div>
        ))}
        {/* The reference and the destination are the server's; nothing here is composed
            by the model, and there is no ticket interface inside TRAX. */}
        {!isUser && message.ticket && onOpenSupport && (
          <button
            type="button"
            onClick={() => onOpenSupport({ ticketId: message.ticket!.id })}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium hover:bg-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <LifeBuoy className="h-3.5 w-3.5 text-primary" aria-hidden />
            Open support ticket
            <span className="text-muted-foreground">#{message.ticket.reference}</span>
          </button>
        )}
        {!isUser && message.ticketRetry && onRetryTicket && (
          <button
            type="button"
            disabled={isLoading}
            onClick={onRetryTicket}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium hover:bg-secondary focus-visible:outline focus-visible:outline-2 disabled:opacity-50"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            Try creating the ticket again
          </button>
        )}
        {!isUser && message.canRecheck && onCheckAgain && <button type="button" disabled={isLoading} onClick={()=>void onCheckAgain()} className="rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-secondary focus-visible:outline focus-visible:outline-2 disabled:opacity-50">Check Again</button>}
        {!isUser && onVerifyNavigation && !!message.navigation?.length && (
          <div className="flex flex-wrap gap-2">
            {message.navigation.map((action) => (
              <button
                key={`${action.target}:${action.entityId || ''}`}
                type="button"
                disabled={isLoading}
                className="rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium hover:bg-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
                onClick={async () => { if (await onVerifyNavigation(action)) onNavigate?.(); }}
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
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
            'flex items-center gap-2 text-[11px] text-muted-foreground',
            isUser ? 'flex-row-reverse' : 'flex-row'
          )}
        >
          <span>{formattedTime}</span>
        </div>
      </div>
    </div>
  );
}
