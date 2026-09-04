"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

/**
 * Browser Supabase client for the marketing site.
 *
 * Deliberately separate from lib/supabase/server.ts (which is a stateless anon
 * client used by Server Actions and must never hold a session).
 *
 * - `storageKey` is namespaced so a session created here can never collide with
 *   anything else served from drive-247.com.
 * - `detectSessionInUrl: false` — the marketing site is not an auth callback and
 *   must not try to consume tokens from a URL hash.
 * - The session persists on purpose: it is what makes an abandoned signup
 *   resumable after a refresh or a tab close.
 *
 * The module-level singleton is what makes this safe under React 19 StrictMode:
 * the effect that kicks off resume detection runs twice in development, and two
 * GoTrue clients on the same storage key would race each other's token refresh.
 * It is also why nothing here runs at import time — `createClient` touches
 * `localStorage`, so it must only ever be reached from an event handler or an
 * effect, never during render or SSR.
 */
export function getBrowserSupabase(): SupabaseClient {
  if (_client) return _client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  _client = createClient(url, anon, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: "d247-web-auth",
    },
  });
  return _client;
}
