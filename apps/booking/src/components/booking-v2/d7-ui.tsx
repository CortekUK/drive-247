"use client";

/**
 * booking-v2 effect kit.
 *
 * Ports of the Aceternity UI and Magic UI components this landing page uses,
 * adapted to live inside the `.d7` namespace: their keyframes are declared in
 * `app/booking-v2/v2.css` rather than in the booking app's shared
 * tailwind.config.ts, and colours come from the `--v*` tokens.
 *
 * Everything here is presentational and dependency-light — framer-motion for
 * spring/scroll-driven work, plain CSS for anything that loops forever (a CSS
 * animation keeps running off the main thread; a JS one does not).
 */

import {
  AnimatePresence, motion, useInView, useMotionTemplate, useMotionValue,
  useScroll, useSpring, useTransform, type MotionValue,
} from "framer-motion";
import {
  useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

/* Reduced motion, read once per component that needs to branch on it. */
export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

const useFinePointer = () => {
  const [fine, setFine] = useState(false);
  useEffect(() => { setFine(window.matchMedia("(pointer: fine)").matches); }, []);
  return fine;
};

/* ========================================================================== */
/* BACKGROUNDS                                                                */
/* ========================================================================== */

/** Aceternity — Aurora Background. Two masked conic-ish gradients drifting. */
export function AuroraBackground({ className, children }: {
  className?: string; children?: ReactNode;
}) {
  return (
    <div className={cn("relative overflow-hidden", className)}>
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden" style={{ maskImage: "radial-gradient(ellipse at 60% 0%, black 12%, transparent 74%)", WebkitMaskImage: "radial-gradient(ellipse at 60% 0%, black 12%, transparent 74%)" }}>
        <div
          className="d7-aurora absolute -inset-[12rem] opacity-45 blur-[9px] will-change-transform"
          style={{
            backgroundImage:
              "repeating-linear-gradient(100deg,#fff 0%,#fff 7%,transparent 10%,transparent 12%,#fff 16%)," +
              "repeating-linear-gradient(100deg,#6d5af0 10%,#a5b4fc 15%,#c4b5fd 20%,#e9d5ff 25%,#8b5cf6 30%)",
            backgroundSize: "300% 200%, 200% 100%",
            backgroundPosition: "50% 50%, 50% 50%",
            filter: "blur(10px)",
          }}
        />
      </div>
      {children}
    </div>
  );
}

/** Aceternity — Spotlight. A single soft conic beam, positioned by the caller. */
export function Spotlight({ className, fill = "#8b5cf6" }: { className?: string; fill?: string }) {
  return (
    <svg
      aria-hidden
      className={cn("pointer-events-none absolute z-[1] h-[169%] w-[138%] opacity-0 animate-[d7-spotlight_2.4s_ease_.6s_forwards] lg:w-[84%]", className)}
      viewBox="0 0 3787 2842" fill="none"
      style={{ animation: "none", opacity: 1 }}
    >
      <g filter="url(#d7-spot)">
        <ellipse cx="1924.71" cy="273.501" rx="1924.71" ry="273.501"
          transform="matrix(-.822377 -.568943 -.568943 .822377 3631.88 2291.09)"
          fill={fill} fillOpacity=".18" />
      </g>
      <defs>
        <filter id="d7-spot" x="0" y="0" width="3787" height="2842"
          filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
          <feGaussianBlur stdDeviation="151" result="effect1_foregroundBlur" />
        </filter>
      </defs>
    </svg>
  );
}

/** Magic UI — Meteors. */
export function Meteors({ number = 16, className }: { number?: number; className?: string }) {
  const [meteors, setMeteors] = useState<{ left: string; delay: string; dur: string }[]>([]);
  /* Randomised in an effect so server and client markup agree. */
  useEffect(() => {
    setMeteors(Array.from({ length: number }, () => ({
      left: `${Math.floor(Math.random() * 100)}%`,
      delay: `${(Math.random() * 5).toFixed(2)}s`,
      dur: `${(Math.random() * 5 + 4).toFixed(2)}s`,
    })));
  }, [number]);

  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}>
      {meteors.map((m, i) => (
        <span key={i}
          className="d7-meteor absolute top-0 h-[1.5px] w-[1.5px] rounded-full bg-white shadow-[0_0_0_1px_rgba(255,255,255,.12)]"
          style={{
            left: m.left,
            ["--delay" as string]: m.delay,
            ["--dur" as string]: m.dur,
            ["--angle" as string]: "215deg",
          }}>
          <span className="absolute top-1/2 -z-10 h-px w-[60px] -translate-y-1/2 bg-gradient-to-r from-white to-transparent" />
        </span>
      ))}
    </div>
  );
}

