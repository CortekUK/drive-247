'use client';

import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

interface TypingIndicatorProps {
  name?: string;
  avatar?: string | null;
  className?: string;
}

export function TypingIndicator({ name, avatar, className }: TypingIndicatorProps) {
  const initials = name
    ?.split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || '?';

  return (
    <div className={cn('flex items-end gap-2 mt-4', className)}>
      {/* Avatar */}
      <Avatar className="h-8 w-8">
        <AvatarImage src={avatar || undefined} alt={name} />
        <AvatarFallback className="text-xs bg-muted">{initials}</AvatarFallback>
      </Avatar>

      {/* Typing bubble */}
      <div className="bg-card border border-border/50 rounded-2xl rounded-bl-lg px-4 py-3 shadow-sm">
        <div className="flex items-center gap-1">
          {/* Animated dots */}
          <span className="flex gap-1.5">
            <span
              className="w-2 h-2 bg-muted-foreground/60 rounded-full animate-bounce"
              style={{ animationDelay: '0ms', animationDuration: '800ms' }}
            />
            <span
              className="w-2 h-2 bg-muted-foreground/60 rounded-full animate-bounce"
              style={{ animationDelay: '200ms', animationDuration: '800ms' }}
            />
            <span
              className="w-2 h-2 bg-muted-foreground/60 rounded-full animate-bounce"
              style={{ animationDelay: '400ms', animationDuration: '800ms' }}
            />
          </span>
        </div>
      </div>
    </div>
  );
}
