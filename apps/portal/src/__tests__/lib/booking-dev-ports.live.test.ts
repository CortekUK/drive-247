import { describe, expect, it } from "vitest";
import http from "node:http";

/**
 * LIVE check of the local booking ports — opt-in, because it needs the dev
 * servers running:
 *
 *   npm run dev:site      (new booking app, :3000)
 *   npm run dev:booking   (old booking app, :4001)
 *   cd apps/portal && LIVE_DEV_PORTS=1 npx vitest run src/__tests__/lib/booking-dev-ports.live.test.ts
 *
 * The two apps are told apart by a route only the OLD app has: /apply.
 * Requests go to 127.0.0.1 with an explicit Host header because Node does not
 * resolve `*.localhost` subdomains on every platform.
 */
const get = (port: number, host: string, path: string): Promise<{ status: number; body: string }> =>
  new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path, headers: { host } }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.setTimeout(240_000, () => req.destroy(new Error(`timeout: ${host}${path}`)));
    req.end();
  });

const title = (html: string) => /<title>([^<]*)<\/title>/i.exec(html)?.[1] ?? "";

describe.runIf(process.env.LIVE_DEV_PORTS === "1")("local booking ports (live)", () => {
  it("5. http://localhost:3000 is the NEW app, showing Northwind", async () => {
    const home = await get(3000, "localhost:3000", "/");
    expect(home.status).toBe(200);
    expect(title(home.body)).toMatch(/Northwind/);
  }, 300_000);

  it("6. the OLD app is no longer on 3000 (its /apply route is not there)", async () => {
    const apply = await get(3000, "localhost:3000", "/apply");
    expect(apply.status).toBe(404);
  }, 300_000);

  it("other tenants' old booking site still answers on 4001", async () => {
    const home = await get(4001, "revtekrentals.localhost:4001", "/");
    expect(home.status).toBe(200);
    expect(title(home.body)).toMatch(/RevTek/);
    const apply = await get(4001, "revtekrentals.localhost:4001", "/apply");
    expect(apply.status).toBe(200);
  }, 300_000);

  it("nothing is left on the new app's old port, 4006", async () => {
    await expect(get(4006, "localhost:4006", "/")).rejects.toThrow();
  }, 60_000);
});