/** Magic UI — Particles. Canvas dust that drifts away from the cursor. */
export function Particles({ quantity = 60, className, color = "#6d5af0" }: {
  quantity?: number; className?: string; color?: string;
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    if (reduced) return;
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0, h = 0, frame = 0;
    const mouse = { x: -9999, y: -9999 };
    type P = { x: number; y: number; r: number; a: number; dx: number; dy: number };
    let dots: P[] = [];

    const seed = () => {
      const box = el.getBoundingClientRect();
      w = box.width; h = box.height;
      el.width = w * dpr; el.height = h * dpr;
      ctx.scale(dpr, dpr);
      dots = Array.from({ length: quantity }, () => ({
        x: Math.random() * w, y: Math.random() * h,
        r: Math.random() * 1.6 + 0.4, a: Math.random() * 0.5 + 0.15,
        dx: (Math.random() - 0.5) * 0.22, dy: (Math.random() - 0.5) * 0.22,
      }));
    };

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      for (const d of dots) {
        d.x += d.dx; d.y += d.dy;
        if (d.x < 0) d.x = w; if (d.x > w) d.x = 0;
        if (d.y < 0) d.y = h; if (d.y > h) d.y = 0;
        /* Drift away from the pointer within a 130px radius. */
        const vx = d.x - mouse.x, vy = d.y - mouse.y;
        const dist = Math.hypot(vx, vy);
        const push = dist < 130 ? (130 - dist) / 130 : 0;
        ctx.beginPath();
        ctx.arc(d.x + vx * push * 0.28, d.y + vy * push * 0.28, d.r, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.globalAlpha = d.a + push * 0.4;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      frame = requestAnimationFrame(draw);
    };

    const onMove = (e: MouseEvent) => {
      const box = el.getBoundingClientRect();
      mouse.x = e.clientX - box.left; mouse.y = e.clientY - box.top;
    };

    seed();
    frame = requestAnimationFrame(draw);
    window.addEventListener("resize", seed);
    window.addEventListener("mousemove", onMove, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", seed);
      window.removeEventListener("mousemove", onMove);
    };
  }, [quantity, color, reduced]);

  return <canvas ref={canvas} aria-hidden className={cn("pointer-events-none absolute inset-0 h-full w-full", className)} />;
}

/** Magic UI — Ripple. Concentric breathing rings. */
export function Ripple({ circles = 6, className }: { circles?: number; className?: string }) {
  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}>
      {Array.from({ length: circles }, (_, i) => (
        <div key={i}
          className="d7-ripple absolute left-1/2 top-1/2 rounded-full border border-[var(--v)]/22 bg-[var(--v)]/[.035]"
          style={{
            width: 220 + i * 130, height: 220 + i * 130,
            opacity: 0.55 - i * 0.08,
            ["--delay" as string]: `${i * 0.22}s`,
          }} />
      ))}
    </div>
  );
}

