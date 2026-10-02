'use client';

/**
 * Insights — Where your cars go, on a real map.
 *
 * Every rental's place (its delivery address when the car was delivered, else
 * its pickup) is geocoded with the Google Maps JS API the portal already loads
 * for the rental detail page, and drawn as one accent bubble per address,
 * sized by how many rentals went there. The map is styled down to quiet
 * greys (light and dark) so the bubbles are the only colour on it.
 *
 * Geocoding is done in the browser, at most `MAX_PLACES` addresses, one at a
 * time, and remembered in sessionStorage so a re-render or a period change
 * does not ask Google again.
 *
 * MOCK (Ghulam, 2026-10-02: "mock it out for now"): while a tenant's rentals
 * name fewer than three places that geocode, a labelled sample is drawn
 * instead. Real places replace it the moment there are three. Delete
 * `SAMPLE` and its fallback once the canary carries real addresses.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { importLibrary, setOptions } from '@googlemaps/js-api-loader';
import type { InsightsData } from './_data';

/** One rental, as the hover card lists it. */
type Stop = { ref: string; customer: string; car: string; start: string | null; end: string | null; status: string };
type Place = {
  address: string;
  label: string;
  count: number;
  lat: number;
  lng: number;
  /** A car is out on rent here right now. */
  active?: boolean;
  stops?: Stop[];
};

const MAX_PLACES = 25;

const sampleStops = (cars: string[], names: string[], active: number): Stop[] =>
  names.map((customer, i) => ({
    ref: `NW-${1040 + i * 7 + customer.length}`,
    customer,
    car: cars[i % cars.length],
    start: i < active ? '2026-09-28' : `2026-0${8 + (i % 2)}-${String(10 + i).padStart(2, '0')}`,
    end: i < active ? '2026-10-05' : `2026-0${8 + (i % 2)}-${String(14 + i).padStart(2, '0')}`,
    status: i < active ? 'Active' : 'Closed',
  }));

const SAMPLE_RAW: Place[] = [
  { address: 'Union Station', label: 'Union Station', count: 22, lat: 38.8973, lng: -77.0063 },
  { address: 'Reagan National Airport', label: 'National Airport', count: 31, lat: 38.8512, lng: -77.0402 },
  { address: 'Georgetown', label: 'Georgetown', count: 14, lat: 38.9097, lng: -77.0654 },
  { address: 'Arlington', label: 'Arlington', count: 17, lat: 38.8816, lng: -77.091 },
  { address: 'Navy Yard', label: 'Navy Yard', count: 9, lat: 38.8764, lng: -77.0031 },
  { address: 'Bethesda', label: 'Bethesda', count: 11, lat: 38.9847, lng: -77.0947 },
  { address: 'Alexandria', label: 'Alexandria', count: 8, lat: 38.8048, lng: -77.0469 },
];

const SAMPLE_PEOPLE = ['Dana Ruiz', 'Marcus Lee', 'Priya Shah', 'Tom Becker', 'Ana Silva', 'Jon Park'];
const SAMPLE_CARS = ['Ford Explorer', 'Tesla Model 3', 'Toyota Corolla', 'Kia Telluride'];
const SAMPLE_ACTIVE: Record<string, number> = { 'Reagan National Airport': 2, 'Union Station': 1, Arlington: 1 };
const SAMPLE: Place[] = SAMPLE_RAW.map((p, i) => ({
  ...p,
  active: (SAMPLE_ACTIVE[p.address] ?? 0) > 0,
  stops: sampleStops(SAMPLE_CARS.slice(i % 2), SAMPLE_PEOPLE.slice(0, 3 + (i % 3)), SAMPLE_ACTIVE[p.address] ?? 0),
}));

/* ── Loading Google Maps (shared with every other map on the portal) ─────── */

let loadPromise: Promise<void> | null = null;
function loadMaps(): Promise<void> {
  if (!loadPromise) {
    setOptions({ key: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '', v: 'weekly' });
    loadPromise = Promise.all([importLibrary('maps'), importLibrary('geocoding')]).then(() => undefined);
  }
  return loadPromise;
}

const geoKey = (address: string) => `d247.geo.${address.toLowerCase()}`;

