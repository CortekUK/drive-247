"use client";

/**
 * The call screen, drawn as an iPhone — used when the tenant has no Twilio
 * Voice set up, so "Start call" can still be shown end to end.
 *
 * A PREVIEW. Nothing dials, nothing is recorded, nothing is written. It walks
 * the states a real call shows — calling → connected (live timer) → ended — and
 * every button works on the screen: mute, keypad (with the digits you press),
 * speaker and hold toggle, end hangs up. When a tenant's voice is enabled the
 * composer takes the real Twilio path instead and this never opens.
 *
 * `incoming` (added for the Twilio Calling test, Oct 2 2026) plays the other
 * direction: the phone RINGS — Decline and Accept at the bottom, like iOS —
 * and only connects when Accept is pressed. Off by default, so every existing
 * caller behaves exactly as before.
 */

import { useEffect, useState } from "react";
import {
  Grid3x3, Mic, MicOff, Pause, Phone, UserPlus, Video, Volume2,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui-v2/dialog";

type Stage = "ringing" | "calling" | "connected" | "ended";

const KEYS: [string, string][] = [
  ["1", ""], ["2", "ABC"], ["3", "DEF"],
  ["4", "GHI"], ["5", "JKL"], ["6", "MNO"],
  ["7", "PQRS"], ["8", "TUV"], ["9", "WXYZ"],
  ["*", ""], ["0", "+"], ["#", ""],
];

const initials = (name: string) =>
  name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);

