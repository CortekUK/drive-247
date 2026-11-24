import { describe, expect, it } from "vitest";

import { US_CITIES_DATA } from "./us-cities-data";
import { parseCities, searchCities, searchKey } from "./us-cities";

const list = parseCities(US_CITIES_DATA);
const labels = (q: string) => searchCities(list, q).map((o) => o.label);

describe("City and state picker", () => {
  it("holds the US places, largest first, named as people say them", () => {
    expect(list.length).toBeGreaterThan(10_000);
    expect(list[0].label).toBe("New York, NY");
    expect(list.some((o) => o.label === "Nashville, TN")).toBe(true);
    expect(list.some((o) => o.label === "Honolulu, HI")).toBe(true);
    expect(list.some((o) => /\b(city|town|village|borough)$/.test(o.city) && o.city !== "Carson City")).toBe(false);
  });

  it("puts the biggest match first", () => {
    expect(labels("hou")[0]).toBe("Houston, TX");
    expect(labels("Miami")[0]).toBe("Miami, FL");
  });

  it("narrows by state after a comma or a state code", () => {
    expect(labels("portland, me")[0]).toBe("Portland, ME");
    expect(labels("portland ME")[0]).toBe("Portland, ME");
    expect(labels("springfield, ill")[0]).toBe("Springfield, IL");
  });

  it("finds a later word, after the names that start with it", () => {
    // Six places are called exactly "Lake City", which fills the default list of
    // six, so the later-word match is looked for in a longer list.
    const longer = searchCities(list, "lake city", 20).map((o) => o.label);
    expect(longer).toContain("Salt Lake City, UT");
    expect(longer.indexOf("Salt Lake City, UT")).toBeGreaterThan(longer.indexOf("Lake City, FL"));
  });

  it("ignores accents and dots", () => {
    expect(searchKey("St. Louis")).toBe("st louis");
    expect(labels("st louis")[0]).toBe("St. Louis, MO");
    expect(labels("canon city")[0]).toBe("Cañon City, CO");
  });

  it("offers nothing for an empty box", () => {
    expect(labels("  ")).toEqual([]);
  });
});
