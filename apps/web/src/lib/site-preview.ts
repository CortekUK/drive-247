"use client";

import { useSyncExternalStore } from "react";
import { deriveSlugFromCompanyName } from "./signup-validation";

/*
 * What the visitor has chosen for their own site on the landing page: a template and a
 * colour (in the templates section) and a business name (in "What's your rental company called?"). The
 * demo below both reads them, so the booking site, the renter's portal and the operator's
 * portal all come out in that colour, under that name, at that address.
 *
 * Kept in the browser only, for this visit. Nothing is saved or sent.
 */

export const SITE_COLOURS = [
  { id: "indigo", name: "Indigo", hex: "#4f44d8" },
  { id: "ocean", name: "Ocean", hex: "#0e7490" },
  { id: "forest", name: "Forest", hex: "#15803d" },
  { id: "amber", name: "Amber", hex: "#d97706" },
  { id: "canyon", name: "Canyon", hex: "#c2410c" },
  { id: "ruby", name: "Ruby", hex: "#be123c" },
  { id: "blush", name: "Blush", hex: "#db2777" },
  { id: "royal", name: "Royal", hex: "#1d4ed8" },
  { id: "violet", name: "Violet", hex: "#7c3aed" },
  { id: "graphite", name: "Graphite", hex: "#27272a" },
] as const;

export type SiteColour = (typeof SITE_COLOURS)[number];

/*
 * The booking-site templates there are today: the default one (site-v2) and Glass
 * (apps/booking/src/northwind-site/template-2).
 */
export const SITE_TEMPLATES = [
  { id: "classic", name: "Classic", feel: "Clean and bright, your headline up front" },
  { id: "glass", name: "Glass", feel: "Your cars on show, behind glass" },
] as const;

export type SiteTemplate = (typeof SITE_TEMPLATES)[number]["id"];

type State = { colour: SiteColour; name: string; template: SiteTemplate };

let state: State = { colour: SITE_COLOURS[0], name: "", template: "classic" };
const listeners = new Set<() => void>();

function set(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((fn) => fn());
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const SERVER: State = state;

export const setSiteColour = (id: SiteColour["id"]) => set({ colour: SITE_COLOURS.find((c) => c.id === id) ?? SITE_COLOURS[0] });
export const setSiteName = (name: string) => set({ name });
export const setSiteTemplate = (template: SiteTemplate) => set({ template });

export const RESTING_NAME = "Your Rentals";

/** The chosen colour and name, with the name's web address worked out the way signup does. */
export function useSitePreview() {
  const s = useSyncExternalStore(subscribe, () => state, () => SERVER);
  const name = s.name.trim() || RESTING_NAME;
  const slug = deriveSlugFromCompanyName(name) || "yourrentals";
  const initial = (name.match(/[a-z0-9]/i)?.[0] ?? "Y").toUpperCase();
  return { colour: s.colour, template: s.template, name, slug, initial, typed: s.name.trim().length > 0 };
}
