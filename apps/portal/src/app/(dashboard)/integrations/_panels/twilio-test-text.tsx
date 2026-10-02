"use client";

// ── The test text: an SMS arriving on the app's phone ─────────────────────────
//
// Ghulam, Oct 2 2026: Twilio Messages gets the same "real kind of test" as
// Calling's ringing phone. This is the same iPhone (`PhoneCallPreview`'s
// frame — titanium rim, Dynamic Island, the same screen gradient), showing
// what a customer sees: the lock screen, then the text sliding in from
// Drive247 with the iOS tri-tone; tap it and the conversation opens.
//
// It only ever shows a text Twilio has actually accepted (Send a test), or —
// on the northwind demo, where nothing is sent — the stand-in. It never claims
// delivery: Twilio accepting a text is what this proves; the handset is the
// picture of where it goes.

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui-v2/dialog";

const LOGO = "/icons/icon-192.png";

/** The iOS tri-tone, near enough: three short rising notes. */
function ding() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const out = ctx.createGain();
    out.gain.value = 0.08;
    out.connect(ctx.destination);
    [1174.7, 1568, 1396.9].forEach((f, i) => {
      const t = ctx.currentTime + i * 0.13;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = f;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(1, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.3);
    });
    window.setTimeout(() => void ctx.close(), 900);
  } catch {
    /* no audio — the picture still tells it */
  }
}

type Stage = "lock" | "notified" | "thread";

export function useTestText() {
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState({ from: "", text: "" });
  const [stage, setStage] = useState<Stage>("lock");
  const resolveRef = useRef<(() => void) | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  const show = useCallback(
    (from: string, text: string) =>
      new Promise<void>((resolve) => {
        resolveRef.current = resolve;
        setMsg({ from, text });
        setStage("lock");
        setOpen(true);
        // A beat of lock screen, then the text arrives.
        timer.current = window.setTimeout(() => {
          setStage("notified");
          ding();
        }, 900);
      }),
    [],
  );

  const close = () => {
    setOpen(false);
    if (timer.current) window.clearTimeout(timer.current);
    const r = resolveRef.current;
    resolveRef.current = null;
    r?.();
  };

  const now = new Date();
  const hh = now.getHours() % 12 || 12;
  const mm = String(now.getMinutes()).padStart(2, "0");
  const date = now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  const node = (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent showCloseButton={false} className="w-auto max-w-none border-0 bg-transparent p-0 shadow-none ring-0 sm:max-w-none">
        <DialogTitle className="sr-only">A text from Drive247</DialogTitle>
        <div className="rounded-[58px] bg-gradient-to-b from-neutral-300 via-neutral-400 to-neutral-300 p-[3px] shadow-[0_40px_80px_-20px_rgb(0_0_0/0.55),0_12px_24px_-8px_rgb(0_0_0/0.35)]">
          <div className="rounded-[55px] bg-black p-[10px]">
            <div className="relative flex h-[640px] w-[300px] flex-col overflow-hidden rounded-[46px] bg-[radial-gradient(120%_70%_at_50%_0%,#3b3f63_0%,#1d1f33_55%,#0d0e18_100%)] text-white">
              {/* Status bar + Dynamic Island */}
              <div className="relative flex h-12 shrink-0 items-center justify-between px-7 pt-1 text-[13px] font-semibold">
                <span>{stage === "thread" ? `${hh}:${mm}` : ""}</span>
                <span className="absolute left-1/2 top-2.5 h-[30px] w-[100px] -translate-x-1/2 rounded-full bg-black" />
                <span className="flex items-center gap-1">
                  <span className="flex items-end gap-[2px]">
                    {[4, 6, 8, 10].map((h) => <span key={h} className="w-[3px] rounded-sm bg-white" style={{ height: h }} />)}
                  </span>
                  <span className="ml-1 inline-flex h-[11px] w-[22px] items-center rounded-[3px] border border-white/60 p-[1.5px]">
                    <span className="h-full w-[70%] rounded-[1.5px] bg-white" />
                  </span>
                </span>
              </div>

              {stage === "thread" ? (
                /* The conversation, as Messages opens it */
                <div className="flex min-h-0 flex-1 flex-col duration-200 ease-out animate-in fade-in-0 motion-reduce:animate-none">
                  <div className="relative flex flex-col items-center border-b border-white/10 pb-3 pt-1">
                    <button type="button" onClick={close} aria-label="Close" className="absolute left-3 top-3 text-[#0a84ff]">
                      <ChevronLeft className="h-7 w-7" />
                    </button>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={LOGO} alt="" className="h-12 w-12 rounded-full bg-white object-cover" />
                    <p className="mt-1 text-[12px] font-medium">Drive247</p>
                    <p className="text-[10px] text-white/45">{msg.from}</p>
                  </div>
                  <div className="flex-1 space-y-2 px-3 pt-4">
                    <p className="text-center text-[10px] text-white/45">Text Message · Today {hh}:{mm}</p>
                    <div className="max-w-[78%] rounded-[18px] rounded-bl-[6px] bg-[#3a3a3c] px-3 py-2 text-[14px] leading-snug duration-200 ease-out animate-in fade-in-0 slide-in-from-bottom-2 motion-reduce:animate-none">
                      {msg.text}
                    </div>
                  </div>
                  <div className="mx-3 mb-9 flex h-9 items-center rounded-full border border-white/20 px-4 text-[13px] text-white/35">
                    Text Message
                  </div>
                </div>
              ) : (
                /* The lock screen, and the text arriving on it */
                <div className="flex flex-1 flex-col items-center">
                  <p className="mt-4 text-[13px] font-medium text-white/80">{date}</p>
                  <p className="text-[72px] font-semibold leading-none tracking-tight">{hh}:{mm}</p>
                  {stage === "notified" && (
                    <button
                      type="button"
                      onClick={() => setStage("thread")}
                      className="mt-8 w-[268px] rounded-[22px] bg-white/15 p-3 text-left backdrop-blur-md duration-200 ease-out animate-in fade-in-0 slide-in-from-top-3 hover:bg-white/20 motion-reduce:animate-none"
                    >
                      <span className="flex items-start gap-2.5">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={LOGO} alt="" className="h-9 w-9 shrink-0 rounded-full bg-white object-cover" />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline justify-between gap-2">
                            <span className="truncate text-[13px] font-semibold">Drive247</span>
                            <span className="shrink-0 text-[11px] text-white/60">now</span>
                          </span>
                          <span className="mt-0.5 line-clamp-3 block text-[13px] leading-snug text-white/90">{msg.text}</span>
                        </span>
                      </span>
                    </button>
                  )}
                  <div className="flex-1" />
                  <p className="mb-9 text-[12px] text-white/50">{stage === "notified" ? "Tap the text to open it" : ""}</p>
                </div>
              )}

              {/* Home indicator */}
              <span className="absolute bottom-2 left-1/2 h-[5px] w-[120px] -translate-x-1/2 rounded-full bg-white/80" />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );

  return { show, node };
}
