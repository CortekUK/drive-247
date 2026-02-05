'use client';

import { cn } from '@/lib/utils';

interface UnreadBadgeProps {
  count: number;
  className?: string;
  size?: 'sm' | 'md';
}

export function UnreadBadge({ count, className, size = 'md' }: UnreadBadgeProps) {
  if (count === 0) return null;

  const displayCount = count > 99 ? '99+' : count.toString();

  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-full font-semibold',
        'bg-primary text-primary-foreground shadow-sm',
        size === 'sm'
          ? 'min-w-[18px] h-[18px] text-[10px] px-1.5'
          : 'min-w-[22px] h-[22px] text-xs px-2',
        className
      )}
    >
      {displayCount}
    </span>
  );
}