/** Magic UI — DotPattern. */
export function DotPattern({ className, size = 22, radius = 1 }: {
  className?: string; size?: number; radius?: number;
}) {
  const id = useId();
  return (
    <svg aria-hidden className={cn("pointer-events-none absolute inset-0 h-full w-full fill-[var(--v)]/25", className)}>
      <defs>
        <pattern id={id} width={size} height={size} patternUnits="userSpaceOnUse">
          <circle cx={radius} cy={radius} r={radius} />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}

/** Magic UI — GridPattern. */
export function GridPattern({ className, size = 44 }: { className?: string; size?: number }) {
  const id = useId();
  return (
    <svg aria-hidden className={cn("pointer-events-none absolute inset-0 h-full w-full stroke-[var(--v)]/[.13]", className)}>
      <defs>
        <pattern id={id} width={size} height={size} patternUnits="userSpaceOnUse">
          <path d={`M ${size} 0 L 0 0 0 ${size}`} fill="none" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}

/* ========================================================================== */
/* BORDERS & CARDS                                                            */
/* ========================================================================== */

/**
 * Magic UI — BorderBeam. A light that runs the card's perimeter via
 * `offset-path`. Browsers without offset-path just render a static dot, which
 * is invisible against the border — an acceptable no-op.
 */
export function BorderBeam({ duration = 8, delay = 0, size = 60, radius = 16, className }: {
  duration?: number; delay?: number; size?: number; radius?: number; className?: string;
}) {
  return (
    <div aria-hidden
      className="pointer-events-none absolute inset-0 rounded-[inherit] border border-transparent [mask-clip:padding-box,border-box] [mask-composite:intersect] [mask-image:linear-gradient(transparent,transparent),linear-gradient(#000,#000)]">
      <div
        className={cn("d7-beam absolute aspect-square bg-gradient-to-l from-[var(--v)] via-[var(--v-3)] to-transparent", className)}
        style={{
          width: size,
          offsetPath: `rect(0 auto auto 0 round ${radius}px)`,
          ["--dur" as string]: `${duration}s`,
          ["--delay" as string]: `${-delay}s`,
        }} />
    </div>
  );
}

/** Magic UI — ShineBorder. A slow rainbow sweep along a 1px ring. */
export function ShineBorder({ duration = 14, width = 1, className }: {
  duration?: number; width?: number; className?: string;
}) {
  return (
    <div aria-hidden
      className={cn("d7-shine pointer-events-none absolute inset-0 rounded-[inherit] will-change-[background-position]", className)}
      style={{
        ["--dur" as string]: `${duration}s`,
        padding: width,
        backgroundImage: "radial-gradient(transparent, transparent, #6d5af0, #a855f7, #38bdf8, transparent, transparent)",
        backgroundSize: "300% 300%",
        mask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
        WebkitMask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
        WebkitMaskComposite: "xor",
        maskComposite: "exclude",
      }} />
  );
}

/** Magic UI — MagicCard. A radial highlight that tracks the pointer. */
export function MagicCard({ children, className, gradientSize = 260, gradientColor = "rgba(109,90,240,.13)" }: {
  children: ReactNode; className?: string; gradientSize?: number; gradientColor?: string;
}) {
  const x = useMotionValue(-gradientSize);
  const y = useMotionValue(-gradientSize);
  const bg = useMotionTemplate`radial-gradient(${gradientSize}px circle at ${x}px ${y}px, ${gradientColor}, transparent 100%)`;

  const onMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    x.set(e.clientX - box.left); y.set(e.clientY - box.top);
  }, [x, y]);

  return (
    <div onMouseMove={onMove}
      onMouseLeave={() => { x.set(-gradientSize); y.set(-gradientSize); }}
      className={cn("group relative overflow-hidden", className)}>
      <motion.div aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
        style={{ background: bg }} />
      {children}
    </div>
  );
}

/** Aceternity — CardSpotlight, the dark-surface variant of the same idea. */
export function CardSpotlight({ children, className, color = "rgba(255,255,255,.14)" }: {
  children: ReactNode; className?: string; color?: string;
}) {
  const x = useMotionValue(-400);
  const y = useMotionValue(-400);
  const bg = useMotionTemplate`radial-gradient(360px circle at ${x}px ${y}px, ${color}, transparent 80%)`;
  return (
    <div
      onMouseMove={(e) => {
        const b = e.currentTarget.getBoundingClientRect();
        x.set(e.clientX - b.left); y.set(e.clientY - b.top);
      }}
      className={cn("group relative overflow-hidden", className)}>
      <motion.div aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
        style={{ background: bg }} />
      {children}
    </div>
  );
}

