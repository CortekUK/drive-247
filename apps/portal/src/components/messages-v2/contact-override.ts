"use client";

/**
 * A different phone or email for ONE conversation — never the customer record.
 *
 * The operator sometimes needs to reach a customer somewhere other than the
 * details on file: "call me on my work phone today", "send it to my office
 * address". That is a fact about this conversation, at this moment, not a
 * correction to the customer — so it lives here, per conversation, in this
 * browser tab (sessionStorage), and is never written to `customers`. Editing
 * the record stays where it always was: the customer screen.
 *
 * Read by the right rail (where it is set), the composer (email "To", and the
 * SMS/email send path, which routes to `send-conversation-message-v2` while an
 * override is active) and the call button (which dials the override).
 */

import { useSyncExternalStore } from "react";

/** The composer channels an operator can make the default for a chat. */
export type PreferredChannel = "in_app" | "sms" | "email" | "call";

export interface ContactOverride {
  /** The email IN USE for this chat, when it is not the one on record. */
  email?: string;
  /** The phone IN USE for this chat, when it is not the one on record. */
  phone?: string;
  /** Extra addresses added for this chat (the record's is never listed here). */
  emails?: string[];
  /** Extra numbers added for this chat. */
  phones?: string[];
  /** Which channel the composer opens on for this chat. */
  channel?: PreferredChannel;
}

const KEY = (channelId: string) => `d247.messages.contactOverride.${channelId}`;
const listeners = new Set<() => void>();
const cache = new Map<string, ContactOverride>();

function read(channelId: string): ContactOverride {
  if (cache.has(channelId)) return cache.get(channelId)!;
  let value: ContactOverride = {};
  try {
    const raw = sessionStorage.getItem(KEY(channelId));
    if (raw) value = JSON.parse(raw) as ContactOverride;
  } catch {
    /* private mode, or nothing stored */
  }
  cache.set(channelId, value);
  return value;
}

function write(channelId: string, value: ContactOverride) {
  const clean: ContactOverride = {};
  if (value.email?.trim()) clean.email = value.email.trim();
  if (value.phone?.trim()) clean.phone = value.phone.trim();
  if (value.channel) clean.channel = value.channel;
  const uniq = (xs?: string[]) => Array.from(new Set((xs ?? []).map((x) => x.trim()).filter(Boolean)));
  if (uniq(value.emails).length) clean.emails = uniq(value.emails);
  if (uniq(value.phones).length) clean.phones = uniq(value.phones);
  cache.set(channelId, clean);
  try {
    if (clean.email || clean.phone || clean.channel || clean.emails || clean.phones) sessionStorage.setItem(KEY(channelId), JSON.stringify(clean));
    else sessionStorage.removeItem(KEY(channelId));
  } catch {
    /* fine — it still holds for this page */
  }
  listeners.forEach((l) => l());
}

const EMPTY: ContactOverride = {};

export function useContactOverride(channelId: string) {
  const value = useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => read(channelId),
    () => EMPTY,
  );
  return {
    override: value,
    setEmail: (email: string | null) => write(channelId, { ...read(channelId), email: email ?? undefined }),
    setPhone: (phone: string | null) => write(channelId, { ...read(channelId), phone: phone ?? undefined }),
    /** Replace the whole override at once — what the edit dialog saves. */
    setAll: (next: ContactOverride) => write(channelId, next),
  };
}

export const looksLikeEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
export const looksLikePhone = (s: string) => s.replace(/[^\d]/g, "").length >= 7;
