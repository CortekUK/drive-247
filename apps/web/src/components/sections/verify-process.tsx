"use client";

import { ArrowLeft, CheckCircle2, Shield } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useReveal } from "./operations-dashboard";
import "./verify-process.css";

/*
 * The real ID check, played through: the QR panel from the customer portal on the left, the
 * phone capture page on the right, with the portal's own wording and progress. Rebuilt in
 * HTML with a made-up renter, because the real pages need a live camera and a live session.
 * The QR code only opens drive-247.com.
 */
const SCENES = [
  { id: "qr", ms: 2800, label: "Waiting for you to scan the code", percent: 0 },
  { id: "front", ms: 2600, label: "Photographing the front", percent: 20 },
  { id: "back", ms: 2600, label: "Photographing the back", percent: 45 },
  { id: "selfie", ms: 2600, label: "Taking your selfie", percent: 65 },
  { id: "done", ms: 4200, label: "Finished", percent: 100 },
];
const LAST = SCENES.length - 1;

function useScene(playing: boolean) {
  const [scene, setScene] = useState(LAST);

  useEffect(() => {
    if (!playing || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setScene(LAST);
      return;
    }
    let current = 0;
    let timer = 0;
    const show = () => {
      setScene(current);
      timer = window.setTimeout(() => {
        current = (current + 1) % SCENES.length;
        show();
      }, SCENES[current].ms);
    };
    show();
    return () => window.clearTimeout(timer);
  }, [playing]);

  return scene;
}

/*
 * Noah, drawn: one illustrated person, the same on his licence and in his selfie, so the
 * match reads at a glance. Firm outlines and flat fills, in the brand's purple family.
 */
function Person({ framed }: { framed?: boolean }) {
  return (
    <svg className="vp-person" viewBox="0 0 120 140" aria-hidden>
      {framed && <rect width="120" height="140" fill="#dcd8fb" />}
      {/* Shoulders and shirt */}
      <path d="M8 140c2-30 22-44 52-44s50 14 52 44Z" fill="#4f44d8" stroke="#1c1a4a" strokeWidth="2.6" strokeLinejoin="round" />
      <path d="M46 98l14 16 14-16" fill="#fff" stroke="#1c1a4a" strokeWidth="2.6" strokeLinejoin="round" />
      {/* Neck */}
      <path d="M50 80v18c3 5 17 5 20 0V80Z" fill="#e8b99a" stroke="#1c1a4a" strokeWidth="2.6" strokeLinejoin="round" />
      {/* Ears and face */}
      <ellipse cx="34" cy="58" rx="6" ry="8" fill="#e8b99a" stroke="#1c1a4a" strokeWidth="2.6" />
      <ellipse cx="86" cy="58" rx="6" ry="8" fill="#e8b99a" stroke="#1c1a4a" strokeWidth="2.6" />
      <path d="M36 52c0-18 10-28 24-28s24 10 24 28v8c0 16-11 26-24 26S36 76 36 60Z" fill="#f2c9ab" stroke="#1c1a4a" strokeWidth="2.6" strokeLinejoin="round" />
      {/* Hair */}
      <path d="M34 56c-4-24 8-38 28-38 14 0 26 8 26 24 0 6-2 10-4 14-2-10-8-16-16-18-8 6-20 8-30 6-2 4-3 8-4 12Z" fill="#2a2140" stroke="#1c1a4a" strokeWidth="2.6" strokeLinejoin="round" />
      {/* Eyes, brows, smile */}
      <circle cx="51" cy="58" r="2.6" fill="#1c1a4a" />
      <circle cx="69" cy="58" r="2.6" fill="#1c1a4a" />
      <path d="M46 50q5-3 10 0M64 50q5-3 10 0" fill="none" stroke="#1c1a4a" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M52 70q8 7 16 0" fill="none" stroke="#1c1a4a" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

function Licence({ side }: { side: "front" | "back" }) {
  if (side === "back") {
    return (
      <div className="vp-licence is-back">
        <i className="vp-strip" />
        <i className="vp-barcode" />
        <small>Sample</small>
      </div>
    );
  }
  return (
    <div className="vp-licence">
      <b>DRIVER LICENSE</b>
      <span className="vp-photo">
        <Person framed />
      </span>
      <span className="vp-lines">
        <em>Noah Bennett</em>
        <i />
        <i />
      </span>
      <small>Sample</small>
    </div>
  );
}

function Camera({ title, subtitle, step, children }: { title: string; subtitle: string; step: number; children: React.ReactNode }) {
  return (
    <div className="vp-camera">
      <div className="vp-camera-top">
        {step > 1 ? <ArrowLeft strokeWidth={2} /> : <span />}
        <span className="vp-dots">
          {[1, 2, 3].map((n) => (
            <i key={n} className={n < step ? "is-past" : n === step ? "is-now" : ""} />
          ))}
        </span>
        <Shield strokeWidth={2} />
      </div>
      <div className="vp-view">{children}</div>
      <div className="vp-camera-foot">
        <b>{title}</b>
        <span>{subtitle}</span>
        <i className="vp-shutter" />
      </div>
    </div>
  );
}

/* `step` hands the steps to the page's scroll. Without it, they play on their own. */
/*
 * A live cursor, as in Figma: whoever is acting moves to where it happens, saying what they
 * are doing. Noah is the renter; on the last step it is the operator, in their portal.
 */
const CURSOR: Record<string, { who: string; says: string; target: string; you?: boolean; at?: [number, number] }> = {
  qr: { who: "Noah", says: "Opening my verification link", target: ".vp-scene.is-on .vp-message u" },
  front: { who: "Noah", says: "Front of my licence", target: ".vp-scene.is-on .vp-shutter" },
  back: { who: "Noah", says: "Now the back", target: ".vp-scene.is-on .vp-shutter" },
  selfie: { who: "Noah", says: "Taking my selfie", target: ".vp-scene.is-on .vp-shutter" },
  done: { who: "Noah", says: "Verified. Ready for pick-up.", target: ".vp-done.is-on > div" },
};

function useCursor(stage: React.RefObject<HTMLDivElement | null>, scene: string) {
  const cursor = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const place = () => {
      const box = stage.current?.getBoundingClientRect();
      const el = stage.current?.querySelector<HTMLElement>(CURSOR[scene].target);
      if (!box || !el || !cursor.current) return;
      const r = el.getBoundingClientRect();
      // A little below and right of centre, so the arrow points at the thing, not over it.
      const [fx, fy] = CURSOR[scene].at ?? [0.62, 0.58];
      cursor.current.style.translate = `${r.left - box.left + r.width * fx}px ${r.top - box.top + r.height * fy}px`;
    };
    // After the scene has swapped in.
    const timer = window.setTimeout(place, 220);
    addEventListener("resize", place);
    return () => {
      window.clearTimeout(timer);
      removeEventListener("resize", place);
    };
  }, [stage, scene]);

  return cursor;
}

