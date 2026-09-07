"use client";

/**
 * The `/dev` control for the Messages conversation previews.
 *
 * Self-contained and modelled on `empty-state-preview.tsx` beside it: it reads
 * and writes `lib/dev-overrides.ts` and nothing else — no tenant, no Supabase —
 * because the selection is a per-browser developer preference, not tenant
 * state. Nothing it does touches the database.
 *
 * The scenarios swap DATA ONLY. Every item still renders through the same
 * timeline components a real message uses, so what is being judged here is the
 * production UI with believable content in it, not a mock screen.
 */

import { useSyncExternalStore } from "react";
import { ArrowUpRight, MessagesSquare } from "lucide-react";

import { Button } from "@/components/ui-v2/button";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui-v2/card";
import {
  MESSAGE_SCENARIOS,
  readMessagesScenario,
  setMessagesScenario,
  subscribeDevOverrides,
  type MessagesScenarioId,
} from "@/lib/dev-overrides";

export function MessagesPreview() {
  const scenario = useSyncExternalStore(
    subscribeDevOverrides,
    () => readMessagesScenario(),
    () => "off" as MessagesScenarioId,
  );

  return (
    <Card className="mt-6">
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-[15px]">
              <MessagesSquare className="h-4 w-4" />
              Conversation previews
            </CardTitle>
            <CardDescription className="mt-1.5">
              Fill a conversation with realistic mocked content so the timeline can be reviewed —
              calls, inbound and outbound email, a failed send, attachments. Nothing is written to
              the database, and the real conversation is one click away.
            </CardDescription>
          </div>
          <Button asChild variant="outline" size="sm" className="shrink-0 gap-1.5 rounded-full">
            <a href="/messages">
              Open Messages
              <ArrowUpRight className="h-3.5 w-3.5" />
            </a>
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        <div className="flex flex-wrap gap-2">
          {MESSAGE_SCENARIOS.map((s) => {
            const active = scenario === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setMessagesScenario(s.id)}
                title={s.hint}
                className={`flex min-w-[150px] flex-1 flex-col items-start gap-0.5 rounded-2xl px-3.5 py-2.5 text-left transition-colors ${
                  active
                    ? "bg-primary/10 text-primary ring-1 ring-primary/25"
                    : "bg-muted/50 text-foreground hover:bg-accent/60"
                }`}
              >
                <span className="text-[13px] font-medium">{s.label}</span>
                <span
                  className={`text-[11px] leading-snug ${
                    active ? "text-primary/70" : "text-muted-foreground"
                  }`}
                >
                  {s.hint}
                </span>
              </button>
            );
          })}
        </div>

        {scenario !== "off" && (
          <p className="mt-4 text-[12px] text-muted-foreground">
            Every conversation currently shows the{" "}
            <strong className="font-medium text-foreground">{scenario}</strong> preview, with a
            banner above the timeline saying so. Choose <strong className="font-medium text-foreground">Off</strong> to
            go back to real data.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
