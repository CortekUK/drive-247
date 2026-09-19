import { describe, expect, it } from "vitest";
import http from "node:http";
import { readRepoSource } from "../helpers/edge-source";

/**
 * LIVE check of the booking port — opt-in, because it needs the booking app
 * running (and ONLY the booking app: nothing on 4006 or 4001 is needed):
 *
 *   npm run dev:booking
 *   cd apps/portal && LIVE_DEV_PORTS=1 npx vitest run src/__tests__/lib/booking-design-routing.live.test.ts
 *
 * The new design is recognised by its stylesheet (/nw-assets/site.<hash>.css),
 * which only the (northwind) root layout links. Requests go to 127.0.0.1 with an
 * explicit Host header because Node does not resolve `*.localhost` everywhere.
 */
const get = (host: string, path: string): Promise<{ status: number; body: string; location?: string }> =>
  new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: 3000, path, headers: { host } }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body, location: res.headers.location }));
    });
    req.on("error", reject);
    req.setTimeout(240_000, () => req.destroy(new Error(`timeout: ${host}${path}`)));
    req.end();
  });

const NEW_DESIGN_CSS = /NORTHWIND_SITE_CSS = "([^"]+)"/.exec(readRepoSource("apps/booking/src/northwind-site/site-css.ts"))![1];
const OTHER_TENANTS = ["revtekrentals", "rbvs", "globalmotiontransport"];

describe.runIf(process.env.LIVE_DEV_PORTS === "1")("booking port 3000 (live)", () => {
  it("TEST 1: Northwind's pages are the NEW design", async () => {
    for (const path of ["/", "/about", "/fleet", "/login"]) {
      const res = await get("northwind.localhost:3000", path);
      expect(res.status, path).toBe(200);
      expect(res.body, path).toContain(NEW_DESIGN_CSS);
    }
  }, 600_000);

  it("TEST 2 & 3: other tenants' pages are their ORIGINAL design", async () => {
    for (const slug of OTHER_TENANTS) {
      for (const path of ["/", "/about", "/fleet"]) {
        const res = await get(`${slug}.localhost:3000`, path);
        expect(res.status, `${slug} ${path}`).toBe(200);
        expect(res.body, `${slug} ${path}`).not.toContain("/nw-assets/");
      }
    }
  }, 600_000);

  it("other tenants cannot reach the new design, and keep their 404 and /booking redirect", async () => {
    for (const slug of OTHER_TENANTS) {
      const hidden = await get(`${slug}.localhost:3000`, "/northwind-site/about");
      expect(hidden.status).toBe(404);
      expect(hidden.body).not.toContain("/nw-assets/");
      expect((await get(`${slug}.localhost:3000`, "/no-such-page")).status).toBe(404);
      const booking = await get(`${slug}.localhost:3000`, "/booking");
      expect(booking.status).toBe(307);
      expect(booking.location).toBe("/");
    }
  }, 600_000);

  it("Northwind's payment pages stay on the original app", async () => {
    const res = await get("northwind.localhost:3000", "/checkout/test");
    expect(res.body).not.toContain("/nw-assets/");
  }, 600_000);

  it("the new design's stylesheet is served from port 3000", async () => {
    const res = await get("northwind.localhost:3000", NEW_DESIGN_CSS);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(50_000);
  }, 120_000);
});