/**
 * Aceternity — 3D Card. `Card3D` owns the perspective and writes --rx/--ry;
 * `Card3DItem` pushes a child out on Z so it separates as the card turns.
 */
export function Card3D({ children, className, max = 9 }: {
  children: ReactNode; className?: string; max?: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const fine = useFinePointer();
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el || !fine || reduced) return;
    const move = (e: MouseEvent) => {
      const b = el.getBoundingClientRect();
      const px = (e.clientX - b.left) / b.width - 0.5;
      const py = (e.clientY - b.top) / b.height - 0.5;
      el.style.setProperty("--ry", `${(px * max).toFixed(2)}deg`);
      el.style.setProperty("--rx", `${(-py * max).toFixed(2)}deg`);
    };
    const leave = () => {
      el.style.setProperty("--rx", "0deg");
      el.style.setProperty("--ry", "0deg");
    };
    el.addEventListener("mousemove", move);
    el.addEventListener("mouseleave", leave);
    return () => { el.removeEventListener("mousemove", move); el.removeEventListener("mouseleave", leave); };
  }, [max, fine, reduced]);

  return (
    <div ref={ref} className={cn("d7-persp", className)}>
      <div className="d7-3d h-full">{children}</div>
    </div>
  );
}

/** A child of Card3D, floated toward the viewer. */
export function Card3DItem({ children, z = 40, className }: {
  children: ReactNode; z?: number; className?: string;
}) {
  return (
    <div className={className} style={{ transform: `translateZ(${z}px)`, transformStyle: "preserve-3d" }}>
      {children}
    </div>
  );
}

/* ========================================================================== */
/* BUTTONS                                                                    */
/* ========================================================================== */

/** Magic UI — ShimmerButton. A spark orbits the rim behind a solid core. */
export function ShimmerButton({
  children, className, background = "linear-gradient(135deg,#6d5af0,#8b5cf6 55%,#a855f7)",
  shimmerColor = "#ffffff", shimmerSize = "0.06em", speed = "2.6s", borderRadius = "9999px",
  ...rest
}: {
  children: ReactNode; className?: string; background?: string; shimmerColor?: string;
  shimmerSize?: string; speed?: string; borderRadius?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      style={{
        ["--speed" as string]: speed,
        ["--cut" as string]: shimmerSize,
        ["--bg" as string]: background,
        borderRadius,
        background,
      }}
      className={cn(
        "group relative z-0 flex cursor-pointer items-center justify-center overflow-hidden",
        "whitespace-nowrap border border-white/10 px-6 py-3 text-white",
        "[background:var(--bg)]",
        "transition-transform duration-300 active:translate-y-px",
        "shadow-[0_16px_36px_-16px_rgba(109,90,240,.8)]",
        className,
      )}>
      {/* orbiting spark, clipped to a ring by the inset core below */}
      <div className="absolute inset-0 -z-30 overflow-visible blur-[2px] [container-type:size]">
        <div className="d7-shimmer-slide absolute inset-0 h-[100cqh] w-auto [aspect-ratio:1] animate-none">
          <div className="d7-spin-around absolute -inset-full w-auto rotate-0"
            style={{ background: `conic-gradient(from calc(270deg - (var(--spread,90deg) * .5)), transparent 0, ${shimmerColor} var(--spread,90deg), transparent var(--spread,90deg))` }} />
        </div>
      </div>
      <span className="relative z-10 flex items-center gap-2 text-[14.5px] font-semibold">{children}</span>
      {/* highlight on hover */}
      <div className="absolute inset-0 -z-20 rounded-[inherit] opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{ boxShadow: "inset 0 -8px 10px rgba(255,255,255,.24)" }} />
      {/* solid core that turns the conic sweep into a rim light */}
      <div className="absolute -z-20 rounded-[inherit]"
        style={{ inset: "var(--cut)", background: "var(--bg)" }} />
    </button>
  );
}

