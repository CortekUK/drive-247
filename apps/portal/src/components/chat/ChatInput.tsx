'use client';

import { useState, useRef, useCallback, KeyboardEvent } from 'react';
import { Send, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTenantBranding } from '@/hooks/use-tenant-branding';
import { cn } from '@/lib/utils';

interface ChatInputProps {
  onSend: (message: string) => void;
  isLoading?: boolean;
  placeholder?: string;
}

export function ChatInput({
  onSend,
  isLoading = false,
  placeholder = 'Ask anything about your data...',
}: ChatInputProps) {
  const [value, setValue] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { branding } = useTenantBranding();

  // Get branding colors with fallbacks
  const accentColor = branding?.accent_color || '#E9B63E';

  const handleSend = useCallback(() => {
    const trimmedValue = value.trim();
    if (trimmedValue && !isLoading) {
      onSend(trimmedValue);
      setValue('');
      // Reset textarea height
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    }
  }, [value, isLoading, onSend]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // Send on Enter (without Shift)
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
    // Auto-resize textarea
    const textarea = e.target;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
  };

  return (
    <div className="border-t border-border/50 bg-background/80 backdrop-blur-sm p-4">
      <div
        className={cn(
          "relative flex items-end gap-2 rounded-2xl",
          "bg-secondary/30 border transition-all duration-200"
        )}
        style={{
          borderColor: isFocused ? `${accentColor}50` : undefined,
          boxShadow: isFocused ? `0 0 10px -5px ${accentColor}40` : undefined,
        }}
      >
        {/* Gradient accent when focused */}
        {isFocused && (
          <div
            className="absolute inset-x-0 -top-px h-px"
            style={{ background: `linear-gradient(90deg, transparent, ${accentColor}, transparent)` }}
          />
        )}

        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder={placeholder}
          disabled={isLoading}
          rows={1}
          className={cn(
            "flex-1 resize-none bg-transparent px-4 py-3",
            "text-sm placeholder:text-muted-foreground/60",
            "focus:outline-none disabled:opacity-50",
            "min-h-[44px] max-h-[120px]"
          )}
        />

        <div className="flex items-center gap-1 pr-2 pb-2">
          <Button
            onClick={handleSend}
            disabled={!value.trim() || isLoading}
            size="icon"
            className={cn(
              "h-9 w-9 rounded-xl transition-all duration-200 hover:scale-105",
              !value.trim() || isLoading
                ? "bg-secondary text-muted-foreground"
                : ""
            )}
            style={value.trim() && !isLoading ? {
              background: `linear-gradient(135deg, ${accentColor}, ${accentColor}dd)`,
              boxShadow: `0 4px 12px -2px ${accentColor}40`,
            } : undefined}
          >
            {isLoading ? (
              <Sparkles className="h-4 w-4 animate-spin-slow" style={{ color: accentColor }} />
            ) : (
              <Send className="h-4 w-4 text-white" />
            )}
          </Button>
        </div>
      </div>

      {/* Helper text */}
      <p className="mt-2 text-center text-[11px] text-muted-foreground/50">
        Press Enter to send · Shift+Enter for new line
      </p>
    </div>
  );
}
