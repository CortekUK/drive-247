'use client';

/**
 * Trax for a customer — the conversation and whether its panel is open.
 *
 * The operator's Trax (apps/portal components/trax) answers staff; this one
 * answers ONE customer about their own account through `customer-trax`, which
 * takes the customer from the session and reads only their records. The Help
 * button in the top bar opens it, as the operator's Help opens theirs (owner,
 * Oct 21 2026), and ⌘J toggles it, as there.
 *
 * The conversation lives in the browser for the session (sessionStorage, keyed
 * by customer), like the operator's when storage is off: closing the panel or
 * moving between pages keeps it; signing out or a new tab starts fresh. Each
 * turn sends the conversation so far, and the server re-reads the records, so
 * an answer is never older than the question.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { useTenant } from '@nw/contexts/TenantContext';
import { useCustomer } from '@nw/hooks/use-customer';
import { supabase } from '@nw/integrations/supabase/client';

export interface TraxMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  at: number;
}

interface TraxContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  messages: TraxMessage[];
  isLoading: boolean;
  error: string | null;
  send: (text: string) => Promise<void>;
  startNew: () => void;
}

const TraxContext = createContext<TraxContextValue | null>(null);

const storageKey = (customerId: string) => `pv2-trax:${customerId}`;
const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

export function CustomerTraxProvider({ children }: { children: ReactNode }) {
  const { tenant } = useTenant();
  const { customerId } = useCustomer();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<TraxMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(0);

  // Restore this customer's conversation; a different customer starts empty.
  useEffect(() => {
    if (!customerId) return setMessages([]);
    try {
      const saved = sessionStorage.getItem(storageKey(customerId));
      setMessages(saved ? (JSON.parse(saved) as TraxMessage[]) : []);
    } catch {
      setMessages([]);
    }
  }, [customerId]);

  useEffect(() => {
    if (!customerId) return;
    try {
      sessionStorage.setItem(storageKey(customerId), JSON.stringify(messages.slice(-40)));
    } catch {
      /* not remembered — harmless */
    }
  }, [customerId, messages]);

  const toggle = useCallback(() => setOpen((value) => !value), []);

  // ⌘J, as on the operator portal.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      if (event.key.toLowerCase() !== 'j') return;
      event.preventDefault();
      toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);

  const send = useCallback(
    async (text: string) => {
      const question = text.trim();
      if (!question || isLoading || !tenant?.id) return;
      const user: TraxMessage = { id: newId(), role: 'user', content: question, at: Date.now() };
      const history = [...messages, user];
      setMessages(history);
      setIsLoading(true);
      setError(null);
      const ticket = ++pending.current;
      try {
        const { data, error: invokeError } = await supabase.functions.invoke('customer-trax', {
          body: { tenant_id: tenant.id, messages: history.map(({ role, content }) => ({ role, content })) },
        });
        if (ticket !== pending.current) return;
        if (invokeError || !data?.ok || typeof data.answer !== 'string') {
          throw new Error((data as { error?: string } | null)?.error ?? 'Trax could not answer just now. Please try again.');
        }
        setMessages((current) => [...current, { id: newId(), role: 'assistant', content: data.answer, at: Date.now() }]);
      } catch (cause) {
        if (ticket !== pending.current) return;
        setError(cause instanceof Error ? cause.message : 'Trax could not answer just now. Please try again.');
      } finally {
        if (ticket === pending.current) setIsLoading(false);
      }
    },
    [isLoading, messages, tenant?.id],
  );

  const startNew = useCallback(() => {
    pending.current += 1;
    setMessages([]);
    setError(null);
    setIsLoading(false);
  }, []);

  const value = useMemo<TraxContextValue>(
    () => ({ open, setOpen, toggle, messages, isLoading, error, send, startNew }),
    [open, toggle, messages, isLoading, error, send, startNew],
  );

  return <TraxContext.Provider value={value}>{children}</TraxContext.Provider>;
}

export function useCustomerTrax(): TraxContextValue {
  const value = useContext(TraxContext);
  if (!value) throw new Error('useCustomerTrax must be used inside CustomerTraxProvider');
  return value;
}
