'use client';

import { cn } from '@/lib/utils';

interface TypingIndicatorProps {
  name?: string;
  className?: string;
}

export function TypingIndicator({ name, className }: TypingIndicatorProps) {
  return (
    <div className={cn('flex items-center gap-2 mb-3', className)}>
      <div className="bg-muted rounded-2xl rounded-bl-md px-4 py-2.5">
        <div className="flex items-center gap-1">
          {/* Animated dots */}
          <span className="flex gap-1">
            <span
              className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce"
              style={{ animationDelay: '0ms', animationDuration: '600ms' }}
            />
            <span
              className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce"
              style={{ animationDelay: '150ms', animationDuration: '600ms' }}
            />
            <span
              className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce"
              style={{ animationDelay: '300ms', animationDuration: '600ms' }}
            />
          </span>
        </div>
      </div>
      {name && (
        <span className="text-xs text-muted-foreground">{name} is typing...</span>
      )}
    </div>
  );
}