/** Aceternity — HoverBorderGradient. A travelling highlight on the ring. */
export function HoverBorderGradient({ children, className, containerClassName, duration = 1.4 }: {
  children: ReactNode; className?: string; containerClassName?: string; duration?: number;
}) {
  const [hovered, setHovered] = useState(false);
  const [dir, setDir] = useState(0);
  const spots = useMemo(() => [
    "radial-gradient(20.7% 50% at 50% 100%, var(--v) 0%, rgba(255,255,255,0) 100%)",
    "radial-gradient(16.6% 43.1% at 100% 50%, var(--v-2) 0%, rgba(255,255,255,0) 100%)",
    "radial-gradient(20.7% 50% at 50% 0%,   var(--v-3) 0%, rgba(255,255,255,0) 100%)",
    "radial-gradient(16.2% 41.2% at 0% 50%, var(--v) 0%, rgba(255,255,255,0) 100%)",
  ], []);

  useEffect(() => {
    if (hovered) return;
    const id = setInterval(() => setDir(d => (d + 1) % spots.length), duration * 1000);
    return () => clearInterval(id);
  }, [hovered, duration, spots.length]);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={cn("relative flex w-fit items-center justify-center overflow-hidden rounded-full border border-[var(--line)] bg-[var(--glass)] p-px transition duration-500", containerClassName)}>
      <div className={cn("z-10 w-auto rounded-[inherit] bg-[var(--white)] px-5 py-2.5 text-[14px] font-semibold text-[var(--ink)]", className)}>
        {children}
      </div>
      <motion.div aria-hidden
        className="absolute inset-0 z-0 h-full w-full rounded-[inherit] overflow-hidden"
        style={{ filter: "blur(2px)" }}
        animate={{ background: hovered
          ? "radial-gradient(75% 181% at 50% 50%, var(--v-2) 0%, rgba(255,255,255,0) 100%)"
          : spots[dir] }}
        transition={{ ease: "linear", duration: duration }} />
      <div className="absolute inset-px z-[1] rounded-[inherit] bg-[var(--white)]" />
    </div>
  );
}

/**
 * A control that leans toward the cursor.
 *
 * Tracking is per-element against its own proximity field, NOT against the
 * parent's hover: two magnetic buttons sitting in the same flex row share a
 * parent, so listening there made both of them lean whenever either was
 * hovered. `radius` is how far out the pull starts, measured from the
 * element's edge, and the pull eases to zero at that boundary so a control
 * never snaps back when the cursor leaves.
 */
export function Magnetic({ children, strength = 0.3, radius = 46, className }: {
  children: ReactNode; strength?: number; radius?: number; className?: string;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const fine = useFinePointer();
  const reduced = usePrefersReducedMotion();
  /* The target is what the pointer writes; the spring is what renders. The
     source MotionValue has to be held in its own hook — `useSpring(useMotionValue(0))`
     leaves the spring following a source nobody can reach, so it always
     settles back to zero and the element never moves. */
  const tx = useMotionValue(0);
  const ty = useMotionValue(0);
  const x = useSpring(tx, { stiffness: 220, damping: 18, mass: .4 });
  const y = useSpring(ty, { stiffness: 220, damping: 18, mass: .4 });

  useEffect(() => {
    const el = ref.current;
    if (!el || !fine || reduced) return;

    let frame = 0;
    const move = (e: MouseEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const b = el.getBoundingClientRect();
        const dx = e.clientX - (b.left + b.width / 2);
        const dy = e.clientY - (b.top + b.height / 2);

        /* distance from the element's edge, per axis */
        const outX = Math.max(0, Math.abs(dx) - b.width / 2);
        const outY = Math.max(0, Math.abs(dy) - b.height / 2);
        const out = Math.hypot(outX, outY);

        if (out > radius) { tx.set(0); ty.set(0); return; }
        const falloff = 1 - out / radius;
        tx.set(dx * strength * falloff);
        ty.set(dy * strength * falloff);
      });
    };

    window.addEventListener("mousemove", move, { passive: true });
    return () => { window.removeEventListener("mousemove", move); cancelAnimationFrame(frame); };
  }, [strength, radius, fine, reduced, tx, ty]);

  return <motion.span ref={ref} style={{ x, y }} className={cn("inline-block", className)}>{children}</motion.span>;
}

