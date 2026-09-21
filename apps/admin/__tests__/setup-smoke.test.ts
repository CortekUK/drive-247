import { describe, it, expect } from "vitest";
import { NOTIFICATION_CHANNELS } from "@/lib/notifications-v2/types";

/**
 * Proves the test harness itself, so a later failure means the code is wrong
 * rather than the setup: a DOM, the jest-dom matchers, the three browser APIs
 * the setup file shims, and the `@` alias — which in this app points at the
 * project ROOT, not src/ (tsconfig `"@/*": ["./*"]`).
 */

describe("the admin test setup", () => {
  it("runs in a DOM", () => {
    expect(typeof window).toBe("object");
    expect(typeof document.createElement).toBe("function");
  });

  it("has the jest-dom matchers", () => {
    const el = document.createElement("p");
    el.textContent = "hello";
    document.body.appendChild(el);
    expect(el).toBeInTheDocument();
    expect(el).toHaveTextContent("hello");
    el.remove();
  });

  it("can store and clear in localStorage and sessionStorage", () => {
    for (const store of [window.localStorage, window.sessionStorage]) {
      store.clear();
      store.setItem("k", "v");
      expect(store.getItem("k")).toBe("v");
      expect(store.length).toBe(1);
      store.removeItem("k");
      expect(store.getItem("k")).toBeNull();
      store.setItem("k2", "v2");
      store.clear();
      expect(store.length).toBe(0);
    }
  });

  it("has matchMedia, ResizeObserver and IntersectionObserver", () => {
    expect(window.matchMedia("(min-width: 768px)").matches).toBe(false);
    const noop = (): void => undefined;
    expect(() => new ResizeObserver(noop).observe(document.body)).not.toThrow();
    expect(() => new IntersectionObserver(noop).observe(document.body)).not.toThrow();
  });

  it("resolves the @ alias to the project root", () => {
    expect(NOTIFICATION_CHANNELS).toEqual(["email", "push", "in_app"]);
  });
});
