"use client";

// ── The test ring: an incoming call on the app's phone ────────────────────────
//
// Ghulam, Oct 2 2026: the Twilio Calling test should end with the phone
// actually ringing — on the same iPhone the Messages tab draws for a call
// (`PhoneCallPreview`, in its `incoming` mode): the call rings with Decline and
// Accept, Accept connects with a running timer, and it ends on "Call ended".
//
// Used by the northwind demo, where there is no Twilio account to ring from:
// the ringtone is synthesised in the browser (the North American double
// tone), answering reads the test line aloud with the browser's own voice and
// then hangs up, and nothing is called. A REAL tenant's test rings for real
// through `twilio-voice-test-v2` and the portal's own incoming-call screen.
//
// The phone is its own dialog, stacked on the integrations dialog, so its
// buttons stay clickable.

import { useCallback, useEffect, useRef, useState } from "react";
import { PhoneCallPreview } from "@/components/messages-v2/phone-call-preview";

export type RingOutcome = "answered" | "declined" | "missed";

const TEST_LINE = "This is your Drive 2 4 7 test call. Calls to your business number ring right here.";

/** 440 + 480 Hz, the US ring — shortened a little for a test. */
function startRingtone(): () => void {
  let ctx: AudioContext | null = null;
  try {
    ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  } catch {
    return () => {};
  }
  const out = ctx.createGain();
  out.gain.value = 0.07;
  out.connect(ctx.destination);
  const burst = () => {
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const f of [440, 480]) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(1, t + 0.03);
      g.gain.setValueAtTime(1, t + 1.6);
      g.gain.linearRampToValueAtTime(0, t + 1.65);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 1.7);
    }
  };
  burst();
  const id = window.setInterval(burst, 3200);
  return () => {
    window.clearInterval(id);
    void ctx?.close();
    ctx = null;
  };
}

export function useTestRing() {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState("");
  const lineRef = useRef(TEST_LINE);
  const outcome = useRef<RingOutcome>("missed");
  const resolveRef = useRef<((o: RingOutcome) => void) | null>(null);
  const stopRing = useRef<(() => void) | null>(null);
  const timers = useRef<number[]>([]);
  const endRef = useRef<(() => void) | null>(null);
  const timedOut = useRef(false);

  const quiet = useCallback(() => {
    stopRing.current?.();
    stopRing.current = null;
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);

  useEffect(() => () => quiet(), [quiet]);

  const ring = useCallback(
    (number: string, line: string = TEST_LINE) =>
      new Promise<RingOutcome>((resolve) => {
        quiet();
        lineRef.current = line;
        outcome.current = "missed";
        timedOut.current = false;
        resolveRef.current = resolve;
        setFrom(number);
        setOpen(true);
        stopRing.current = startRingtone();
        // Nobody picks up: stop ringing after 25 seconds, like Twilio would.
        timers.current.push(
          window.setTimeout(() => {
            timedOut.current = true;
            endRef.current?.();
          }, 25_000),
        );
      }),
    [quiet],
  );

  const onAnswered = useCallback(() => {
    quiet();
    outcome.current = "answered";
    let done = false;
    const hangUp = () => {
      if (done) return;
      done = true;
      endRef.current?.();
    };
    if ("speechSynthesis" in window) {
      const line = new SpeechSynthesisUtterance(lineRef.current);
      line.rate = 0.98;
      line.onend = () => timers.current.push(window.setTimeout(hangUp, 900));
      window.speechSynthesis.speak(line);
    }
    // In case the browser has no voice, or the line never reports its end.
    timers.current.push(window.setTimeout(hangUp, 9000));
  }, [quiet]);

  const onDeclined = useCallback(() => {
    quiet();
    // The 25-second timer hangs up the ringing phone too; that one is "missed".
    if (!timedOut.current) outcome.current = "declined";
  }, [quiet]);

  const node = (
    <PhoneCallPreview
      open={open}
      incoming
      name="Drive247"
      avatarUrl="/icons/icon-192.png"
      phone={from}
      endRef={endRef}
      onAnswered={onAnswered}
      onDeclined={onDeclined}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          quiet();
          const resolve = resolveRef.current;
          resolveRef.current = null;
          resolve?.(outcome.current);
        }
      }}
    />
  );

  return { ring, node, ringing: open };
}
