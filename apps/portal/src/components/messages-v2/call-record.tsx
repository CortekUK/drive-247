"use client";

/**
 * The call record that lands in the conversation the moment a call ends:
 * the recording, Trax's summary, the checkpoints the call covered, the action
 * items it produced, and the full transcript — who said what, and when — with
 * a download.
 *
 * PREVIEW DATA. It follows the iPhone call preview (`phone-call-preview.tsx`),
 * which dials nothing, so there is no audio and no real transcript to read.
 * The record is scripted from what the conversation is about (the customer's
 * latest messages), kept in this browser tab only (sessionStorage, per
 * conversation), and never written to the database. The SHAPE matches what
 * the real pipeline stores on `call_logs` — transcript, ai_summary,
 * ai_action_items, duration — so the real thing can drop into this card.
 *
 * The recording plays silently: the progress runs in real time and the
 * transcript line being "spoken" is highlighted as it goes, so the player
 * demonstrates how a recording and its transcript stay in step.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import {
  Check, ChevronDown, Download, Pause, PhoneOutgoing, Play, Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui-v2/button";
import { TraxMark } from "@/components/trax/trax-greeting";

/* ── the scripts ─────────────────────────────────────────────────────────── */

type Speaker = "operator" | "customer";
interface Line { who: Speaker; at: number; text: string }
interface Script {
  lines: (first: string) => Line[];
  summary: (first: string) => string;
  checkpoints: string[];
  actions: (first: string) => string[];
}

const SCRIPTS: Record<"return" | "extend" | "issue" | "checkin", Script> = {
  return: {
    lines: (f) => [
      { who: "operator", at: 0, text: `Hi ${f}, it's about your message on the return time. Have you got a minute?` },
      { who: "customer", at: 6, text: "Yes, of course. I was hoping to bring it back at six instead of five." },
      { who: "operator", at: 12, text: "Six works. I've moved your return slot, and there's nothing extra to pay for the hour." },
      { who: "customer", at: 20, text: "Perfect, thank you. Should I bring it to the same lot?" },
      { who: "operator", at: 25, text: "Same lot. If nobody's at the desk, the keys go in the lockbox by the entrance." },
      { who: "customer", at: 33, text: "Got it. And the tank, full again?" },
      { who: "operator", at: 37, text: "Full, please. If it's a little under we just charge the fuel at cost, no fee on top." },
      { who: "customer", at: 46, text: "Great, I'll fill it up on the way. Thanks for sorting it so quickly." },
      { who: "operator", at: 52, text: "Anytime. I'll text you the confirmation now. Drive safe." },
    ],
    summary: (f) =>
      `${f} asked to return the car at 6pm instead of 5pm. I confirmed the new time at no extra charge, explained the lockbox drop-off if the desk is closed, and reminded them to return it with a full tank.`,
    checkpoints: ["New return time agreed: 6:00 PM", "No charge for the extra hour", "Lockbox drop-off explained", "Full-tank return confirmed"],
    actions: (f) => [`Text ${f} the 6:00 PM return confirmation`, "Update the return time on the rental", "Check the fuel level at check-in"],
  },
  extend: {
    lines: (f) => [
      { who: "operator", at: 0, text: `Hi ${f}, calling about extending your rental.` },
      { who: "customer", at: 5, text: "Yes, I'd like to keep it until Sunday if that's possible." },
      { who: "operator", at: 10, text: "The car's free, so Sunday is fine. That's two extra days." },
      { who: "customer", at: 16, text: "How much will that be?" },
      { who: "operator", at: 19, text: "Same daily rate as your booking. I'll send a payment link with the exact total." },
      { who: "customer", at: 27, text: "Okay, and the deposit stays as it is?" },
      { who: "operator", at: 31, text: "It does, the hold simply carries over to the new return date." },
      { who: "customer", at: 38, text: "Great, send it over and I'll pay straight away." },
    ],
    summary: (f) =>
      `${f} wants to extend until Sunday (two extra days). I confirmed the car is available at the booking's daily rate and that the deposit hold carries over. They'll pay as soon as the link arrives.`,
    checkpoints: ["Extension to Sunday agreed", "Same daily rate", "Deposit hold carries over"],
    actions: (f) => [`Send ${f} the extension payment link`, "Move the rental end date to Sunday", "Confirm once the payment lands"],
  },
  issue: {
    lines: (f) => [
      { who: "operator", at: 0, text: `Hi ${f}, I saw your message about the warning light. Are you somewhere safe?` },
      { who: "customer", at: 6, text: "Yes, I've pulled into a gas station. The check engine light came on about ten minutes ago." },
      { who: "operator", at: 14, text: "Thanks. Is it steady or flashing?" },
      { who: "customer", at: 17, text: "Steady. The car feels completely normal." },
      { who: "operator", at: 21, text: "A steady light is usually not urgent. Can you send me a photo of the dashboard?" },
      { who: "customer", at: 28, text: "Sure, sending it now." },
      { who: "operator", at: 31, text: "If it starts flashing or the car feels different, stop and I'll send roadside assistance." },
      { who: "customer", at: 39, text: "Okay, that's reassuring. Thank you." },
      { who: "operator", at: 43, text: "I'll book it in for a quick check when you're back, at no cost to you." },
    ],
    summary: (f) =>
      `${f} reported a steady check-engine light; the car is driving normally and they're parked safely. I asked for a dashboard photo, explained when to stop driving, and offered a free check on return.`,
    checkpoints: ["Customer is safe", "Light is steady, not flashing", "Dashboard photo requested", "Roadside assistance offered if it worsens"],
    actions: (f) => [`Review ${f}'s dashboard photo`, "Book a diagnostic check on return", "Follow up tomorrow morning"],
  },
  checkin: {
    lines: (f) => [
      { who: "operator", at: 0, text: `Hi ${f}, just a quick call to check everything's going well with the car.` },
      { who: "customer", at: 6, text: "All good, thanks. It's been great." },
      { who: "operator", at: 10, text: "Glad to hear it. Any questions before your return?" },
      { who: "customer", at: 15, text: "Just the return. Same place as pickup?" },
      { who: "operator", at: 19, text: "Same place. I'll send you a reminder the day before." },
      { who: "customer", at: 25, text: "Perfect, thank you." },
    ],
    summary: (f) =>
      `Courtesy check-in with ${f}. Everything is fine with the car. Confirmed the return is at the pickup location and that a reminder goes out the day before.`,
    checkpoints: ["No issues with the car", "Return location confirmed"],
    actions: (f) => [`Send ${f} a return reminder the day before`],
  },
};