async function geocode(geocoder: google.maps.Geocoder, address: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const cached = window.sessionStorage.getItem(geoKey(address));
    if (cached) return cached === 'none' ? null : (JSON.parse(cached) as { lat: number; lng: number });
  } catch {
    /* storage blocked — just ask Google */
  }
  const result = await new Promise<{ lat: number; lng: number } | null>((resolve) => {
    geocoder.geocode({ address }, (res, status) => {
      if (status === 'OK' && res?.[0]) {
        const loc = res[0].geometry.location;
        resolve({ lat: loc.lat(), lng: loc.lng() });
      } else resolve(null);
    });
  });
  try {
    window.sessionStorage.setItem(geoKey(address), result ? JSON.stringify(result) : 'none');
  } catch {
    /* fine */
  }
  return result;
}

/** "932 Dunn Ave, Jacksonville, FL 32218, USA" → "Jacksonville". */
function areaOf(address: string): string {
  const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
  const raw = parts.length >= 3 ? parts[1] : parts[0] ?? address;
  return raw.replace(/\b\d{5}(-\d{4})?\b/g, '').trim().replace(/\b\w/g, (c) => c.toUpperCase());
}

/* ── Map styles: everything grey, so only the bubbles carry colour ─────── */

const LIGHT: google.maps.MapTypeStyle[] = [
  { elementType: 'labels.text', stylers: [{ visibility: 'off' }] },
  { elementType: 'geometry', stylers: [{ color: '#f4f4f6' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8a8a94' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#f4f4f6' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#e9e9ee' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#e3e5ec' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ visibility: 'off' }] },
];

const DARK: google.maps.MapTypeStyle[] = [
  { elementType: 'labels.text', stylers: [{ visibility: 'off' }] },
  { elementType: 'geometry', stylers: [{ color: '#202022' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#7a7a80' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#202022' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2c2c30' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#36363b' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#18181b' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ visibility: 'off' }] },
];

/**
 * The tenant's accent as a concrete colour. `--primary` is built from other
 * custom properties (`var(--brand-h)` …), and reading it raw hands back the
 * unresolved expression — which, dropped into an SVG data URI, is not a
 * colour at all. So a probe element asks the browser to resolve it.
 */
function accent(): string {
  const probe = document.createElement('span');
  probe.style.color = 'hsl(var(--primary))';
  probe.style.display = 'none';
  document.body.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  return resolved && resolved !== 'rgba(0, 0, 0, 0)' ? resolved : 'rgb(99, 102, 241)';
}

/** A mesh node: a soft radial glow, a thin ring, and a solid core. */
/** The "a car is out here now" colour — a live green, kept off every other mark. */
const LIVE = '#16a34a';

/**
 * A mesh node: a soft radial glow, a thin ring, and a solid core. A place
 * with a car out on rent right now gets a green core and a slow pulsing
 * ring, so live places stand apart from the rest of the mesh.
 */
function node(color: string, size: number, hub: boolean, live: boolean): string {
  const r = size / 2;
  const core = Math.max(3.5, r * 0.2);
  return `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
      `<defs><radialGradient id="g"><stop offset="0%" stop-color="${color}" stop-opacity="0.45"/><stop offset="100%" stop-color="${color}" stop-opacity="0"/></radialGradient></defs>` +
      `<circle cx="${r}" cy="${r}" r="${r}" fill="url(#g)"/>` +
      `<circle cx="${r}" cy="${r}" r="${r * 0.42}" fill="none" stroke="${color}" stroke-opacity="${hub ? 0.9 : 0.6}" stroke-width="${hub ? 2 : 1.4}"/>` +
      (live
        ? `<circle cx="${r}" cy="${r}" r="${core}" fill="none" stroke="${LIVE}" stroke-width="2">` +
          `<animate attributeName="r" values="${core};${r * 0.6}" dur="1.8s" repeatCount="indefinite"/>` +
          `<animate attributeName="stroke-opacity" values="0.8;0" dur="1.8s" repeatCount="indefinite"/></circle>`
        : '') +
      `<circle cx="${r}" cy="${r}" r="${core}" fill="${live ? LIVE : color}" stroke="#ffffff" stroke-width="1.6"/>` +
      `</svg>`,
  )}`;
}


/* ── The view ───────────────────────────────────────────────────────────── */

export function PlacesMap({ data, onSummary }: { data?: InsightsData; onSummary?: (s: { places: number; sample: boolean }) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [failed, setFailed] = useState(false);
  // "Earth" (satellite imagery) by default — Ghulam, 2026-10-02 — with the
  // quiet styled map one tap away. Remembered for this browser.
  const [view, setViewState] = useState<'earth' | 'map'>(() => {
    try {
      return window.localStorage.getItem('d247.insights.mapView') === 'map' ? 'map' : 'earth';
    } catch {
      return 'earth';
    }
  });
  const setView = (v: 'earth' | 'map') => {
    setViewState(v);
    try {
      window.localStorage.setItem('d247.insights.mapView', v);
    } catch {
      /* fine */
    }
  };
  const earth = view === 'earth';
  // The hovered place and where it sits in the map box, in pixels.
  const [hover, setHover] = useState<{ place: Place; x: number; y: number } | null>(null);

  // Address → its rentals, busiest first. Each place keeps the rentals
  // themselves (for the hover card) and whether a car is out there now.
  const addresses = useMemo(() => {
    const per = new Map<string, Stop[]>();
    const labels = data?.vehicleLabels;
    for (const r of data?.rentals ?? []) {
      if (!r.location || r.status === 'Cancelled' || r.status === 'Rejected') continue;
      if (r.location.length < 4) continue;
      const list = per.get(r.location) ?? [];
      list.push({
        ref: r.number ?? r.id.slice(0, 8),
        customer: r.customerName ?? 'Customer',
        car: (r.vehicleId && labels?.get(r.vehicleId)?.split(' · ')[0]) || 'Car',
        start: r.start,
        end: r.end,
        status: r.status ?? '',
      });
      per.set(r.location, list);
    }
    return [...per.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, MAX_PLACES);
  }, [data?.rentals, data?.vehicleLabels]);

  // Geocode (cached), then decide real vs sample.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await loadMaps();
        const geocoder = new google.maps.Geocoder();
        const found: Place[] = [];
        for (const [address, stops] of addresses) {
          const at = await geocode(geocoder, address);
          if (cancelled) return;
          if (at)
            found.push({
              address,
              label: areaOf(address),
              count: stops.length,
              active: stops.some((x) => x.status === 'Active'),
              stops,
              ...at,
            });
        }
        if (!cancelled) setPlaces(found);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [addresses]);

  const sample = places !== null && places.length < 3;
  const shown = places === null ? null : sample ? SAMPLE : places;

  useEffect(() => {
    if (shown) onSummary?.({ places: shown.length, sample });
  }, [shown, sample, onSummary]);

  // Draw.
  useEffect(() => {
    if (!shown || !box.current) return;
    // On satellite imagery everything is drawn as if on a dark ground.
    const dark = earth || document.documentElement.classList.contains('dark');
    const map = new google.maps.Map(box.current, {
      disableDefaultUI: true,
      zoomControl: true,
      // No keyboard-shortcuts button in the footer. The rest of that footer
      // (Google logo, "Map data ©Google", Terms) is required attribution under
      // the Google Maps Platform terms and is left as Google draws it.
      keyboardShortcuts: false,
      zoomControlOptions: { position: google.maps.ControlPosition.RIGHT_CENTER }, // clear of the dialog close button (top-right) and the footer
      gestureHandling: 'cooperative',
      clickableIcons: false,
      mapTypeId: earth ? 'satellite' : 'roadmap',
      styles: earth ? undefined : dark ? DARK : LIGHT,
      backgroundColor: dark ? '#202022' : '#f4f4f6',
    });
    const color = accent();
    const max = Math.max(1, ...shown.map((p) => p.count));
    const bounds = new google.maps.LatLngBounds();
    shown.forEach((p) => bounds.extend({ lat: p.lat, lng: p.lng }));

    /*
     * The mesh. The busiest place is the hub: a spoke runs from it to every
     * other place, weighted by that place's rentals. Each place is also tied
     * to its two nearest neighbours, faintly, so the web reads as one network
     * rather than a star. Pairs are de-duplicated.
     */
    const hub = shown.reduce((a, b) => (b.count > a.count ? b : a), shown[0]);
    const dist = (a: Place, b: Place) => (a.lat - b.lat) ** 2 + (a.lng - b.lng) ** 2;
    const seen = new Set<string>();
    const lines: google.maps.Polyline[] = [];
    const link = (a: Place, b: Place, weight: number, opacity: number) => {
      const k = [a.address, b.address].sort().join('|');
      if (a === b || seen.has(k)) return;
      seen.add(k);
      lines.push(
        new google.maps.Polyline({
          map,
          path: [
            { lat: a.lat, lng: a.lng },
            { lat: b.lat, lng: b.lng },
          ],
          strokeColor: color,
          // Brighter over photography, where a faint line would vanish.
          strokeOpacity: earth ? Math.min(1, opacity + 0.3) : opacity,
          strokeWeight: weight,
          clickable: false,
          zIndex: 1,
        }),
      );
    };
    for (const p of shown) {
      if (p !== hub) link(hub, p, 1.2 + (p.count / max) * 3, 0.25 + (p.count / max) * 0.45);
      [...shown]
        .filter((q) => q !== p)
        .sort((a, b) => dist(p, a) - dist(p, b))
        .slice(0, 2)
        .forEach((q) => link(p, q, 1, 0.18));
    }

    // An empty overlay, only for its projection: it turns a place's lat/lng
    // into pixels inside the map box, where our own React card is drawn.
    const overlay = new google.maps.OverlayView();
    overlay.onAdd = () => {};
    overlay.draw = () => {};
    overlay.onRemove = () => {};
    overlay.setMap(map);
    const hide = () => setHover(null);
    const moved = map.addListener('bounds_changed', hide);

    const markers = shown.map((p) => {
      const isHub = p === hub;
      const size = Math.round(30 + Math.sqrt(p.count / max) * 50);
      const marker = new google.maps.Marker({
        map,
        position: { lat: p.lat, lng: p.lng },
        icon: {
          url: node(color, size, isHub, !!p.active),
          anchor: new google.maps.Point(size / 2, size / 2),
          // The place's name and count sit just under its node, on the map.
          labelOrigin: new google.maps.Point(size / 2, size / 2 + Math.max(3.5, size * 0.1) + 11),
        },
        // Quiet labels: small type with a halo in the map's own ground colour,
        // no pill, tight under the node — so the mesh reads through them.
        label: {
          text: `${p.label} · ${p.count}`,
          fontSize: '10px',
          fontWeight: isHub ? '600' : '500',
          color: earth ? '#ffffff' : dark ? '#d4d4d8' : '#3f3f46',
          className: earth
            ? '[text-shadow:0_1px_3px_rgb(0_0_0/0.9),0_0_2px_rgb(0_0_0/0.9)]'
            : dark
            ? '[text-shadow:0_0_3px_#202022,0_0_3px_#202022,0_0_3px_#202022]'
            : '[text-shadow:0_0_3px_#f4f4f6,0_0_3px_#f4f4f6,0_0_3px_#f4f4f6]',
        },
        // Clickable so it can be hovered; the grey focus box a click used to
        // draw is suppressed by the container's CSS below.
        clickable: true,
        optimized: false,
        zIndex: (p.active ? 1000 : 10) + p.count,
      });
      marker.addListener('mouseover', () => {
        const pt = overlay.getProjection()?.fromLatLngToContainerPixel(new google.maps.LatLng(p.lat, p.lng));
        if (pt) setHover({ place: p, x: pt.x, y: pt.y });
      });
      marker.addListener('mouseout', hide);
      return marker;
    });
    if (shown.length === 1) {
      map.setCenter(bounds.getCenter());
      map.setZoom(11);
    } else {
      map.fitBounds(bounds, 36);
    }
    return () => {
      setHover(null);
      google.maps.event.removeListener(moved);
      overlay.setMap(null);
      markers.forEach((m) => {
        google.maps.event.clearInstanceListeners(m);
        m.setMap(null);
      });
      lines.forEach((l) => l.setMap(null));
    };
  }, [shown, earth]);

  if (failed) {
    return (
      <div className="flex h-full min-h-[200px] items-center justify-center rounded-3xl bg-background/60 px-6 text-center">
        <p className="max-w-xs text-sm text-muted-foreground">I couldn't load the map just now. Please refresh to try again.</p>
      </div>
    );
  }

  return (
    <div
      className="relative h-full min-h-[200px] [&_.gm-style_*:focus]:!outline-none [&_.gm-style_iframe+div]:!border-0"
    >
      <div ref={box} className="absolute inset-0" />
      {hover ? <PlaceCard hover={hover} bounds={box.current} /> : null}
      {/* Earth / Map — the sidebar's two-option pill, small. Top-centre, on
          one line with the expand button (top-left) and the zoom (top-right),
          and clear of the labels and Google's footer at the bottom. */}
      <div className="absolute top-3 left-1/2 flex -translate-x-1/2 rounded-full bg-background/90 p-0.5 text-[11px] font-medium shadow-sm ring-1 ring-foreground/10 backdrop-blur">
        {(['earth', 'map'] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            aria-pressed={view === v}
            className={
              view === v
                ? 'h-6 cursor-pointer rounded-full bg-primary px-3 text-primary-foreground'
                : 'h-6 cursor-pointer rounded-full px-3 text-primary transition-colors duration-200 hover:bg-primary/10 motion-reduce:transition-none dark:text-[hsl(var(--v2-link,var(--primary)))]'
            }
          >
            {v === 'earth' ? 'Earth' : 'Map'}
          </button>
        ))}
      </div>
      {shown === null ? <div className="absolute inset-0 bg-foreground/[0.04]" /> : null}
    </div>
  );
}

/**
 * The hover card — the app's own popover surface (soft glass white, shadow,
 * 1px ring, theme text), not Google's InfoWindow chrome.
 *
 * It measures itself after render and goes wherever it fits: above the place
 * when there is room, else below, and it is slid sideways to stay inside the
 * map's box — so it is never cut off by the map's edge. It never captures the
 * pointer, so it cannot flicker the hover it belongs to.
 */
function PlaceCard({ hover, bounds }: { hover: { place: Place; x: number; y: number }; bounds: HTMLElement | null }) {
  const { place: p, x, y } = hover;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const stops = [...(p.stops ?? [])].sort((a, b) =>
    a.status === 'Active' && b.status !== 'Active'
      ? -1
      : b.status === 'Active' && a.status !== 'Active'
        ? 1
        : (b.start ?? '').localeCompare(a.start ?? ''),
  );
  const live = stops.filter((s) => s.status === 'Active').length;
  const day = (d: string | null) =>
    d ? new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '';

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !bounds) return;
    const W = bounds.clientWidth;
    const H = bounds.clientHeight;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const gap = 18;
    const pad = 10;
    const above = y - gap - h;
    const top = above >= pad ? above : Math.min(H - h - pad, y + gap);
    const left = Math.min(W - w - pad, Math.max(pad, x - w / 2));
    setPos({ left, top: Math.max(pad, top) });
  }, [x, y, bounds, p]);

  return (
    <div
      ref={ref}
      className="pointer-events-none absolute z-20 w-60 transition-opacity duration-200 ease-out motion-reduce:transition-none"
      style={{ left: pos?.left ?? x, top: pos?.top ?? y, opacity: pos ? 1 : 0 }}
    >
      <div className="rounded-2xl bg-popover/95 p-3 text-popover-foreground shadow-[0_10px_30px_-12px_rgb(0_0_0/0.35)] ring-1 ring-foreground/10 backdrop-blur-md">
        <div className="flex items-center justify-between gap-3">
          <p className="truncate text-[13px] font-semibold tracking-tight">{p.label}</p>
          <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary tabular-nums dark:text-[hsl(var(--v2-link,var(--primary)))]">
            {p.count} {p.count === 1 ? 'rental' : 'rentals'}
          </span>
        </div>
        {live > 0 ? (
          <p className="mt-1.5 flex items-center gap-1.5 text-[11px] font-medium text-success">
            <span className="relative flex size-1.5">
              <span className="absolute inset-0 animate-ping rounded-full bg-success/60 motion-reduce:animate-none" />
              <span className="relative size-1.5 rounded-full bg-success" />
            </span>
            {live} on rent now
          </p>
        ) : null}
        <ul className="mt-2 divide-y divide-foreground/5">
          {stops.slice(0, 3).map((s) => (
            <li key={`${s.ref}-${s.start}`} className="flex items-center gap-2 py-1.5">
              <span className={s.status === 'Active' ? 'size-1.5 shrink-0 rounded-full bg-success' : 'size-1.5 shrink-0 rounded-full bg-foreground/20'} />
              <p className="min-w-0 flex-1 truncate text-[12px]">
                <span className="font-medium">{s.customer}</span>
                <span className="text-muted-foreground"> · {s.car}</span>
              </p>
              <span className="shrink-0 text-[10.5px] text-muted-foreground tabular-nums">{day(s.start)}</span>
            </li>
          ))}
        </ul>
        {stops.length > 3 ? (
          <p className="pt-1.5 text-[11px] text-muted-foreground">and {stops.length - 3} more</p>
        ) : null}
      </div>
    </div>
  );
}