/* ========================================================================== */
/* TEXT                                                                       */
/* ========================================================================== */

/** Magic UI — NumberTicker. Spring-driven count-up, fires once on view. */
export function NumberTicker({ value, decimals = 0, className, delay = 0 }: {
  value: number; decimals?: number; className?: string; delay?: number;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const inView = useInView(ref, { once: true, margin: "0px 0px -12% 0px" });
  const reduced = usePrefersReducedMotion();
  const mv = useMotionValue(0);
  const spring = useSpring(mv, { damping: 46, stiffness: 90 });
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (!inView) return;
    if (reduced) { setShown(value); return; }
    const id = setTimeout(() => mv.set(value), delay);
    return () => clearTimeout(id);
  }, [inView, value, delay, mv, reduced]);

  useEffect(() => spring.on("change", (v: number) => setShown(v)), [spring]);

  return (
    <span ref={ref} className={cn("inline-block tabular-nums", className)}>
      {Intl.NumberFormat("en-US", {
        minimumFractionDigits: decimals, maximumFractionDigits: decimals,
      }).format(Number(shown.toFixed(decimals)))}
    </span>
  );
}

/** Magic UI — BlurFade. The workhorse reveal for this page. */
export function BlurFade({ children, className, delay = 0, y = 20, blur = "7px", once = true, duration = 0.6 }: {
  children: ReactNode; className?: string; delay?: number; y?: number;
  blur?: string; once?: boolean; duration?: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const inView = useInView(ref, { once, margin: "0px 0px -8% 0px" });
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y, filter: `blur(${blur})` }}
      animate={inView ? { opacity: 1, y: 0, filter: "blur(0px)" } : undefined}
      transition={{ delay: 0.03 + delay, duration, ease: [0.16, 1, 0.3, 1] }}
      className={className}>
      {children}
    </motion.div>
  );
}

/** Aceternity — TextGenerateEffect. Words blur in one after another. */
export function TextGenerateEffect({ words, className, delay = 0, step = 0.055, blur = true }: {
  words: string; className?: string; delay?: number; step?: number; blur?: boolean;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const inView = useInView(ref, { once: true, margin: "0px 0px -10% 0px" });
  return (
    <span ref={ref} className={className}>
      {words.split(" ").map((w, i) => (
        <motion.span key={`${w}-${i}`} className="inline-block"
          initial={{ opacity: 0, filter: blur ? "blur(9px)" : "none", y: 8 }}
          animate={inView ? { opacity: 1, filter: "blur(0px)", y: 0 } : undefined}
          transition={{ duration: 0.55, delay: delay + i * step, ease: [0.16, 1, 0.3, 1] }}>
          {w}&nbsp;
        </motion.span>
      ))}
    </span>
  );
}

/** Masked per-word rise — heavier than TextGenerateEffect, for headlines. */
export function WordsPullUp({ words, className, delay = 0, step = 0.075 }: {
  words: ReactNode[]; className?: string; delay?: number; step?: number;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const inView = useInView(ref, { once: true, margin: "0px 0px -6% 0px" });
  return (
    <span ref={ref} className={cn("inline-flex flex-wrap", className)}>
      {words.map((w, i) => (
        <span key={i} className="inline-block overflow-hidden pb-[.12em] pr-[.26em] align-bottom">
          <motion.span className="inline-block"
            initial={{ y: "115%" }}
            animate={inView ? { y: 0 } : undefined}
            transition={{ duration: 0.85, delay: delay + i * step, ease: [0.16, 1, 0.3, 1] }}>
            {w}
          </motion.span>
        </span>
      ))}
    </span>
  );
}

/** Magic UI — AnimatedShinyText. A highlight sweeping muted text. */
export function AnimatedShinyText({ children, className, speed = 5 }: {
  children: ReactNode; className?: string; speed?: number;
}) {
  return (
    <span
      className={cn("d7-anim-grad inline-block bg-clip-text text-transparent", className)}
      style={{
        ["--dur" as string]: `${speed}s`,
        ["--bg-size" as string]: "300%",
        backgroundImage: "linear-gradient(110deg,var(--mute) 40%,var(--v) 50%,var(--mute) 60%)",
      }}>
      {children}
    </span>
  );
}

/** Magic UI — AnimatedGradientText. */
export function AnimatedGradientText({ children, className, speed = 7 }: {
  children: ReactNode; className?: string; speed?: number;
}) {
  return (
    <span className={cn("d7-anim-grad inline-block bg-clip-text text-transparent", className)}
      style={{
        ["--dur" as string]: `${speed}s`,
        ["--bg-size" as string]: "300%",
        backgroundImage: "linear-gradient(90deg,var(--v),var(--v-3),#38bdf8,var(--v))",
      }}>
      {children}
    </span>
  );
}

/** Magic UI — WordRotate. */
export function WordRotate({ words, className, interval = 2600 }: {
  words: string[]; className?: string; interval?: number;
}) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI(v => (v + 1) % words.length), interval);
    return () => clearInterval(id);
  }, [words.length, interval]);
  return (
    <span className={cn("inline-grid overflow-hidden align-bottom", className)}>
      <AnimatePresence mode="wait">
        <motion.span key={words[i]} className="col-start-1 row-start-1"
          initial={{ opacity: 0, y: "60%" }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: "-60%" }}
          transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}>
          {words[i]}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/* ========================================================================== */
