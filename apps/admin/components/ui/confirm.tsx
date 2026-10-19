'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';

/**
 * The app's replacement for window.confirm / window.prompt (Ghulam, 2026-10-19:
 * no browser popups anywhere). Call from anywhere, await the answer:
 *
 *   if (!(await confirmDialog({ title: 'End "test"?', confirmLabel: 'End', destructive: true }))) return;
 *   const reason = await promptDialog({ title: 'Why?', minLength: 10 }); // null when cancelled
 *
 * <ConfirmHost /> is mounted once in app/layout.tsx.
 */

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

export interface PromptOptions extends ConfirmOptions {
  placeholder?: string;
  defaultValue?: string;
  /** Characters required before the confirm button enables. */
  minLength?: number;
}

type Request =
  | { kind: 'confirm'; options: ConfirmOptions; resolve: (ok: boolean) => void }
  | { kind: 'prompt'; options: PromptOptions; resolve: (value: string | null) => void };

let current: Request | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function open(request: Request) {
  // A second ask while one is open cancels the first rather than stacking.
  if (current) settle(false);
  current = request;
  emit();
}

function settle(answer: boolean, value?: string) {
  const req = current;
  if (!req) return;
  current = null;
  emit();
  if (req.kind === 'confirm') req.resolve(answer);
  else req.resolve(answer ? (value ?? '') : null);
}

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => open({ kind: 'confirm', options, resolve }));
}

export function promptDialog(options: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => open({ kind: 'prompt', options, resolve }));
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function ConfirmHost() {
  const req = useSyncExternalStore(subscribe, () => current, () => null);
  // Keep the last request around so the dialog's text does not blank out while it animates closed.
  const last = useRef<Request | null>(null);
  if (req) last.current = req;
  const shown = req ?? last.current;
  const opener = useRef<HTMLElement | null>(null);
  const [value, setValue] = useState('');

  useEffect(() => {
    if (!req) return;
    opener.current = document.activeElement as HTMLElement | null;
    setValue(req.kind === 'prompt' ? (req.options.defaultValue ?? '') : '');
  }, [req]);

  if (!shown) return null;
  const o = shown.options;
  const isPrompt = shown.kind === 'prompt';
  const min = isPrompt ? ((o as PromptOptions).minLength ?? 0) : 0;
  const canConfirm = !isPrompt || value.trim().length >= min;

  return (
    <Dialog open={!!req} onOpenChange={(next) => !next && settle(false)}>
      <DialogContent
        showCloseButton={false}
        className="w-[calc(100vw-2rem)] max-w-[440px] gap-5 rounded-3xl p-6"
        onOpenAutoFocus={(e) => {
          if (!isPrompt) e.preventDefault();
        }}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          if (opener.current?.isConnected) opener.current.focus();
        }}
      >
        <DialogHeader className="min-w-0 text-left">
          <DialogTitle className="leading-snug [overflow-wrap:anywhere]">{o.title}</DialogTitle>
          {o.description ? (
            <DialogDescription className="whitespace-pre-line">{o.description}</DialogDescription>
          ) : (
            <DialogDescription className="sr-only">{o.title}</DialogDescription>
          )}
        </DialogHeader>
        {isPrompt && (
          <div className="space-y-1.5">
            <Textarea
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={(o as PromptOptions).placeholder}
              className="min-h-[88px] rounded-2xl"
            />
            {min > 0 && (
              <p className="text-xs text-muted-foreground">
                {value.trim().length < min ? `At least ${min} characters.` : ' '}
              </p>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" className="rounded-full" onClick={() => settle(false)}>
            {o.cancelLabel ?? 'Cancel'}
          </Button>
          <Button
            type="button"
            variant={o.destructive ? 'destructive' : 'default'}
            className="rounded-full"
            disabled={!canConfirm}
            onClick={() => settle(true, value.trim())}
          >
            {o.confirmLabel ?? 'Confirm'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
