'use client';

import { cn } from '@/lib/utils';

interface TraxIconProps {
  className?: string;
  color?: string;
  size?: number;
}

export function TraxIcon({ className, color = '#6366f1', size = 18 }: TraxIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('shrink-0', className)}
    >
      {/* Rounded body */}
      <rect x="3" y="5" width="18" height="15" rx="5" fill={color} opacity="0.15" />
      <rect x="3" y="5" width="18" height="15" rx="5" stroke={color} strokeWidth="1.5" opacity="0.6" />

      {/* Left eye — sparkle */}
      <circle cx="9" cy="12" r="1.8" fill={color} />
      <circle cx="9.6" cy="11.3" r="0.6" fill="white" opacity="0.8" />

      {/* Right eye — sparkle */}
      <circle cx="15" cy="12" r="1.8" fill={color} />
      <circle cx="15.6" cy="11.3" r="0.6" fill="white" opacity="0.8" />

      {/* Antenna */}
      <line x1="12" y1="5" x2="12" y2="2" stroke={color} strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
      <circle cx="12" cy="1.5" r="1.5" fill={color} opacity="0.7" />

      {/* Smile */}
      <path d="M9.5 15.5 C10.5 16.8 13.5 16.8 14.5 15.5" stroke={color} strokeWidth="1.3" strokeLinecap="round" fill="none" opacity="0.5" />
    </svg>
  );
}