export function VerifyProcess({ active, step }: { active: boolean; step?: number }) {
  const { ref, visible } = useReveal();
  const auto = useScene(step === undefined && visible && active);
  const scene = step ?? auto;
  const now = SCENES[scene];
  const cursor = useCursor(ref, now.id);
  const talk = CURSOR[now.id];

  return (
    <div ref={ref} className="vp-stage" data-scene={now.id}>
      {/* What they do on their phone */}
      <div className="vp-phone">
        <div className="vp-phone-screen">
          <div className={`vp-scene${now.id === "qr" ? " is-on" : ""}`}>
            <div className="vp-message">
              <span>Summit Rentals</span>
              <b>Verify your ID</b>
              <p>Hi Noah, please verify your licence before pick-up.</p>
              <u>Start verification</u>
            </div>
          </div>
          <div className={`vp-scene${now.id === "front" ? " is-on" : ""}`}>
            <Camera title="Front of licence" subtitle="Position your licence in the frame" step={1}>
              <Licence side="front" />
            </Camera>
          </div>
          <div className={`vp-scene${now.id === "back" ? " is-on" : ""}`}>
            <Camera title="Back of licence" subtitle="Capture the back of your licence (optional)" step={2}>
              <Licence side="back" />
            </Camera>
          </div>
          <div className={`vp-scene${now.id === "selfie" ? " is-on" : ""}`}>
            <Camera title="Take a Selfie" subtitle="Position your face in the circle" step={3}>
              <span className="vp-oval">
                <Person />
              </span>
            </Camera>
          </div>
          <div className={`vp-scene vp-done${now.id === "done" ? " is-on" : ""}`}>
            <span className="vp-done-ring">
              <CheckCircle2 strokeWidth={2} />
            </span>
            <b>Verified!</b>
            <p>Your identity has been successfully verified.</p>
            <div>
              <small>Verified as</small>
              Noah Bennett
            </div>
          </div>
        </div>
      </div>

      <div ref={cursor} className={`vp-cursor${talk.you ? " is-you" : ""}`} aria-hidden>
        <svg viewBox="0 0 24 24">
          <path d="M3 2.5 20.5 10l-7.4 2.3-3 7.2Z" />
        </svg>
        <span key={now.id}>
          <b>{talk.who}</b>
          {talk.says}
        </span>
      </div>

    </div>
  );
}
