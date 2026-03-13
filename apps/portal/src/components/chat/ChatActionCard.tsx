'use client';

import { Check, X, AlertTriangle, Bell, CheckCircle2, XCircle, ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { useTenantBranding } from '@/hooks/use-tenant-branding';
import { cn } from '@/lib/utils';
import type { ActionProposal, ActionResult } from '@/types/chat';

interface ChatActionCardProps {
  action: ActionProposal;
  onConfirm: () => void;
  onReject: () => void;
  isLoading?: boolean;
}

export function ChatActionCard({ action, onConfirm, onReject, isLoading }: ChatActionCardProps) {
  const { branding } = useTenantBranding();
  const accentColor = branding?.accent_color || '#6366f1';

  return (
    <div
      className={cn(
        'rounded-xl border overflow-hidden animate-slide-up',
        action.destructive ? 'border-red-500/30' : 'border-border/50'
      )}
      style={!action.destructive ? { borderColor: `${accentColor}30` } : undefined}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 px-4 py-2.5"
        style={{
          background: action.destructive ? 'rgba(239,68,68,0.08)' : `${accentColor}08`,
        }}
      >
        <Bell
          className="h-4 w-4"
          style={{ color: action.destructive ? '#ef4444' : accentColor }}
        />
        <span className="text-[13px] font-medium text-foreground">
          {action.displayTitle}
        </span>
      </div>

      {/* Body */}
      <div className="px-4 py-3 space-y-2.5">
        <p className="text-sm text-foreground">{action.summary}</p>

        {/* Detail pairs */}
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          {Object.entries(action.details).map(([key, value]) => (
            <div key={key} className="text-xs">
              <span className="text-muted-foreground">{key}: </span>
              <span className="text-foreground font-medium">{value}</span>
            </div>
          ))}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 pt-1">
          <Button
            size="sm"
            onClick={onConfirm}
            disabled={isLoading}
            className="h-8 rounded-lg text-xs text-white"
            style={{
              background: action.destructive
                ? 'linear-gradient(135deg, #ef4444, #dc2626)'
                : `linear-gradient(135deg, ${accentColor}, ${accentColor}cc)`,
            }}
          >
            {isLoading ? (
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                Executing...
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <Check className="h-3.5 w-3.5" />
                Confirm
              </span>
            )}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onReject}
            disabled={isLoading}
            className="h-8 rounded-lg text-xs text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5 mr-1" />
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

// Map entity types to portal routes
const entityRoutes: Record<string, string> = {
  reminder: '/reminders',
  customer: '/customers',
  vehicle: '/fleet/vehicles',
  rental: '/rentals',
  fine: '/fines',
  payment: '/payments',
};

// Inline result badge shown after action execution
export function ActionResultBadge({ result, onNavigate }: { result: ActionResult; onNavigate?: () => void }) {
  const viewPath = result.success && result.entityType
    ? entityRoutes[result.entityType] || null
    : null;

  return (
    <div className="flex items-center gap-2">
      <div
        className={cn(
          'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium',
          result.success
            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
            : 'bg-red-500/10 text-red-400 border border-red-500/20'
        )}
      >
        {result.success ? (
          <CheckCircle2 className="h-3.5 w-3.5" />
        ) : (
          <XCircle className="h-3.5 w-3.5" />
        )}
        {result.message}
      </div>
      {viewPath && (
        <Link
          href={viewPath}
          onClick={onNavigate}
          className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground border border-border/40 hover:border-border/60 transition-colors"
        >
          View
          <ArrowUpRight className="h-3 w-3" />
        </Link>
      )}
    </div>
  );
}
