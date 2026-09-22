/**
 * Notifications v2 (D14): the v2 portal service worker and how it gets
 * registered.
 *
 * public/service-worker-v2.js is plain browser JS that nothing imports, so it
 * is loaded as text and run inside a fake service-worker global: `self` records
 * every addEventListener, `self.registration.showNotification` and
 * `self.clients.*` are spies. Each case then dispatches a push or a click and
 * checks what the worker did. Expected values are written out by hand.
 *
 * The second half checks `registerServiceWorkerV2` in lib/push against a fake
 * `navigator.serviceWorker`, on a fresh module each time (its promise is
 * memoised per page load).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const PUBLIC_DIR = join(__dirname, "..", "..", "..", "public");
const V2_SOURCE = readFileSync(join(PUBLIC_DIR, "service-worker-v2.js"), "utf8");
const V1_SOURCE = readFileSync(join(PUBLIC_DIR, "service-worker.js"), "utf8");

const ORIGIN = "https://northwind.portal.drive-247.com";

/* -------------------------------------------------------------------------- */
/* Fake service-worker global                                                  */
/* -------------------------------------------------------------------------- */

interface FakeClient {
  url: string;
  focused?: boolean;
  visibilityState?: string;
  focus: ReturnType<typeof vi.fn>;
  navigate?: ReturnType<typeof vi.fn>;
  postMessage?: ReturnType<typeof vi.fn>;
}

function fakeClient(url: string, extra: Partial<FakeClient> = {}): FakeClient {
  const client: FakeClient = {
    url,
    focus: vi.fn(async () => client),
    navigate: vi.fn(async (next: string) => ({ ...client, url: next })),
    postMessage: vi.fn(),
    ...extra,
  };
  return client;
}

interface WorkerOptions {
  source?: string;
  /** `Notification.maxActions`; undefined leaves it off, as Safari/Firefox do. */
  maxActions?: number;
  clients?: FakeClient[];
  showNotification?: (...args: unknown[]) => Promise<unknown>;
}

function loadWorker({ source = V2_SOURCE, maxActions, clients = [], showNotification }: WorkerOptions = {}) {
  const listeners = new Map<string, (event: any) => void>();
  const show = vi.fn(showNotification ?? (async () => undefined));
  const clientsApi = {
    matchAll: vi.fn(async () => clients),
    openWindow: vi.fn(async (url: string) => fakeClient(url)),
    claim: vi.fn(async () => undefined),
  };
  const self = {
    addEventListener: (type: string, fn: (event: any) => void) => listeners.set(type, fn),
    skipWaiting: vi.fn(),
    clients: clientsApi,
    registration: {
      showNotification: show,
      pushManager: { subscribe: vi.fn(async () => ({ toJSON: () => ({ endpoint: "https://fcm.example/new" }) })) },
    },
    location: { origin: ORIGIN },
  };
  function NotificationStub() {}
  if (maxActions !== undefined) (NotificationStub as unknown as { maxActions: number }).maxActions = maxActions;

  class FakeResponse {
    constructor(public body: string, public init: unknown) {}
  }
  const fetchStub = vi.fn(async () => {
    throw new Error("offline");
  });

  // eslint-disable-next-line no-new-func
  new Function("self", "Notification", "fetch", "Response", source)(self, NotificationStub, fetchStub, FakeResponse);

  const fire = async (type: string, event: Record<string, unknown>) => {
    const pending: Promise<unknown>[] = [];
    listeners.get(type)!({ ...event, waitUntil: (p: Promise<unknown>) => pending.push(Promise.resolve(p)) });
    await Promise.all(pending);
  };

  return {
    listeners,
    self,
    show,
    clientsApi,
    fetchStub,
    push: (payload: unknown) =>
      fire("push", { data: payload === undefined ? null : { json: () => payload, text: () => JSON.stringify(payload) } }),
    pushRaw: (raw: string) =>
      fire("push", {
        data: {
          json: () => {
            throw new SyntaxError("Unexpected token");
          },
          text: () => raw,
        },
      }),
    click: (data: unknown, action?: string) => {
      const notification = { data, close: vi.fn() };
      return fire("notificationclick", { notification, action }).then(() => notification);
    },
    lastOptions: () => show.mock.calls[show.mock.calls.length - 1][1] as Record<string, any>,
    lastTitle: () => show.mock.calls[show.mock.calls.length - 1][0] as string,
  };
}

