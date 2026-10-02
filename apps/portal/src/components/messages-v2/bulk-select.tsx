"use client";

/**
 * Bulk message, in place.
 *
 * The operator writes a message in the composer and presses Bulk. Nothing
 * moves: the conversation rail grows a round check on every row and becomes
 * the one bright thing on screen, the rest of the workspace dims, and the
 * operator searches and ticks who should get it. "Send to N" sends the SAME
 * text, on the SAME channel, to each — one ordinary message per customer,
 * through the same `sendMessage` the composer uses, so SMS goes out as SMS and
 * every copy lands in that customer's own thread.
 *
 * The state lives here, above the rail and the thread, because the composer
 * (centre column) starts it and the rail (left column) finishes it — and the
 * Messages layout owns both.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useSocket, type MessageChannel } from "@/contexts/RealtimeChatContext";
import { useToast } from "@/hooks/use-toast";

type BulkMode = Extract<MessageChannel, "in_app" | "sms">;

interface BulkState {
  active: boolean;
  text: string;
  mode: BulkMode;
  selected: ReadonlySet<string>;
  sending: boolean;
  /** Enter selection with the message already written. */
  start: (text: string, mode: BulkMode, onSent?: () => void) => void;
  cancel: () => void;
  toggle: (customerId: string) => void;
  setMany: (customerIds: string[], on: boolean) => void;
  send: () => Promise<void>;
}

const BulkContext = createContext<BulkState | null>(null);

export function BulkSelectProvider({ children }: { children: React.ReactNode }) {
  const { sendMessage } = useSocket();
  const { toast } = useToast();
  const [active, setActive] = useState(false);
  const [text, setText] = useState("");
  const [mode, setMode] = useState<BulkMode>("in_app");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [onSent, setOnSent] = useState<(() => void) | null>(null);

  const start = useCallback((t: string, m: BulkMode, done?: () => void) => {
    setText(t);
    setMode(m);
    setSelected(new Set());
    setOnSent(() => done ?? null);
    setActive(true);
  }, []);

  const cancel = useCallback(() => {
    if (sending) return;
    setActive(false);
    setSelected(new Set());
  }, [sending]);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const setMany = useCallback((ids: string[], on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  const send = useCallback(async () => {
    const ids = Array.from(selected);
    if (!ids.length || !text.trim() || sending) return;
    setSending(true);
    let failed = 0;
    /* One at a time: the transport creates a channel on first contact, and
       firing them all at once is how two copies of the same new channel get
       made. A bulk send is dozens, not thousands — sequential is fine. */
    for (const id of ids) {
      try {
        const result = await sendMessage(id, text.trim(), { bulk: true }, mode);
        if (result && result.ok === false) failed += 1;
      } catch {
        failed += 1;
      }
    }
    setSending(false);
    const sent = ids.length - failed;
    if (failed === 0) {
      toast({ title: "Message sent", description: `Sent to ${sent} customer${sent === 1 ? "" : "s"}.` });
    } else {
      toast({
        title: sent ? "Partly sent" : "Not sent",
        description: `${sent} sent, ${failed} could not be sent. Their threads show which.`,
        variant: sent ? undefined : "destructive",
      });
    }
    if (sent > 0) onSent?.();
    setActive(false);
    setSelected(new Set());
  }, [selected, text, sending, sendMessage, mode, toast, onSent]);

  /* Escape leaves selection, from anywhere on the page. */
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") cancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, cancel]);

  const value = useMemo(
    () => ({ active, text, mode, selected, sending, start, cancel, toggle, setMany, send }),
    [active, text, mode, selected, sending, start, cancel, toggle, setMany, send],
  );
  return <BulkContext.Provider value={value}>{children}</BulkContext.Provider>;
}

/** Null outside the Messages workspace — callers treat that as "no bulk". */
export function useBulkSelect(): BulkState | null {
  return useContext(BulkContext);
}

/**
 * Applied to every column EXCEPT the rail while selecting: dimmed and inert,
 * so the rail is unmistakably the place to act. 200ms fade per the motion rule.
 */
export const BULK_DIM =
  "transition-opacity duration-200 ease-out motion-reduce:transition-none";
export const bulkDimmed = (on: boolean) =>
  `${BULK_DIM} ${on ? "pointer-events-none select-none opacity-35" : ""}`;

/** A column that steps back (dims, goes inert) while the rail is selecting. */
export function BulkDim({
  as: Tag = "div",
  className = "",
  children,
}: {
  as?: "div" | "main";
  className?: string;
  children: React.ReactNode;
}) {
  const bulk = useBulkSelect();
  const on = !!bulk?.active;
  return (
    /* `inert` as a spread string: React 18 has no boolean `inert` prop and
       would print `inert="true"` plus a warning; "" is the attribute present. */
    <Tag className={`${className} ${bulkDimmed(on)}`} {...(on ? { inert: "" } : {})}>
      {children}
    </Tag>
  );
}
