import { describe, expect, it } from "vitest";
import { readRepoSource } from "../helpers/edge-source";

/**
 * "Connect with Square" failed with "Converting circular structure to JSON
 * --> starting at object with constructor 'HTMLButtonElement'". The button's
 * onClick was `sq.connect` itself, so React handed it the click event as its
 * optional `connectMode`, and that event went into square-oauth-start's
 * request body. See src/hooks/use-square-connection.ts.
 */
const settings = readRepoSource("apps/portal/src/components/settings/square-settings.tsx");
const hook = readRepoSource("apps/portal/src/hooks/use-square-connection.ts");

describe("Square connect buttons", () => {
  it("never pass sq.connect straight to a button", () => {
    expect(settings).not.toMatch(/=\{sq\.connect\}/);
    expect(settings).toContain("onConnect={() => sq.connect()}");
    expect(settings.match(/onReconnect=\{\(\) => sq\.connect\(\)\}/g)).toHaveLength(2);
    expect(settings).toContain('onConnectLive={() => sq.connect("live")}');
  });

  it("connect only forwards a real mode, so an event can never reach the request body", () => {
    expect(hook).toMatch(
      /connect: \(connectMode\?: SquareMode\) =>\s*connectMutation\.mutate\(connectMode === "live" \|\| connectMode === "test" \? connectMode : undefined\)/,
    );
  });
});
