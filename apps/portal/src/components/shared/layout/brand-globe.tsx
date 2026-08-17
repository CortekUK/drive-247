"use client";

import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

/**
 * A slowly turning wireframe globe for the login hero.
 *
 * Built from CSS 3D transforms rather than a WebGL library (`cobe`, `three`)
 * on purpose: three sessions share this working tree and its `node_modules`,
 * so an install mid-flight would disturb the other two dev servers for a piece
 * of decoration. Rings are real DOM in a `preserve-3d` scene, which also means
 * they take colour from the stylesheet like everything else — a canvas would
 * have needed the brand passed in as numbers, since CSS variables resolve to
 * nothing inside `ctx.strokeStyle`.
 *
 * Strokes are white-on-alpha, not brand-tinted. The hero behind this is already
 * the tenant's colour at every hue in the estate, and a second tint on top of it
 * reads as dirt on the ones it doesn't suit.
 */

/** Vertical rings, evenly spaced around the polar axis. */
const MERIDIAN_COUNT = 9;

/** Horizontal rings, by latitude in degrees. */
const LATITUDES = [-60, -40, -20, 0, 20, 40, 60];

/** Points of light on the surface — scattered, not meant to read as real places. */
const MARKERS = [
  { lat: 40, lon: -74 },
  { lat: 51, lon: 0 },
  { lat: 34, lon: -118 },
  { lat: 25, lon: 55 },
  { lat: -23, lon: -46 },
  { lat: 1, lon: 103 },
  { lat: 30, lon: -97 },
];

const RADIANS = Math.PI / 180;

interface BrandGlobeProps {
  /**
   * Diameter in px. Needed as a number, not a class: `translateZ` pushes the
   * markers out to the sphere's skin and has no percentage form to resolve
   * against.
   */
  size?: number;
  className?: string;
}

export function BrandGlobe({ size = 520, className }: BrandGlobeProps) {
  const reduceMotion = useReducedMotion();
  const radius = size / 2;

  return (
    <div
      className={cn("pointer-events-none relative", className)}
      style={{ width: size, height: size, perspective: size * 2.4 }}
    >
      {/* Atmosphere. Behind the scene, so the rings appear to sit in light. */}
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background:
            "radial-gradient(circle at 32% 28%, rgba(255,255,255,0.20), rgba(255,255,255,0.05) 45%, transparent 68%)",
        }}
      />

      <motion.div
        className="absolute inset-0"
        style={{ transformStyle: "preserve-3d" }}
        // Turning the *scene* rather than each ring keeps everything in one
        // coordinate space, so nothing drifts out of register.
        animate={reduceMotion ? undefined : { rotateY: 360 }}
        transition={
          reduceMotion
            ? undefined
            : { duration: 48, ease: "linear", repeat: Infinity }
        }
      >
        {/* Meridians — vertical rings turned about the polar axis. */}
        {Array.from({ length: MERIDIAN_COUNT }).map((_, i) => (
          <div
            key={`m-${i}`}
            className="absolute inset-0 rounded-full border border-white/25"
            style={{ transform: `rotateY(${(i * 180) / MERIDIAN_COUNT}deg)` }}
          />
        ))}

        {/* Latitudes — horizontal rings. A ring at latitude φ has radius
            R·cos(φ) and sits R·sin(φ) above the equator. `rotateX(90deg)`
            lays it flat; the translate then lifts it in the parent's space. */}
        {LATITUDES.map((lat) => {
          const scale = Math.cos(lat * RADIANS);
          const lift = Math.sin(lat * RADIANS);
          const ringSize = size * scale;
          return (
            <div
              key={`l-${lat}`}
              className="absolute rounded-full border border-white/16"
              style={{
                width: ringSize,
                height: ringSize,
                left: (size - ringSize) / 2,
                top: (size - ringSize) / 2,
                transform: `translateY(${-lift * radius}px) rotateX(90deg)`,
              }}
            />
          );
        })}

        {/* Surface markers, pushed out to the sphere's skin. */}
        {MARKERS.map(({ lat, lon }) => (
          <div
            key={`p-${lat}-${lon}`}
            className="absolute left-1/2 top-1/2 h-1.5 w-1.5 rounded-full bg-white/70"
            style={{
              transform: `rotateY(${lon}deg) rotateX(${-lat}deg) translateZ(${radius}px) translate(-50%, -50%)`,
            }}
          />
        ))}
      </motion.div>
    </div>
  );
}

export default BrandGlobe;
