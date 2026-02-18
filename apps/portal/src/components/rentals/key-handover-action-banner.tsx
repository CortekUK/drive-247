'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Key, X, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface KeyHandoverActionBannerProps {
  /** Whether the banner should be visible */
  show: boolean;
  /** Customer name for personalized message */
  customerName?: string;
  /** Vehicle info for context */
  vehicleInfo?: string;
}

export const KeyHandoverActionBanner = ({
  show,
  customerName,
  vehicleInfo,
}: KeyHandoverActionBannerProps) => {
  const [dismissed, setDismissed] = useState(false);

  const handleScrollToSection = () => {
    const section = document.getElementById('key-handover-section');
    if (section) {
      section.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  if (!show || dismissed) {
    return null;
  }

  return (
    <div
      className={cn(
        "sticky top-0 z-40 w-full",
        "bg-gradient-to-r from-amber-500/15 to-amber-600/10 border-b border-amber-500/20",
        "text-foreground shadow-lg backdrop-blur-sm",
        "animate-in slide-in-from-top duration-300"
      )}
    >
      <div className="px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex-shrink-0 p-2 bg-amber-500/20 rounded-full">
              <Key className="h-5 w-5 text-amber-500" />
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
              <span className="font-semibold">Next Step: Complete Key Handover</span>
              <span className="text-muted-foreground text-sm hidden sm:inline">
                {customerName && vehicleInfo
                  ? `for ${customerName} • ${vehicleInfo}`
                  : 'to activate this rental'
                }
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleScrollToSection}
              className="bg-amber-500/15 hover:bg-amber-500/25 text-amber-500 border border-amber-500/20"
            >
              <ChevronDown className="h-4 w-4 mr-1" />
              Go to Section
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setDismissed(true)}
              className="text-muted-foreground hover:text-foreground hover:bg-amber-500/15 h-8 w-8"
            >
              <X className="h-4 w-4" />
              <span className="sr-only">Dismiss</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