/* -------------------------------------------------------------------------- */
/* Same as v1                                                                  */
/* -------------------------------------------------------------------------- */

describe("service-worker-v2: what it keeps from v1", () => {
  it("installs straight away and claims open pages", async () => {
    const w = loadWorker();
    w.listeners.get("install")!({});
    expect(w.self.skipWaiting).toHaveBeenCalledTimes(1);
    const pending: Promise<unknown>[] = [];
    w.listeners.get("activate")!({ waitUntil: (p: Promise<unknown>) => pending.push(p) });
    await Promise.all(pending);
    expect(w.clientsApi.claim).toHaveBeenCalledTimes(1);
  });

  it("answers navigations only, with the offline page when the network fails, and caches nothing", async () => {
    const w = loadWorker();
    const respondWith = vi.fn();
    w.listeners.get("fetch")!({ request: { mode: "cors" }, respondWith });
    expect(respondWith).not.toHaveBeenCalled();

    w.listeners.get("fetch")!({ request: { mode: "navigate" }, respondWith });
    expect(respondWith).toHaveBeenCalledTimes(1);
    const response = (await respondWith.mock.calls[0][0]) as { body: string };
    expect(response.body).toContain("You're offline");
  });

  it("a send-push payload (tag, no renotify field) gives the same options as the v1 worker, plus silent: false", async () => {
    const payload = {
      title: "Test notification",
      body: "If you can see this on your lock screen, push notifications are working.",
      url: "/rentals",
      tag: "manual_test-northwind",
      requireInteraction: true,
      image: "https://cdn.example/car.jpg",
    };
    const v1 = loadWorker({ source: V1_SOURCE });
    const v2 = loadWorker();
    await v1.push(payload);
    await v2.push(payload);

    const { timestamp: _t1, ...v1Options } = v1.lastOptions();
    const { timestamp: _t2, ...v2Options } = v2.lastOptions();
    expect(v2.lastTitle()).toBe(v1.lastTitle());
    expect(v2Options).toEqual({ ...v1Options, silent: false });
    // Re-alerts on a repeat send, as v1 did, rather than replacing it quietly.
    expect(v2Options.renotify).toBe(true);
    expect(v2Options.data).toEqual({ url: "/rentals" });
  });

  it("a malformed payload still shows a notification (iOS revokes push from silent sites)", async () => {
    const w = loadWorker();
    await w.pushRaw("x".repeat(250));
    expect(w.show).toHaveBeenCalledTimes(1);
    expect(w.lastTitle()).toBe("Drive247");
    expect(w.lastOptions().body).toBe("x".repeat(200));
    expect(w.lastOptions().tag).toBe("drive247-portal");
    expect(w.lastOptions().renotify).toBe(false);
  });

  it("a push with no data shows the default title", async () => {
    const w = loadWorker();
    await w.push(undefined);
    expect(w.lastTitle()).toBe("Drive247");
    expect(w.lastOptions().data).toEqual({ url: "/" });
  });

  it("re-subscribes on pushsubscriptionchange and tells open windows", async () => {
    const tab = fakeClient(`${ORIGIN}/dashboard`);
    const w = loadWorker({ clients: [tab] });
    await (async () => {
      const pending: Promise<unknown>[] = [];
      w.listeners.get("pushsubscriptionchange")!({
        oldSubscription: { options: { applicationServerKey: "key" } },
        waitUntil: (p: Promise<unknown>) => pending.push(p),
      });
      await Promise.all(pending);
    })();
    expect(w.self.registration.pushManager.subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: "key",
    });
    expect(tab.postMessage).toHaveBeenCalledWith({
      type: "PUSH_SUBSCRIPTION_CHANGED",
      subscription: { endpoint: "https://fcm.example/new" },
    });
  });
});

