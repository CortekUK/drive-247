"use client";

/**
 * Where — the rental's pickup and drop-off on a real map.
 *
 * The Insights map's grammar (`app/(dashboard)/insights/_places-map.tsx`):
 * Google Maps via the loader the portal already uses, addresses geocoded in the
 * browser and remembered in sessionStorage, and the same Earth / Map pill.
 *
 *   Map    the plain map, washed in the tenant's accent — its greys are mixed
 *          from the accent, and a soft accent gradient sits over it
 *   Earth  satellite imagery, the marks drawn light so they read on it
 *
 * On it: the pickup (P) and drop-off (R) pins, joined by a curved arc — a
 * gradient from faint at the pickup to full at the drop-off, a soft glow under
 * it, and a small arrow that travels along it. One combined pin when both ends
 * are the same place. Hover a pin for its date, time and address. The tenant's
 * own places and delivery area sit quietly underneath.
 */

import { useEffect, useRef, useState } from "react";
import { importLibrary, setOptions } from "@googlemaps/js-api-loader";
import { MapPin } from "lucide-react";
import { cn } from "@/lib/utils";

export type MapPlace = {
  key: string;
  label: string;
  address: string;
  kind: "out" | "back" | "site";
  /** For the rental's own pins: what the hover card says ("Sat 1 Mar, 10:00 AM"). */
  when?: string;
  how?: string;
};

let loadPromise: Promise<void> | null = null;
function loadMaps(): Promise<void> {
  if (!loadPromise) {
    setOptions({ key: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "", v: "weekly" });
    loadPromise = Promise.all([importLibrary("maps"), importLibrary("geocoding")]).then(() => undefined);
  }
  return loadPromise;
}

const geoKey = (address: string) => `d247.geo.${address.toLowerCase()}`;

async function geocode(geocoder: google.maps.Geocoder, address: string): Promise<google.maps.LatLngLiteral | null> {
  try {
    const cached = window.sessionStorage.getItem(geoKey(address));
    if (cached) return cached === "none" ? null : (JSON.parse(cached) as google.maps.LatLngLiteral);
  } catch {
    /* storage blocked — just ask Google */
  }
  const result = await new Promise<google.maps.LatLngLiteral | null>((resolve) => {
    geocoder.geocode({ address }, (res, status) => {
      if (status === "OK" && res?.[0]) {
        const loc = res[0].geometry.location;
        resolve({ lat: loc.lat(), lng: loc.lng() });
      } else resolve(null);
    });
  });
  try {
    window.sessionStorage.setItem(geoKey(address), result ? JSON.stringify(result) : "none");
  } catch {
    /* fine */
  }
  return result;
}

/* ── colour ──────────────────────────────────────────────────────────────── */

/** The tenant's accent as [r,g,b] (`--primary` is built from vars). */
function accentRgb(): [number, number, number] {
  const probe = document.createElement("span");
  probe.style.color = "hsl(var(--primary))";
  probe.style.display = "none";
  document.body.appendChild(probe);
  const m = getComputedStyle(probe).color.match(/\d+(\.\d+)?/g);
  probe.remove();
  return m && m.length >= 3 ? [Number(m[0]), Number(m[1]), Number(m[2])] : [99, 102, 241];
}
const hex = ([r, g, b]: number[]) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
/** a → b by t (0 = a, 1 = b). */
const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);