function pickScript(context: string): keyof typeof SCRIPTS {
  if (/check engine|warning light|engine light|flat|won'?t start|breakdown/i.test(context)) return "issue";
  if (/extend|extension|until (mon|tue|wed|thu|fri|sat|sun)|keep (it|the car)/i.test(context)) return "extend";
  if (/return|6 ?pm|5 ?pm|drop (it )?off|airport/i.test(context)) return "return";
  return "checkin";
}

/* ── the stored record ───────────────────────────────────────────────────── */

export interface CallRecord {
  id: string;
  endedAt: string;
  script: keyof typeof SCRIPTS;
}

const storeKey = (channelId: string) => `d247.messages.callRecords.${channelId}`;

/** This conversation's preview call records, kept for the tab's lifetime. */
export function useCallRecords(channelId: string) {
  const [records, setRecords] = useState<CallRecord[]>([]);
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(storeKey(channelId));
      setRecords(raw ? (JSON.parse(raw) as CallRecord[]) : []);
    } catch {
      setRecords([]);
    }
  }, [channelId]);

  function add(context: string) {
    const rec: CallRecord = {
      id: `${Date.now()}`,
      endedAt: new Date().toISOString(),
      script: pickScript(context),
    };
    setRecords((prev) => {
      const next = [...prev, rec];
      try { sessionStorage.setItem(storeKey(channelId), JSON.stringify(next)); } catch { /* private mode */ }
      return next;
    });
  }
  return { records, add };
}