/* MARQUEE                                                                    */
/* ========================================================================== */

/** Magic UI — Marquee. Duplicated tracks so the loop never shows a seam. */
export function Marquee({ children, className, reverse = false, duration = 40, gap = "2rem", pauseOnHover = true, repeat = 2 }: {
  children: ReactNode; className?: string; reverse?: boolean; duration?: number;
  gap?: string; pauseOnHover?: boolean; repeat?: number;
}) {
  return (
    <div
      className={cn("d7-marquee-group group flex overflow-hidden", pauseOnHover && "hover:[&_.d7-marquee]:[animation-play-state:paused]", className)}
      style={{ ["--gap" as string]: gap, gap }}>
      {Array.from({ length: repeat }, (_, i) => (
        <div key={i} aria-hidden={i > 0} className="d7-marquee flex shrink-0 justify-around"
          style={{
            gap,
            ["--dur" as string]: `${duration}s`,
            ["--dir" as string]: reverse ? "reverse" : "normal",
          }}>
          {children}
        </div>
      ))}
    </div>
  );
}

/* ========================================================================== */
/* SCROLL                                                                     */
/* ========================================================================== */

/** Gradient rail across the top of the page, driven by page scroll. */
export function ScrollProgress({ className }: { className?: string }) {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 200, damping: 40, restDelta: 0.001 });
  return (
    <motion.div aria-hidden style={{ scaleX }}
      className={cn("fixed inset-x-0 top-0 z-[70] h-[3px] origin-left bg-[linear-gradient(90deg,var(--v),#38bdf8,var(--v-3))]", className)} />
  );
}

/** Translate a subtree against page scroll. Returns the ready-made wrapper. */
export function Parallax({ children, className, distance = 70 }: {
  children: ReactNode; className?: string; distance?: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], [distance, -distance]);
  const smooth = useSpring(y, { stiffness: 120, damping: 30, mass: 0.4 });
  return <motion.div ref={ref} style={{ y: smooth }} className={className}>{children}</motion.div>;
}

/** The raw 0→1 progress of an element crossing the viewport. */
export function useSectionProgress<T extends HTMLElement>(offset: [string, string] = ["start end", "end start"]) {
  const ref = useRef<T | null>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: offset as never });
  return { ref, progress: scrollYProgress as MotionValue<number> };
}
