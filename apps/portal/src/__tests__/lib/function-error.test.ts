import { describe, expect, it } from "vitest";
import { functionErrorMessage } from "@/lib/function-error";

const GENERIC = "Edge Function returned a non-2xx status code";

/** What supabase-js hands back for a non-2xx edge-function reply. */
const httpError = (status: number, body: string | null, message = GENERIC) =>
  Object.assign(new Error(message), { context: new Response(body, { status }) });

describe("functionErrorMessage", () => {
  it("prefers the server's own error text", async () => {
    const error = httpError(400, JSON.stringify({ error: "Invalid tab keys: enquiries" }));
    expect(await functionErrorMessage(error, "Failed to update role")).toBe(
      "Invalid tab keys: enquiries",
    );
  });

  it("accepts a message field too", async () => {
    const error = httpError(403, JSON.stringify({ message: "Only head admins can do this" }));
    expect(await functionErrorMessage(error, "fallback")).toBe("Only head admins can do this");
  });

  it("falls back when the body is not JSON or has no text", async () => {
    expect(await functionErrorMessage(httpError(502, "<html>Bad gateway</html>"), "Failed to create user")).toBe(
      "Failed to create user",
    );
    expect(await functionErrorMessage(httpError(500, JSON.stringify({ error: "" })), "fallback")).toBe("fallback");
    expect(await functionErrorMessage(httpError(500, null), "fallback")).toBe("fallback");
  });

  it("keeps a specific message from a plain error", async () => {
    expect(await functionErrorMessage(new Error("Failed to fetch"), "fallback")).toBe("Failed to fetch");
    expect(await functionErrorMessage("quota exceeded", "fallback")).toBe("quota exceeded");
  });

  it("falls back for unknown shapes and the bare wrapper text", async () => {
    expect(await functionErrorMessage(undefined, "fallback")).toBe("fallback");
    expect(await functionErrorMessage(null, "fallback")).toBe("fallback");
    expect(await functionErrorMessage({ context: null }, "fallback")).toBe("fallback");
    expect(await functionErrorMessage(new Error(GENERIC), "fallback")).toBe("fallback");
  });

  it("leaves the response body readable for the caller", async () => {
    const error = httpError(400, JSON.stringify({ error: "nope" }));
    await functionErrorMessage(error, "x");
    expect((await error.context.json()).error).toBe("nope");
  });
});
