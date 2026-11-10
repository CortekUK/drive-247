"use client";

import { useEffect, useRef, useState } from "react";

/*
 * The real Google map behind "Where your renters go" (Ghulam, 2026-11-10: "use the proper
 * Google Map"). Drawn as the portal's insights map draws it
 * (apps/portal/src/app/(dashboard)/insights/_places-map.tsx): satellite ("Earth") or a quiet grey
 * road map, a glowing node per place sized by its rentals, green where a car is out now, and
 * spokes from the busiest place to the rest. The places are fixed, with their coordinates,
 * so nothing is geocoded.
 *
 * Needs NEXT_PUBLIC_GOOGLE_MAPS_API_KEY (the portal's key). Without it, or if Google does not
 * load, `onFail` is called and the drawn map stays. The web app has no @types/google.maps, so
 * the API is reached untyped (GMaps below).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GMaps = any;
const gmaps = (): GMaps => (window as unknown as { google: { maps: GMaps } }).google.maps;

export type MapPlace = { label: string; n: number; lat: number; lng: number; live?: boolean };

const KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
const ACCENT = "#4f44d8";
const LIVE = "#16a34a";

let loading: Promise<void> | null = null;
function loadMaps(): Promise<void> {
  if (typeof window === "undefined" || !KEY) return Promise.reject(new Error("no key"));
  if ((window as { google?: { maps?: unknown } }).google?.maps) return Promise.resolve();
  if (!loading) {
    loading = new Promise<void>((resolve, reject) => {
      const cb = "__d247MapsReady";
      (window as unknown as Record<string, () => void>)[cb] = () => resolve();
      const s = document.createElement("script");
      s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(KEY)}&v=weekly&loading=async&callback=${cb}`;
      s.async = true;
      s.onerror = () => reject(new Error("maps failed"));
      document.head.appendChild(s);
    });
  }
  return loading;
}

/* Quiet grey road map: only the nodes carry colour (the portal's LIGHT style). */
const LIGHT = [
  { elementType: "labels.text", stylers: [{ visibility: "off" }] },
  { elementType: "geometry", stylers: [{ color: "#f4f4f6" }] },
  { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#ffffff" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#e9e9ee" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#e3e5ec" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "administrative", elementType: "geometry", stylers: [{ visibility: "off" }] },
];

/** A node: a soft glow, a thin ring, a solid core (green and pulsing where a car is out now). */
function node(size: number, hub: boolean, live: boolean): string {
  const r = size / 2;
  const core = Math.max(4, r * 0.22);
  return `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
      `<defs><radialGradient id="g"><stop offset="0%" stop-color="${ACCENT}" stop-opacity="0.5"/><stop offset="100%" stop-color="${ACCENT}" stop-opacity="0"/></radialGradient></defs>` +
      `<circle cx="${r}" cy="${r}" r="${r}" fill="url(#g)"/>` +
      `<circle cx="${r}" cy="${r}" r="${r * 0.42}" fill="none" stroke="${ACCENT}" stroke-opacity="${hub ? 0.95 : 0.7}" stroke-width="${hub ? 2 : 1.4}"/>` +
      (live
        ? `<circle cx="${r}" cy="${r}" r="${core}" fill="none" stroke="${LIVE}" stroke-width="2"><animate attributeName="r" values="${core};${r * 0.6}" dur="1.8s" repeatCount="indefinite"/><animate attributeName="stroke-opacity" values="0.8;0" dur="1.8s" repeatCount="indefinite"/></circle>`
        : "") +
      `<circle cx="${r}" cy="${r}" r="${core}" fill="${live ? LIVE : ACCENT}" stroke="#ffffff" stroke-width="2"/>` +
      `</svg>`,
  )}`;
}

export function InsightsMap({ places, earth, zoom, onFail }: { places: MapPlace[]; earth: boolean; zoom: { dir: 1 | -1; at: number } | null; onFail: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<GMaps>(null);
  const [ready, setReady] = useState(false);

  // Build the map once.
  useEffect(() => {
    let cancelled = false;
    loadMaps()
      .then(() => {
        if (cancelled || !box.current) return;
        const g = gmaps();
        const map = new g.Map(box.current, {
          disableDefaultUI: true,
          keyboardShortcuts: false,
          gestureHandling: "none", // the page scrolls over it; the zoom buttons zoom
          clickableIcons: false,
          mapTypeId: "satellite",
          backgroundColor: "#202022",
        });
        const bounds = new g.LatLngBounds();
        places.forEach((p) => bounds.extend(p));
        map.fitBounds(bounds, 28);
        const max = Math.max(...places.map((p) => p.n));
        const hub = places.reduce((a, b) => (b.n > a.n ? b : a));
        for (const p of places) {
          if (p !== hub)
            new g.Polyline({ map, path: [hub, p], strokeColor: "#6366f1", strokeOpacity: 0.55 + (p.n / max) * 0.4, strokeWeight: 1.5 + (p.n / max) * 3, clickable: false, zIndex: 1 });
          const size = Math.round(34 + (p.n / max) * 30);
          new g.Marker({
            map,
            position: p,
            clickable: false,
            zIndex: 2,
            icon: { url: node(size, p === hub, !!p.live), scaledSize: new g.Size(size, size), anchor: new g.Point(size / 2, size / 2), labelOrigin: new g.Point(size / 2, size + 4) },
            label: { text: `${p.label} · ${p.n}`, color: "#ffffff", fontSize: "12px", fontWeight: "600", className: "ia-gm-label" },
          });
        }
        mapRef.current = map;
        setReady(true);
      })
      .catch(() => !cancelled && onFail());
    return () => {
      cancelled = true;
    };
  }, [places, onFail]);

  // Earth / Map.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setOptions({ mapTypeId: earth ? "satellite" : "roadmap", styles: earth ? null : LIGHT, backgroundColor: earth ? "#202022" : "#f4f4f6" });
    box.current?.classList.toggle("is-light", !earth);
  }, [earth, ready]);

  // The + / − buttons.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !zoom) return;
    map.setZoom((map.getZoom() ?? 12) + zoom.dir);
  }, [zoom, ready]);

  return <div ref={box} className={`ia-gmap${ready ? " is-ready" : ""}`} />;
}
