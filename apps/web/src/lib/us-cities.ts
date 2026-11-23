/**
 * The "City and state" picker's list and search (Ghulam, 2026-11-23: "this
 * should be something where they can select from").
 *
 * The list (us-cities-data.ts, about 10,000 US places, largest first) is
 * loaded the first time the field is used, never with the page. The search is
 * plain and pure so it can be tested without a browser.
 *
 * What is stored is unchanged: the text "City, ST" (`cityState`). A place
 * that is not on the list can still be typed by hand; the field's rule
 * (`validateCityState`) does not require a match.
 */

export interface CityOption {
  city: string;
  /** Two-letter postal code, e.g. "TX". */
  state: string;
  /** What the field holds once picked: "Houston, TX". */
  label: string;
  /** Lower-case, accents and punctuation removed, for matching. */
  key: string;
}

export const US_STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan",
  MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota",
  OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee",
  TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
  WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

/** "St. Louis" and "st louis", "Cañon City" and "canon city" match. */
export function searchKey(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.'’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Turns the data file into options. Exported for tests. */
export function parseCities(data: string): CityOption[] {
  const out: CityOption[] = [];
  for (const line of data.split("\n")) {
    const [city, state] = line.split("|");
    if (!city || !state) continue;
    out.push({ city, state, label: `${city}, ${state}`, key: searchKey(city) });
  }
  return out;
}

let loaded: Promise<CityOption[]> | null = null;

/** The list, fetched once and kept. */
export function loadUsCities(): Promise<CityOption[]> {
  if (!loaded) {
    loaded = import("./us-cities-data")
      .then((m) => parseCities(m.US_CITIES_DATA))
      .catch((e) => {
        loaded = null; // try again next time
        throw e;
      });
  }
  return loaded;
}

/** Does the typed state part name this state? "t", "tx", "tex", "texas". */
function stateMatches(state: string, typed: string): boolean {
  if (!typed) return true;
  if (state.toLowerCase().startsWith(typed)) return true;
  return searchKey(US_STATE_NAMES[state] ?? "").startsWith(typed);
}

/**
 * Up to `limit` places for what is typed, largest first.
 *
 * "hou" finds Houston first; "lake city" finds Salt Lake City (a later word
 * starting with it comes after the names that start with it); "houston, t" and
 * "houston tx" narrow to Texas.
 */
export function searchCities(list: readonly CityOption[], query: string, limit = 6): CityOption[] {
  let cityPart = query;
  let statePart = "";
  const comma = query.indexOf(",");
  if (comma !== -1) {
    cityPart = query.slice(0, comma);
    statePart = searchKey(query.slice(comma + 1));
  } else {
    // "Houston TX": a last word that is a state code is the state.
    const words = query.trim().split(/\s+/);
    const last = words[words.length - 1]?.toUpperCase() ?? "";
    if (words.length > 1 && last.length === 2 && US_STATE_NAMES[last]) {
      cityPart = words.slice(0, -1).join(" ");
      statePart = last.toLowerCase();
    }
  }
  const typed = searchKey(cityPart);
  if (!typed) return [];

  const first: CityOption[] = [];
  const later: CityOption[] = [];
  for (const option of list) {
    if (!stateMatches(option.state, statePart)) continue;
    if (option.key.startsWith(typed)) {
      first.push(option);
      if (first.length >= limit) break;
    } else if (later.length < limit && option.key.includes(` ${typed}`)) {
      later.push(option);
    }
  }
  return [...first, ...later].slice(0, limit);
}