/* ── the card ────────────────────────────────────────────────────────────── */

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Deterministic bar heights, so the waveform does not reshuffle on render. */
function bars(seed: string, n = 64) {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return Array.from({ length: n }, (_, i) => {
    h = (h * 1103515245 + 12345) >>> 0;
    const base = 0.25 + ((h >>> 16) % 1000) / 1000 * 0.75;
    const taper = Math.sin((i / (n - 1)) * Math.PI) * 0.35 + 0.65;
    return Math.max(0.14, base * taper);
  });
}

function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
        {icon}
        {title}
      </p>
      {children}
    </div>
  );
}

export function CallRecordCard({
  record,
  customerName,
  operatorName = "You",
}: {
  record: CallRecord;
  customerName: string;
  operatorName?: string;
}) {
  const first = customerName.split(" ")[0] || "Customer";
  const script = SCRIPTS[record.script];
  const lines = useMemo(() => script.lines(first), [script, first]);
  const duration = lines[lines.length - 1].at + 8;
  const actions = useMemo(() => script.actions(first), [script, first]);
  const wave = useMemo(() => bars(record.id), [record.id]);

  /* Trax "writes" the summary for a moment after the call, as the real
     pipeline would, so the record visibly arrives rather than just appears. */
  const fresh = Date.now() - new Date(record.endedAt).getTime() < 4000;
  const [writing, setWriting] = useState(fresh);
  useEffect(() => {
    if (!writing) return;
    const t = setTimeout(() => setWriting(false), 2200);
    return () => clearTimeout(t);
  }, [writing]);

  const [pos, setPos] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [done, setDone] = useState<Set<number>>(new Set());
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      setPos((p) => {
        if (p + 0.25 >= duration) { setPlaying(false); return duration; }
        return p + 0.25;
      });
    }, 250);
    return () => clearInterval(t);
  }, [playing, duration]);

  const current = (() => {
    let idx = -1;
    lines.forEach((l, i) => { if (pos >= l.at) idx = i; });
    return playing || pos > 0 ? idx : -1;
  })();

  /* Playing reveals the whole transcript so the highlighted line is on screen. */
  useEffect(() => { if (playing) setShowAll(true); }, [playing]);

  function seek(e: React.MouseEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    setPos(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * duration);
  }

  function download() {
    const ended = new Date(record.endedAt);
    const text = [
      `Call with ${customerName}`,
      `${format(ended, "MMMM d, yyyy 'at' h:mm a")} · Outgoing · ${clock(duration)}`,
      "",
      "SUMMARY",
      script.summary(first),
      "",
      "CHECKPOINTS",
      ...script.checkpoints.map((c) => `- ${c}`),
      "",
      "ACTION ITEMS",
      ...actions.map((a) => `[ ] ${a}`),
      "",
      "TRANSCRIPT",
      ...lines.map((l) => `[${clock(l.at)}] ${l.who === "operator" ? operatorName : customerName}: ${l.text}`),
      "",
    ].join("\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `call-${customerName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${format(ended, "yyyy-MM-dd-HHmm")}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const visible = showAll ? lines : lines.slice(0, 3);

  return (
    <div className="my-6 flex justify-center">
      <div className="w-full max-w-3xl rounded-3xl bg-card p-5 ring-1 ring-primary/15 shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_12px_32px_-18px_hsl(var(--primary)/0.35)] dark:ring-[hsl(var(--v2-link,var(--primary))_/_0.2)] animate-in fade-in slide-in-from-bottom-3 duration-200 motion-reduce:animate-none">
        {/* Header */}
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <PhoneOutgoing className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold">Call with {customerName}</p>
            <p className="text-[12px] text-muted-foreground">
              Outgoing · {clock(duration)} · {format(new Date(record.endedAt), "h:mm a")}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={download} className="h-8 gap-1.5 rounded-full text-[12px]">
            <Download className="h-3.5 w-3.5" />
            Transcript
          </Button>
        </div>

        {/* Recording */}
        <div className="mt-4 flex items-center gap-3 rounded-2xl bg-primary/[0.05] px-3 py-2.5 dark:bg-[hsl(var(--v2-hover,var(--muted)))]">
          <button
            type="button"
            onClick={() => { if (pos >= duration) setPos(0); setPlaying((p) => !p); }}
            aria-label={playing ? "Pause recording" : "Play recording"}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors duration-200 hover:bg-primary/90"
          >
            {playing ? <Pause className="h-4 w-4 fill-current" /> : <Play className="ml-0.5 h-4 w-4 fill-current" />}
          </button>
          <div className="flex h-8 flex-1 cursor-pointer items-center gap-[2px]" onClick={seek} role="slider" aria-label="Recording position" aria-valuemin={0} aria-valuemax={duration} aria-valuenow={Math.round(pos)}>
            {wave.map((h, i) => (
              <span
                key={i}
                className={`flex-1 rounded-full transition-colors duration-200 ${
                  i / wave.length <= pos / duration ? "bg-primary" : "bg-primary/20"
                }`}
                style={{ height: `${h * 100}%` }}
              />
            ))}
          </div>
          <span className="w-[76px] shrink-0 text-right text-[11.5px] tabular-nums text-muted-foreground">
            {clock(pos)} / {clock(duration)}
          </span>
        </div>

        {writing ? (
          <div className="mt-5 flex items-center gap-2.5 text-[13px] text-muted-foreground">
            <TraxMark size="xs" animated />
            I&apos;m writing up the call…
          </div>
        ) : (
          <div className="mt-5 space-y-5 animate-in fade-in duration-200 motion-reduce:animate-none">
            <Section title="Summary" icon={<Sparkles className="h-3 w-3 text-primary" />}>
              <p className="text-[13.5px] leading-relaxed text-foreground/90">{script.summary(first)}</p>
            </Section>

            <div className="grid gap-5 sm:grid-cols-2">
              <Section title="Checkpoints">
                <ul className="space-y-1.5">
                  {script.checkpoints.map((c) => (
                    <li key={c} className="flex items-start gap-2 text-[13px]">
                      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                        <Check className="h-2.5 w-2.5" strokeWidth={3} />
                      </span>
                      {c}
                    </li>
                  ))}
                </ul>
              </Section>
              <Section title="Action items">
                <ul className="space-y-1">
                  {actions.map((a, i) => {
                    const on = done.has(i);
                    return (
                      <li key={a}>
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={on}
                          onClick={() => setDone((d) => { const n = new Set(d); n.has(i) ? n.delete(i) : n.add(i); return n; })}
                          className="flex w-full items-start gap-2 rounded-lg py-0.5 text-left text-[13px]"
                        >
                          <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border-2 transition-colors duration-200 ${on ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/30"}`}>
                            {on && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
                          </span>
                          <span className={on ? "text-muted-foreground line-through" : ""}>{a}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </Section>
            </div>

            <Section title="Transcript">
              <div className="space-y-2.5">
                {visible.map((l, i) => {
                  const op = l.who === "operator";
                  const live = i === current;
                  return (
                    <div
                      key={i}
                      ref={(el) => { lineRefs.current[i] = el; }}
                      onClick={() => setPos(l.at)}
                      className={`flex cursor-pointer gap-3 rounded-xl px-2 py-1.5 transition-colors duration-200 ${live ? "bg-primary/10" : "hover:bg-[hsl(var(--v2-hover,var(--accent)_/_0.5))]"}`}
                    >
                      <span className="w-9 shrink-0 pt-0.5 text-[11px] tabular-nums text-muted-foreground">{clock(l.at)}</span>
                      <div className="min-w-0">
                        <p className={`text-[11.5px] font-semibold ${op ? "text-primary dark:text-[hsl(var(--v2-link,var(--primary)))]" : "text-foreground"}`}>
                          {op ? operatorName : customerName}
                        </p>
                        <p className="text-[13px] leading-relaxed text-foreground/85">{l.text}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
              {lines.length > 3 && (
                <button
                  type="button"
                  onClick={() => setShowAll((s) => !s)}
                  className="mt-2 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[12px] font-medium text-primary transition-colors duration-200 hover:bg-primary/10 dark:text-[hsl(var(--v2-link,var(--primary)))]"
                >
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${showAll ? "rotate-180" : ""}`} />
                  {showAll ? "Show less" : `Show all ${lines.length} lines`}
                </button>
              )}
            </Section>
          </div>
        )}
      </div>
    </div>
  );
}