/** The plain map, its greys mixed from the accent so the whole map carries it. */
function tintedStyle(accent: number[], dark: boolean): google.maps.MapTypeStyle[] {
  const ground = dark ? [24, 24, 28] : [255, 255, 255];
  const c = (t: number) => hex(mix(accent, ground, t));
  return [
    { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
    { elementType: "geometry", stylers: [{ color: c(dark ? 0.9 : 0.95) }] },
    { elementType: "labels.text.fill", stylers: [{ color: c(dark ? 0.45 : 0.55) }] },
    { elementType: "labels.text.stroke", stylers: [{ color: c(dark ? 0.9 : 0.95) }] },
    { featureType: "road", elementType: "geometry", stylers: [{ color: c(dark ? 0.82 : 1) }] },
    { featureType: "road.arterial", elementType: "geometry", stylers: [{ color: c(dark ? 0.78 : 0.99) }] },
    { featureType: "road.highway", elementType: "geometry", stylers: [{ color: c(dark ? 0.7 : 0.86) }] },
    { featureType: "water", elementType: "geometry", stylers: [{ color: c(dark ? 0.72 : 0.8) }] },
    { featureType: "landscape.natural", elementType: "geometry", stylers: [{ color: c(dark ? 0.88 : 0.93) }] },
    { featureType: "poi", stylers: [{ visibility: "off" }] },
    { featureType: "transit", stylers: [{ visibility: "off" }] },
    { featureType: "administrative", elementType: "geometry", stylers: [{ visibility: "off" }] },
  ];
}

/* ── marks ───────────────────────────────────────────────────────────────── */

function pinIcon(kind: MapPlace["kind"] | "both", accent: string, earth: boolean): google.maps.Icon {
  if (kind === "site") {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14"><circle cx="7" cy="7" r="4.5" fill="${earth ? "#ffffff" : "#9a9aa6"}" fill-opacity="${earth ? 0.85 : 1}" stroke="${earth ? accent : "#ffffff"}" stroke-width="2"/></svg>`;
    return { url: `data:image/svg+xml,${encodeURIComponent(svg)}`, anchor: new google.maps.Point(7, 7) };
  }
  const letter = kind === "out" ? "P" : kind === "back" ? "R" : "⇄";
  // Pickup: solid accent. Drop-off: white with an accent ring — the two ends
  // read apart at a glance, before the letters do.
  const fill = kind === "back" ? "#ffffff" : accent;
  const ink = kind === "back" ? accent : "#ffffff";
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="42" viewBox="0 0 34 42">` +
    `<ellipse cx="17" cy="40" rx="6" ry="1.8" fill="#000" fill-opacity=".18"/>` +
    `<path d="M17 39s13-13.6 13-24A13 13 0 0 0 4 15c0 10.4 13 24 13 24z" fill="${fill}" stroke="${kind === "back" ? accent : "#ffffff"}" stroke-width="2.4"/>` +
    `<text x="17" y="19.5" text-anchor="middle" font-family="Arial" font-size="12" font-weight="700" fill="${ink}">${letter}</text></svg>`;
  return { url: `data:image/svg+xml,${encodeURIComponent(svg)}`, anchor: new google.maps.Point(17, 39) };
}

/** A gentle arc from a to b: a quadratic curve bowed to one side, 64 points. */
function arc(a: google.maps.LatLngLiteral, b: google.maps.LatLngLiteral): google.maps.LatLngLiteral[] {
  const dx = b.lng - a.lng;
  const dy = b.lat - a.lat;
  const ctrl = { lat: (a.lat + b.lat) / 2 + dx * 0.22, lng: (a.lng + b.lng) / 2 - dy * 0.22 };
  return Array.from({ length: 65 }, (_, i) => {
    const t = i / 64;
    const u = 1 - t;
    return {
      lat: u * u * a.lat + 2 * u * t * ctrl.lat + t * t * b.lat,
      lng: u * u * a.lng + 2 * u * t * ctrl.lng + t * t * b.lng,
    };
  });
}

/** The hover card: date and time, how, where. Plain text only — escaped. */
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
function cardHtml(ps: MapPlace[]): string {
  return (
    `<div style="font-family:inherit;min-width:180px;max-width:240px;padding:2px 2px 0">` +
    ps
      .map(
        (p, i) =>
          `<div style="${i ? "margin-top:10px;padding-top:10px;border-top:1px solid rgba(0,0,0,.06)" : ""}">` +
          `<div style="font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#8a8a94">${esc(p.label)}</div>` +
          (p.when ? `<div style="margin-top:2px;font-size:13px;font-weight:600;color:#111">${esc(p.when)}</div>` : "") +
          (p.how ? `<div style="margin-top:2px;font-size:12px;color:#555">${esc(p.how)}</div>` : "") +
          `<div style="margin-top:2px;font-size:12px;color:#777">${esc(p.address)}</div></div>`
      )
      .join("") +
    `</div>`
  );
}

/* ── the view ────────────────────────────────────────────────────────────── */

export function WhereMap({
  places,
  area,
}: {
  places: MapPlace[];
  /** The delivery area, when the tenant delivers within a radius. */
  area: { lat: number; lng: number; radiusKm: number } | null;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<google.maps.Map | null>(null);
  const drawn = useRef<{ setMap: (m: google.maps.Map | null) => void }[]>([]);
  const hover = useRef<google.maps.InfoWindow | null>(null);
  const travel = useRef<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [resolved, setResolved] = useState<(MapPlace & google.maps.LatLngLiteral)[] | null>(null);

  // Map by default, Earth one tap away — remembered for this browser.
  const [view, setViewState] = useState<"earth" | "map">(() => {
    try {
      return window.localStorage.getItem("d247.rental.mapView") === "earth" ? "earth" : "map";
    } catch {
      return "map";
    }
  });
  const setView = (v: "earth" | "map") => {
    setViewState(v);
    try {
      window.localStorage.setItem("d247.rental.mapView", v);
    } catch {
      /* fine */
    }
  };
  const earth = view === "earth";

  const placesKey = places.map((p) => `${p.kind}:${p.address}:${p.when ?? ""}:${p.how ?? ""}`).join("|");

  // Geocode (cached).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await loadMaps();
        const geocoder = new google.maps.Geocoder();
        const out: (MapPlace & google.maps.LatLngLiteral)[] = [];
        for (const p of places) {
          if (!p.address || p.address.trim().length < 3) continue;
          const at = await geocode(geocoder, p.address);
          if (cancelled) return;
          if (at) out.push({ ...p, ...at });
        }
        if (!cancelled) setResolved(out);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placesKey]);

  // Draw.
  useEffect(() => {
    if (!resolved || !box.current) return;
    const dark = document.documentElement.classList.contains("dark");
    const rgb = accentRgb();
    const accent = hex(rgb);
    if (!map.current) {
      map.current = new google.maps.Map(box.current, {
        disableDefaultUI: true,
        zoomControl: true,
        gestureHandling: "cooperative",
        clickableIcons: false,
      });
    }
    map.current.setOptions({
      mapTypeId: earth ? "satellite" : "roadmap",
      styles: earth ? undefined : tintedStyle(rgb, dark),
      backgroundColor: hex(mix(rgb, dark ? [24, 24, 28] : [255, 255, 255], 0.95)),
    });

    drawn.current.forEach((d) => d.setMap(null));
    drawn.current = [];
    if (travel.current) cancelAnimationFrame(travel.current);
    const bounds = new google.maps.LatLngBounds();

    if (area) {
      const circle = new google.maps.Circle({
        map: map.current,
        center: { lat: area.lat, lng: area.lng },
        radius: area.radiusKm * 1000,
        strokeColor: earth ? "#ffffff" : accent,
        strokeOpacity: earth ? 0.7 : 0.45,
        strokeWeight: 1.5,
        fillColor: accent,
        fillOpacity: earth ? 0.12 : 0.06,
        clickable: false,
      });
      drawn.current.push(circle);
    }

    resolved
      .filter((p) => p.kind === "site")
      .forEach((p) => {
        drawn.current.push(
          new google.maps.Marker({
            map: map.current!,
            position: { lat: p.lat, lng: p.lng },
            icon: pinIcon("site", accent, earth),
            title: `${p.label} — ${p.address}`,
            zIndex: 1,
          })
        );
      });

    const out = resolved.find((p) => p.kind === "out");
    const back = resolved.find((p) => p.kind === "back");
    const same = out && back && Math.abs(out.lat - back.lat) < 1e-5 && Math.abs(out.lng - back.lng) < 1e-5;

    // The trip: a glow, then the arc drawn in short pieces fading in from the
    // pickup to the drop-off (a gradient — Google draws one colour per line),
    // then an arrow that travels along it.
    if (out && back && !same) {
      const path = arc(out, back);
      const line = earth ? [255, 255, 255] : rgb;
      drawn.current.push(
        new google.maps.Polyline({
          map: map.current,
          path,
          strokeColor: hex(line),
          strokeOpacity: earth ? 0.25 : 0.14,
          strokeWeight: 12,
          clickable: false,
          zIndex: 4,
        })
      );
      const pieces = 16;
      for (let i = 0; i < pieces; i++) {
        const from = Math.floor((i / pieces) * 64);
        const to = Math.floor(((i + 1) / pieces) * 64);
        const t = i / (pieces - 1);
        drawn.current.push(
          new google.maps.Polyline({
            map: map.current,
            path: path.slice(from, to + 1),
            strokeColor: hex(earth ? line : mix([255, 255, 255], rgb, 0.45 + 0.55 * t)),
            strokeOpacity: earth ? 0.55 + 0.45 * t : 1,
            strokeWeight: 3.5,
            clickable: false,
            zIndex: 5,
          })
        );
      }
      const runner = new google.maps.Polyline({
        map: map.current,
        path,
        strokeOpacity: 0,
        clickable: false,
        zIndex: 6,
        icons: [
          {
            icon: {
              path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
              scale: 3.6,
              strokeColor: "#ffffff",
              strokeWeight: 1.5,
              fillColor: earth ? "#ffffff" : accent,
              fillOpacity: 1,
            },
            offset: "0%",
          },
        ],
      });
      drawn.current.push(runner);
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduce) {
        const icons = runner.get("icons");
        icons[0].offset = "60%";
        runner.set("icons", icons);
      } else {
        let t0: number | null = null;
        const step = (ts: number) => {
          t0 ??= ts;
          const icons = runner.get("icons");
          icons[0].offset = `${(((ts - t0) / 3200) % 1) * 100}%`;
          runner.set("icons", icons);
          travel.current = requestAnimationFrame(step);
        };
        travel.current = requestAnimationFrame(step);
      }
      path.forEach((pt) => bounds.extend(pt));
    }

    const card = hover.current ?? (hover.current = new google.maps.InfoWindow({ disableAutoPan: true, headerDisabled: true } as never));
    const pin = (at: MapPlace & google.maps.LatLngLiteral, kind: "out" | "back" | "both", show: MapPlace[]) => {
      const m = new google.maps.Marker({
        map: map.current!,
        position: { lat: at.lat, lng: at.lng },
        icon: pinIcon(kind, accent, earth),
        zIndex: kind === "back" ? 9 : 10,
      });
      m.addListener("mouseover", () => {
        card.setContent(cardHtml(show));
        card.open({ map: map.current!, anchor: m });
      });
      m.addListener("mouseout", () => card.close());
      drawn.current.push(m);
      bounds.extend({ lat: at.lat, lng: at.lng });
    };
    if (same && out && back) pin(out, "both", [out, back]);
    else {
      if (out) pin(out, "out", [out]);
      if (back) pin(back, "back", [back]);
    }

    // Frame the trip; with no trip, frame the area or the places.
    if (bounds.isEmpty()) {
      if (area) {
        const c = new google.maps.Circle({ center: { lat: area.lat, lng: area.lng }, radius: area.radiusKm * 1000 });
        const b = c.getBounds();
        if (b) bounds.union(b);
      }
      resolved.forEach((p) => bounds.extend({ lat: p.lat, lng: p.lng }));
    }
    if (!bounds.isEmpty()) {
      map.current.fitBounds(bounds, 72);
      google.maps.event.addListenerOnce(map.current, "idle", () => {
        if ((map.current!.getZoom() ?? 0) > 14) map.current!.setZoom(14);
      });
    } else {
      map.current.setCenter({ lat: 39.5, lng: -98.35 });
      map.current.setZoom(3);
    }

    return () => {
      if (travel.current) cancelAnimationFrame(travel.current);
    };
  }, [resolved, area, earth]);

  if (failed) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
        <MapPin className="size-5" />
        <p className="text-xs">The map could not load. The addresses are still above.</p>
      </div>
    );
  }

  return (
    <div className="relative size-full [&_.gm-style_*:focus]:!outline-none [&_.gm-style_iframe+div]:!border-0">
      <div ref={box} className="absolute inset-0" />
      {/* The accent, washed over the plain map from two corners. */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0 transition-opacity duration-200 ease-out motion-reduce:transition-none",
          earth ? "opacity-0" : "opacity-100",
          "[background:radial-gradient(60%_70%_at_0%_0%,hsl(var(--primary)/0.14),transparent_70%),radial-gradient(55%_65%_at_100%_100%,hsl(var(--chart-3,var(--primary))/0.12),transparent_70%)]"
        )}
      />
      {/* Earth / Map — the Insights pill. */}
      <div className="absolute left-1/2 top-3 flex -translate-x-1/2 rounded-full bg-background/90 p-0.5 text-[11px] font-medium shadow-sm ring-1 ring-foreground/10 backdrop-blur">
        {(["map", "earth"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            aria-pressed={view === v}
            className={
              view === v
                ? "h-6 cursor-pointer rounded-full bg-primary px-3 text-primary-foreground"
                : "h-6 cursor-pointer rounded-full px-3 text-primary transition-colors duration-200 hover:bg-primary/10 motion-reduce:transition-none dark:text-[hsl(var(--v2-link,var(--primary)))]"
            }
          >
            {v === "earth" ? "Earth" : "Map"}
          </button>
        ))}
      </div>
    </div>
  );
}
