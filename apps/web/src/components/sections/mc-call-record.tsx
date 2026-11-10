"use client";

import { Check, ChevronDown, Download, Pause, PhoneOutgoing, Play, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { TrackLabel } from "./track-label";

/*
 * The call record in the landing's multi-chat, after the portal's own
 * (apps/portal/src/components/messages-v2/call-record.tsx): the recording, Trax's summary,
 * the checkpoints the call covered, the action items it produced (tick them off), and the
 * transcript, with the line being "spoken" lit as the recording plays. Made-up call; the
 * recording plays silently, as the portal's preview does (Ghulam, 2026-11-10: "show the recent
 * call transcript and all action points, see the portal's actual functionality").
 */

export type CallLine = { who: "you" | "them"; at: number; text: string };
export type CallRecordData = {
  summary: string;
  checkpoints: string[];
  actions: string[];
  lines: CallLine[];
};

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Bar heights from a seed, so the waveform is the same on every render. */
function bars(seed: string, n = 56) {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return Array.from({ length: n }, (_, i) => {
    h = (h * 1103515245 + 12345) >>> 0;
    const base = 0.25 + (((h >>> 16) % 1000) / 1000) * 0.75;
    const taper = Math.sin((i / (n - 1)) * Math.PI) * 0.35 + 0.65;
    return Math.max(0.14, base * taper);
  });
}

export function CallRecordCard({ record, name, at, minutes, labels = false }: { record: CallRecordData; name: string; at: string; minutes: number; labels?: boolean }) {
  // The lines are the call's opening; its length is the call's own (as on the conversation list).
  const scale = (minutes * 60 - 8) / record.lines[record.lines.length - 1].at;
  const lines = useMemo(() => record.lines.map((l) => ({ ...l, at: Math.round(l.at * scale) })), [record.lines, scale]);
  const duration = minutes * 60;
  const wave = useMemo(() => bars(name), [name]);
  const [pos, setPos] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [done, setDone] = useState<Set<number>>(() => new Set([0]));

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      setPos((p) => {
        if (p + 0.25 >= duration) {
          setPlaying(false);
          return duration;
        }
        return p + 0.25;
      });
    }, 250);
    return () => clearInterval(t);
  }, [playing, duration]);
  useEffect(() => {
    if (playing) setShowAll(true);
  }, [playing]);

  let current = -1;
  if (playing || pos > 0) lines.forEach((l, i) => pos >= l.at && (current = i));
  const visible = showAll ? lines : lines.slice(0, 2);
  const first = name.split(" ")[0];

  return (
    <div className="mcr">
      <div className="mcr-head">
        <span className="mcr-icon">
          <PhoneOutgoing aria-hidden />
        </span>
        <span className="mcr-title">
          <b>Call with {name}</b>
          <small>
            Outgoing · {clock(duration)} · {at}
          </small>
        </span>
        <button type="button" className="mcr-dl">
          <Download aria-hidden />
          Transcript
        </button>
      </div>

      <div className="mcr-player">
        <button
          type="button"
          className="mcr-play"
          aria-label={playing ? "Pause recording" : "Play recording"}
          onClick={() => {
            if (pos >= duration) setPos(0);
            setPlaying((p) => !p);
          }}
        >
          {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
        </button>
        <div
          className="mcr-wave"
          role="slider"
          aria-label="Recording position"
          aria-valuemin={0}
          aria-valuemax={duration}
          aria-valuenow={Math.round(pos)}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setPos(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * duration);
          }}
        >
          {wave.map((h, i) => (
            <span key={i} className={i / wave.length <= pos / duration ? "is-on" : ""} style={{ height: `${h * 100}%` }} />
          ))}
        </div>
        <small className="mcr-time">
          {clock(pos)} / {clock(duration)}
        </small>
        {labels && (
          <TrackLabel n={2} way="left">
            Every call recorded
          </TrackLabel>
        )}
      </div>

      <p className="mcr-label">
        <Sparkles aria-hidden />
        Summary
      </p>
      <p className="mcr-summary">{record.summary}</p>

      <div className="mcr-cols">
        <div>
          <p className="mcr-label">Checkpoints</p>
          <ul className="mcr-checks">
            {record.checkpoints.map((c) => (
              <li key={c}>
                <i>
                  <Check strokeWidth={3} aria-hidden />
                </i>
                {c}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="mcr-label">Action items</p>
          <ul className="mcr-actions">
            {record.actions.map((a, i) => {
              const on = done.has(i);
              return (
                <li key={a}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    className={on ? "is-done" : ""}
                    onClick={() =>
                      setDone((d) => {
                        const n = new Set(d);
                        if (n.has(i)) n.delete(i);
                        else n.add(i);
                        return n;
                      })
                    }
                  >
                    <i>{on && <Check strokeWidth={3} aria-hidden />}</i>
                    <span>{a}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      <p className="mcr-label">
        Transcript
        {labels && (
          <TrackLabel n={3} way="left">
            Trax sums up every call
          </TrackLabel>
        )}
      </p>
      <div className="mcr-lines">
        {visible.map((l, i) => (
          <button type="button" key={i} className={`mcr-line${i === current ? " is-live" : ""}`} onClick={() => setPos(l.at)}>
            <small>{clock(l.at)}</small>
            <span>
              <b className={l.who === "you" ? "is-you" : ""}>{l.who === "you" ? "You" : first}</b>
              {l.text}
            </span>
          </button>
        ))}
      </div>
      {lines.length > 2 && (
        <button type="button" className="mcr-more" onClick={() => setShowAll((s) => !s)}>
          <ChevronDown aria-hidden className={showAll ? "is-up" : ""} />
          {showAll ? "Show less" : `Show all ${lines.length} lines`}
        </button>
      )}
    </div>
  );
}