/* -------------------------------------------------------------------------- */
/* push: actions, silent, renotify, data                                       */
/* -------------------------------------------------------------------------- */

describe("service-worker-v2: push options", () => {
  it("keeps only well-formed { action, title } pairs and drops everything else", async () => {
    const w = loadWorker({ maxActions: 2 });
    await w.push({
      title: "Booking confirmed",
      actions: [
        { action: "open", title: "Open in app", icon: "/icons/open.png" },
        { action: 5, title: "Not a string" },
        { title: "No action" },
        { action: "empty-title", title: "" },
        "junk",
        null,
      ],
    });
    expect(w.lastOptions().actions).toEqual([{ action: "open", title: "Open in app" }]);
  });

  it("caps the buttons at Notification.maxActions, and passes them all when the browser doesn't say", async () => {
    const actions = [
      { action: "open", title: "Open in app" },
      { action: "later", title: "Later" },
      { action: "mute", title: "Mute" },
    ];
    const chrome = loadWorker({ maxActions: 2 });
    await chrome.push({ title: "t", actions });
    expect(chrome.lastOptions().actions).toEqual(actions.slice(0, 2));

    const other = loadWorker();
    await other.push({ title: "t", actions });
    expect(other.lastOptions().actions).toEqual(actions);
  });

  it("sets no actions at all when the payload has none", async () => {
    const w = loadWorker({ maxActions: 2 });
    await w.push({ title: "t", actions: "open" });
    expect("actions" in w.lastOptions()).toBe(false);
  });

  it("silent only for a literal true", async () => {
    const w = loadWorker();
    await w.push({ title: "t", silent: true });
    expect(w.lastOptions().silent).toBe(true);
    await w.push({ title: "t", silent: "true" });
    expect(w.lastOptions().silent).toBe(false);
    await w.push({ title: "t" });
    expect(w.lastOptions().silent).toBe(false);
  });

  it("renotify is its own field, but never without a sender's tag", async () => {
    const w = loadWorker();

    await w.push({ title: "t", tag: "booking_confirmed-r1", renotify: false });
    expect(w.lastOptions()).toMatchObject({ tag: "booking_confirmed-r1", renotify: false });

    await w.push({ title: "t", tag: "booking_confirmed-r1", renotify: true });
    expect(w.lastOptions()).toMatchObject({ tag: "booking_confirmed-r1", renotify: true });

    // No tag of its own: the catch-all tag, and renotify stays off.
    await w.push({ title: "t", renotify: true });
    expect(w.lastOptions()).toMatchObject({ tag: "drive247-portal", renotify: false });

    await w.push({ title: "t", tag: "", renotify: true });
    expect(w.lastOptions()).toMatchObject({ tag: "drive247-portal", renotify: false });
  });

  it("keeps url and notificationKey in data", async () => {
    const w = loadWorker();
    await w.push({ title: "t", url: "/rentals/r1", notificationKey: "booking_confirmed" });
    expect(w.lastOptions().data).toEqual({ url: "/rentals/r1", notificationKey: "booking_confirmed" });

    await w.push({ title: "t", data: { notificationKey: "payment_received", rentalId: "r2" } });
    expect(w.lastOptions().data).toEqual({ url: "/", notificationKey: "payment_received", rentalId: "r2" });
  });

  it("requireInteraction only for a literal true", async () => {
    const w = loadWorker();
    await w.push({ title: "t", requireInteraction: "yes" });
    expect(w.lastOptions().requireInteraction).toBe(false);
    await w.push({ title: "t", requireInteraction: true });
    expect(w.lastOptions().requireInteraction).toBe(true);
  });

  it("if the browser refuses the options, shows a plain notification instead of nothing", async () => {
    let calls = 0;
    const w = loadWorker({
      maxActions: 2,
      showNotification: async () => {
        calls += 1;
        if (calls === 1) throw new TypeError("refused");
      },
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await w.push({
      title: "Booking confirmed",
      body: "R-1001",
      url: "/rentals/r1",
      tag: "t1",
      renotify: true,
      silent: true,
      actions: [{ action: "open", title: "Open in app" }],
    });
    errorSpy.mockRestore();
    expect(w.show).toHaveBeenCalledTimes(2);
    expect(w.show.mock.calls[1][0]).toBe("Booking confirmed");
    expect(w.show.mock.calls[1][1]).toEqual({
      body: "R-1001",
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-72.png",
      tag: "t1",
      data: { url: "/rentals/r1" },
    });
  });
});

/* -------------------------------------------------------------------------- */
/* notificationclick                                                           */
/* -------------------------------------------------------------------------- */

describe("service-worker-v2: notificationclick", () => {
  it("a tap on the body focuses this portal's window and takes it to the page", async () => {
    const tab = fakeClient(`${ORIGIN}/dashboard`);
    const w = loadWorker({ clients: [tab] });
    const notification = await w.click({ url: "/rentals/r1" }, "");
    expect(notification.close).toHaveBeenCalledTimes(1);
    expect(tab.focus).toHaveBeenCalledTimes(1);
    expect(tab.navigate).toHaveBeenCalledWith(`${ORIGIN}/rentals/r1`);
    expect(w.clientsApi.openWindow).not.toHaveBeenCalled();
  });

  it("'Open in app' does the same as a tap on the body", async () => {
    const tab = fakeClient(`${ORIGIN}/dashboard`);
    const w = loadWorker({ clients: [tab] });
    await w.click({ url: "/rentals/r1" }, "open");
    expect(tab.navigate).toHaveBeenCalledWith(`${ORIGIN}/rentals/r1`);
    expect(w.clientsApi.openWindow).not.toHaveBeenCalled();
  });

  it("a missing action (older browsers) counts as a tap on the body", async () => {
    const tab = fakeClient(`${ORIGIN}/dashboard`);
    const w = loadWorker({ clients: [tab] });
    await w.click({ url: "/fines" });
    expect(tab.navigate).toHaveBeenCalledWith(`${ORIGIN}/fines`);
  });

  it.each([
    ["another site", "https://evil.example/phish"],
    ["a protocol-relative link", "//evil.example/x"],
    ["a script URL", "javascript:alert(1)"],
    ["nothing", undefined],
  ])("never leaves the portal: %s opens the home page", async (_label, url) => {
    const tab = fakeClient(`${ORIGIN}/dashboard`);
    const w = loadWorker({ clients: [tab] });
    await w.click(url === undefined ? {} : { url }, "");
    expect(tab.navigate).toHaveBeenCalledWith(`${ORIGIN}/`);
  });

  it("an absolute URL on this portal is kept", async () => {
    const tab = fakeClient(`${ORIGIN}/dashboard`);
    const w = loadWorker({ clients: [tab] });
    await w.click({ url: `${ORIGIN}/customers/c1?tab=notes` }, "");
    expect(tab.navigate).toHaveBeenCalledWith(`${ORIGIN}/customers/c1?tab=notes`);
  });

  it("opens a window when navigate() is refused (a window this worker doesn't control)", async () => {
    const tab = fakeClient(`${ORIGIN}/dashboard`, {
      navigate: vi.fn(async () => {
        throw new TypeError("not controlled");
      }),
    });
    const w = loadWorker({ clients: [tab] });
    await w.click({ url: "/rentals/r1" }, "");
    expect(w.clientsApi.openWindow).toHaveBeenCalledWith(`${ORIGIN}/rentals/r1`);
  });

  it("opens a window when no window of this portal is open", async () => {
    const w = loadWorker({ clients: [fakeClient("https://other.example/page")] });
    await w.click({ url: "/rentals/r1" }, "open");
    expect(w.clientsApi.openWindow).toHaveBeenCalledWith(`${ORIGIN}/rentals/r1`);
  });

  it("an action it doesn't know opens the page in a new window", async () => {
    const tab = fakeClient(`${ORIGIN}/dashboard`);
    const w = loadWorker({ clients: [tab] });
    await w.click({ url: "/rentals/r1" }, "snooze");
    expect(w.clientsApi.openWindow).toHaveBeenCalledWith(`${ORIGIN}/rentals/r1`);
    expect(tab.focus).not.toHaveBeenCalled();
    expect(tab.navigate).not.toHaveBeenCalled();
  });

  it("already on that page: focuses it without reloading", async () => {
    const tab = fakeClient(`${ORIGIN}/rentals/r1`);
    const w = loadWorker({ clients: [tab] });
    await w.click({ url: "/rentals/r1" }, "");
    expect(tab.focus).toHaveBeenCalledTimes(1);
    expect(tab.navigate).not.toHaveBeenCalled();
    expect(w.clientsApi.openWindow).not.toHaveBeenCalled();
  });

  it("prefers the window the person is looking at", async () => {
    const background = fakeClient(`${ORIGIN}/a`);
    const focused = fakeClient(`${ORIGIN}/b`, { focused: true });
    const w = loadWorker({ clients: [background, focused] });
    await w.click({ url: "/rentals/r1" }, "");
    expect(focused.navigate).toHaveBeenCalledWith(`${ORIGIN}/rentals/r1`);
    expect(background.navigate).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* lib/push: registerServiceWorkerV2                                           */
/* -------------------------------------------------------------------------- */

describe("lib/push: registering the v2 worker", () => {
  const registration = { scope: `${ORIGIN}/`, pushManager: {} };
  let register: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    register = vi.fn(async () => registration);
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { register, ready: Promise.resolve(registration) },
    });
  });

  afterEach(() => {
    delete (navigator as unknown as { serviceWorker?: unknown }).serviceWorker;
  });

  it("v1 tenants: registerServiceWorker still only ever registers /service-worker.js", async () => {
    const push = await import("@/lib/push");
    await expect(push.registerServiceWorker()).resolves.toBe(registration);
    await push.registerServiceWorker();
    expect(register.mock.calls).toEqual([["/service-worker.js", { scope: "/" }]]);
  });

  it("v2: registers the v2 script at the same scope, and later registerServiceWorker() calls reuse it", async () => {
    const push = await import("@/lib/push");
    expect(push.SERVICE_WORKER_V2_URL).toBe("/service-worker-v2.js");
    const first = push.registerServiceWorkerV2();
    await expect(first).resolves.toBe(registration);
    // The push hook's reconcile / enable / disable must not swap v1 back in.
    expect(push.registerServiceWorker()).toBe(first);
    expect(push.registerServiceWorkerV2()).toBe(first);
    expect(register.mock.calls).toEqual([["/service-worker-v2.js", { scope: "/" }]]);
  });

  it("v2 after a v1 registration in the same page load: v2 wins and stays", async () => {
    const push = await import("@/lib/push");
    await push.registerServiceWorker();
    const v2 = push.registerServiceWorkerV2();
    await v2;
    expect(push.registerServiceWorker()).toBe(v2);
    expect(register.mock.calls.map((call) => call[0])).toEqual(["/service-worker.js", "/service-worker-v2.js"]);
  });

  it("if the v2 script can't be registered, falls back to the v1 worker", async () => {
    register.mockImplementation(async (url: string) => {
      if (url === "/service-worker-v2.js") throw new Error("404");
      return registration;
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const push = await import("@/lib/push");
    await expect(push.registerServiceWorkerV2()).resolves.toBe(registration);
    errorSpy.mockRestore();
    expect(register.mock.calls.map((call) => call[0])).toEqual(["/service-worker-v2.js", "/service-worker.js"]);
  });

  it("without service workers it resolves to null and registers nothing", async () => {
    delete (navigator as unknown as { serviceWorker?: unknown }).serviceWorker;
    const push = await import("@/lib/push");
    await expect(push.registerServiceWorkerV2()).resolves.toBeNull();
    expect(register).not.toHaveBeenCalled();
  });
});