function clock(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** One round iOS call button: frosted when off, white when on. */
function CallButton({
  icon: Icon, label, on, onClick, disabled,
}: {
  icon: typeof Mic;
  label: string;
  on?: boolean;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      className="group flex flex-col items-center gap-1.5 disabled:opacity-35"
    >
      <span
        className={`flex h-[64px] w-[64px] items-center justify-center rounded-full transition-colors duration-200 ease-out motion-reduce:transition-none ${
          on ? "bg-white text-neutral-900" : "bg-white/15 text-white group-hover:bg-white/25"
        }`}
      >
        <Icon className="h-[26px] w-[26px]" strokeWidth={1.8} />
      </span>
      <span className="text-[11px] font-medium text-white/90">{label}</span>
    </button>
  );
}

export function PhoneCallPreview({
  open,
  onOpenChange,
  name,
  phone,
  avatarUrl,
  onEnded,
  incoming,
  onAnswered,
  onDeclined,
  endRef,
}: {
  /** Fired once when the call is hung up after connecting. */
  onEnded?: () => void;
  /** Ring as an incoming call; connect only on Accept. */
  incoming?: boolean;
  /** Incoming only: Accept was pressed. */
  onAnswered?: () => void;
  /** Incoming only: Decline was pressed, or the ring was dismissed. */
  onDeclined?: () => void;
  /** Lets the owner hang up from outside (e.g. when a recorded line ends). */
  endRef?: { current: (() => void) | null };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  phone: string;
  avatarUrl?: string | null;
}) {
  const [stage, setStage] = useState<Stage>("calling");
  const [seconds, setSeconds] = useState(0);
  const [muted, setMuted] = useState(false);
  const [speaker, setSpeaker] = useState(false);
  const [held, setHeld] = useState(false);
  const [keypad, setKeypad] = useState(false);
  const [digits, setDigits] = useState("");

  /* Every open is a fresh call. */
  useEffect(() => {
    if (!open) return;
    setStage("calling"); setSeconds(0); setMuted(false); setSpeaker(false);
    setHeld(false); setKeypad(false); setDigits("");
    if (incoming) {
      setStage("ringing");
      return;
    }
    setStage("calling");
    const t = setTimeout(() => setStage("connected"), 2800);
    return () => clearTimeout(t);
  }, [open, incoming]);

  /* The timer runs only while connected and not on hold. */
  useEffect(() => {
    if (!open || stage !== "connected" || held) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [open, stage, held]);

  function answer() {
    setStage("connected");
    onAnswered?.();
  }

  function hangUp() {
    if (stage === "ended") return;
    if (stage === "ringing") onDeclined?.();
    /* Only a call that connected leaves a record — an unanswered ring does not. */
    if (stage === "connected") onEnded?.();
    setStage("ended");
    setTimeout(() => onOpenChange(false), 1100);
  }

  if (endRef) endRef.current = hangUp;

  const status =
    stage === "ringing" ? "mobile"
    : stage === "calling" ? "calling mobile…"
      : stage === "ended" ? "Call ended"
        : held ? "On hold"
          : clock(seconds);

  const now = new Date();
  const statusTime = `${now.getHours() % 12 || 12}:${String(now.getMinutes()).padStart(2, "0")}`;

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : hangUp())}>
      <DialogContent
        showCloseButton={false}
        className="w-auto max-w-none border-0 bg-transparent p-0 shadow-none ring-0 sm:max-w-none"
      >
        <DialogTitle className="sr-only">Call with {name}</DialogTitle>

        {/* The handset: a titanium rim, a black bezel, then the screen. */}
        <div className="rounded-[58px] bg-gradient-to-b from-neutral-300 via-neutral-400 to-neutral-300 p-[3px] shadow-[0_40px_80px_-20px_rgb(0_0_0/0.55),0_12px_24px_-8px_rgb(0_0_0/0.35)]">
          <div className="rounded-[55px] bg-black p-[10px]">
            <div className="relative flex h-[640px] w-[300px] flex-col overflow-hidden rounded-[46px] bg-[radial-gradient(120%_70%_at_50%_0%,#3b3f63_0%,#1d1f33_55%,#0d0e18_100%)] text-white">
              {/* Status bar + Dynamic Island */}
              <div className="relative flex h-12 shrink-0 items-center justify-between px-7 pt-1 text-[13px] font-semibold">
                <span>{statusTime}</span>
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

              {/* Who, and where the call is */}
              <div className="flex flex-col items-center px-6 pt-8 text-center">
                {!keypad && (
                  <div className="mb-4 h-[84px] w-[84px] overflow-hidden rounded-full bg-white/15 ring-1 ring-white/10">
                    {avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center text-[30px] font-medium text-white/90">
                        {initials(name)}
                      </span>
                    )}
                  </div>
                )}
                <p className={`font-normal tracking-tight ${keypad ? "text-[22px]" : "text-[28px]"}`}>{name}</p>
                <p className={`mt-1 text-[15px] ${stage === "ended" ? "text-red-300" : "text-white/70"} ${stage === "connected" && !held ? "tabular-nums" : ""}`}>
                  {keypad && digits ? <span className="text-[26px] tracking-[0.2em] text-white">{digits}</span> : status}
                </p>
                {!keypad && <p className="mt-1 text-[12px] text-white/45">{phone}</p>}
              </div>

              <div className="flex-1" />

              {/* Controls: Decline / Accept while ringing, else the six-button
                  grid, or the keypad in its place */}
              {stage === "ringing" ? null : keypad ? (
                <div className="grid grid-cols-3 gap-x-5 gap-y-3 px-9 pb-3">
                  {KEYS.map(([d, letters]) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDigits((x) => (x + d).slice(-14))}
                      className="flex h-[66px] w-[66px] flex-col items-center justify-center rounded-full bg-white/15 transition-colors duration-200 hover:bg-white/25 active:bg-white/40"
                    >
                      <span className="text-[28px] font-light leading-none">{d}</span>
                      {letters && <span className="mt-0.5 text-[9px] font-semibold tracking-[0.18em] text-white/80">{letters}</span>}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-3 justify-items-center gap-y-5 px-7 pb-6">
                  <CallButton icon={muted ? MicOff : Mic} label="mute" on={muted} onClick={() => setMuted((m) => !m)} disabled={stage !== "connected"} />
                  <CallButton icon={Grid3x3} label="keypad" onClick={() => setKeypad(true)} disabled={stage !== "connected"} />
                  <CallButton icon={Volume2} label="audio" on={speaker} onClick={() => setSpeaker((s) => !s)} disabled={stage === "ended"} />
                  <CallButton icon={UserPlus} label="add call" disabled />
                  <CallButton icon={Video} label="FaceTime" disabled />
                  <CallButton icon={Pause} label="hold" on={held} onClick={() => setHeld((h) => !h)} disabled={stage !== "connected"} />
                </div>
              )}

              {stage === "ringing" ? (
                <div className="flex shrink-0 items-start justify-between px-10 pb-12 pt-2">
                  <button type="button" onClick={hangUp} aria-label="Decline" className="group flex flex-col items-center gap-2">
                    <span className="flex h-[68px] w-[68px] items-center justify-center rounded-full bg-[#ff3b30] transition-[transform,background-color] duration-200 ease-out group-hover:bg-[#ff5147] group-active:scale-95 motion-reduce:transition-none">
                      <Phone className="h-7 w-7 rotate-[135deg] fill-white text-white" />
                    </span>
                    <span className="text-[13px] font-medium text-white/90">Decline</span>
                  </button>
                  <button type="button" onClick={answer} aria-label="Accept" className="group flex flex-col items-center gap-2">
                    <span className="flex h-[68px] w-[68px] items-center justify-center rounded-full bg-[#34c759] transition-[transform,background-color] duration-200 ease-out group-hover:bg-[#3fd463] group-active:scale-95 motion-reduce:transition-none">
                      <Phone className="h-7 w-7 fill-white text-white" />
                    </span>
                    <span className="text-[13px] font-medium text-white/90">Accept</span>
                  </button>
                </div>
              ) : (
              /* End call, and "Hide" beside it while the keypad is up */
              <div className="relative flex shrink-0 items-center justify-center pb-9 pt-2">
                <button
                  type="button"
                  onClick={hangUp}
                  disabled={stage === "ended"}
                  aria-label="End call"
                  className="flex h-[68px] w-[68px] items-center justify-center rounded-full bg-[#ff3b30] shadow-[0_6px_18px_-6px_rgb(255_59_48/0.7)] transition-[transform,background-color] duration-200 ease-out hover:bg-[#ff5147] active:scale-95 motion-reduce:transition-none disabled:opacity-60"
                >
                  <Phone className="h-7 w-7 rotate-[135deg] fill-white text-white" />
                </button>
                {keypad && (
                  <button
                    type="button"
                    onClick={() => setKeypad(false)}
                    className="absolute right-12 text-[15px] font-medium text-white/90 hover:text-white"
                  >
                    Hide
                  </button>
                )}
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
}
