// @vitest-environment jsdom
/**
 * Evals for Neema's "Signup bug report: step 3 is blocking signups"
 * (Sunday 22 November 2026, for Haris).
 *
 * Each block replays what PostHog recorded, not what the report guessed:
 * autocapture keeps a `change` event for every field a visitor edits, so we
 * know which boxes were really filled even though recordings hide the text.
 *
 *   Orlando (Facebook app, iPhone, Sat 13:36 UTC) never tapped or typed in
 *   "Business name". The grey placeholder "Acme Car Rentals" read as an answer
 *   (it fooled Replay Vision too), so the error appeared under a box that
 *   looked filled.
 *
 *   Fresno (Instagram app, Android, Google sign-in, Sat 18:04 UTC): the
 *   phone's autofill wrote into "Web address" twice without a keystroke (2 s
 *   after coming back from Google, and again together with "City and state").
 *   The Google return had also marked the address as "chosen by the visitor",
 *   so it never followed the business name. Result: "must start with a
 *   letter", then "Please choose a web address".
 *
 * The form is rendered for real (React + jsdom). Only "How did you hear about
 * us?" is stubbed, because its Radix dropdown needs a real pointer.
 */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import * as validation from "@/lib/signup-validation";
import * as analytics from "@/lib/analytics";
import { isValidPhone } from "@/lib/signup-attribution";
import { SIGNUP_PLANS } from "@/lib/plans";

import { draftToBusiness } from "./tenant-draft";
import { EMPTY_BUSINESS_DRAFT, type BusinessDraft } from "./onboarding-types";
import { TenantIdentityFields } from "./tenant-identity-fields";
import { AccountStep, type AccountStepShellProps } from "./steps/account-step";

vi.mock("next/font/google", () => ({
  Roboto: () => ({ className: "font-roboto", style: {} }),
}));

// The dropdown is Radix (pointer-driven). One button answers both questions
// and gives the phone number, which is required since 2026-11-24.
vi.mock("@/components/onboarding/heard-about-fields", () => ({
  HeardAboutFields: (props: { onChange(patch: Record<string, unknown>): void }) => (
    <button
      type="button"
      data-testid="answer-attribution"
      onClick={() => props.onChange({ heardAbout: "facebook", fleetSize: "1-5", phone: "(559) 283-5337" })}
    >
      answer
    </button>
  ),
}));

const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");
const strip = (s: string) =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;

/** A person typing: the browser sends an InputEvent with an inputType. */
function type(el: HTMLInputElement, value: string) {
  act(() => {
    valueSetter.call(el, value);
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
  });
}

/** Browser autofill: the value changes and a plain `input` Event fires, no inputType. */
function autofill(el: HTMLInputElement, value: string) {
  act(() => {
    valueSetter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** A bot setting `.value` directly: no event at all. */
function setSilently(el: HTMLInputElement, value: string) {
  valueSetter.call(el, value);
}

function click(el: Element) {
  act(() => {
    (el as HTMLElement).click();
  });
}

function submit(container: HTMLElement) {
  const form = container.querySelector<HTMLFormElement>("#signup-account-form")!;
  act(() => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

const $ = <T extends Element = HTMLInputElement>(c: HTMLElement, sel: string) =>
  c.querySelector<T>(sel);

// ---------------------------------------------------------------------------
// Harness: the provider's controlled business draft, as the shell wires it
// ---------------------------------------------------------------------------

const PLAN = SIGNUP_PLANS[0];
const neverSettles = () => new Promise<never>(() => {});

interface HarnessProps extends Partial<AccountStepShellProps> {
  initialTenant?: BusinessDraft;
  startPage?: number;
}

function Harness({ initialTenant, startPage = 0, ...overrides }: HarnessProps) {
  const [tenant, setTenant] = React.useState<BusinessDraft>(initialTenant ?? { ...EMPTY_BUSINESS_DRAFT });
  const [page, setPage] = React.useState(startPage);
  return (
    <AccountStep
      plan={PLAN}
      mode="create"
      initialValues={{ fullName: "", email: "" }}
      tenant={tenant}
      onTenantChange={(patch) => setTenant((t) => ({ ...t, ...patch }))}
      signInPrompt={null}
      busy={false}
      error={null}
      googleEnabled={false}
      onSubmit={vi.fn()}
      onSubmitTenant={vi.fn()}
      onSubmitAttribution={vi.fn()}
      onGoogle={vi.fn()}
      onCheckSlug={neverSettles}
      onSignIn={vi.fn()}
      onUseDifferentEmail={vi.fn()}
      onSignInInstead={vi.fn()}
      page={page}
      onPageChange={setPage}
      paid={false}
      {...overrides}
    />
  );
}

let container: HTMLDivElement;
let root: Root;
let capture: ReturnType<typeof vi.fn>;
let scrollIntoView: ReturnType<typeof vi.fn>;

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom has no ResizeObserver; the terms checkbox (Radix) measures itself with one.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  capture = vi.fn();
  (window as unknown as { posthog: unknown }).posthog = { capture, identify: vi.fn() };
  scrollIntoView = vi.fn();
  Element.prototype.scrollIntoView = scrollIntoView as unknown as Element["scrollIntoView"];
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete (window as unknown as { posthog?: unknown }).posthog;
});

function mount(props: HarnessProps = {}) {
  act(() => root.render(<Harness {...props} />));
}

const events = (name: string) =>
  capture.mock.calls.filter(([event]) => event === name).map(([, props]) => props as Record<string, unknown>);

/**
 * Fill page 1 ("who you are") the way Orlando did. Since 2026-11-23 the
 * business page comes next and sends the form; the password is its own screen
 * after the email code (`password` mode).
 */
function passFirstPage() {
  type($(container, "#signup-full-name")!, "Orlando Driver");
  type($(container, "#signup-email")!, "orlando@rentco.com");
  click($(container, '[data-testid="answer-attribution"]')!);
  submit(container);
}

/** Fill the password screen (`password` mode, after the code) and send it. */
function passPasswordScreen() {
  type($(container, "#signup-password")!, "Str0ng!Passw0rd#2026");
  type($(container, "#signup-password-confirm")!, "Str0ng!Passw0rd#2026");
  submit(container);
}

// ===========================================================================
// Bug 1: "Please enter your business name" under a box that looks filled
// ===========================================================================

describe("Bug 1 (Orlando): an empty business name never looks filled", () => {
  it("placeholders read as examples, not answers", () => {
    act(() =>
      root.render(
        <TenantIdentityFields
          value={{ ...EMPTY_BUSINESS_DRAFT }}
          busy={false}
          errors={{}}
          onChange={vi.fn()}
          onClearError={vi.fn()}
          onCheckSlug={neverSettles}
          askCityState
        />,
      ),
    );
    const name = $(container, "#signup-company-name")!;
    const city = $(container, "#signup-city-state")!;
    const slug = $(container, "#signup-slug")!;
    expect(name.placeholder).toMatch(/^e\.g\. /);
    expect(city.placeholder).toMatch(/^e\.g\. /);
    // The address is filled from the business name, so it needs no sample at all.
    expect(slug.placeholder).toBe("");
  });

  it("an empty field with an error shows no sample text at all", () => {
    act(() =>
      root.render(
        <TenantIdentityFields
          value={{ ...EMPTY_BUSINESS_DRAFT }}
          busy={false}
          errors={{ companyName: "Please enter your business name.", cityState: "Please enter your city and state." }}
          onChange={vi.fn()}
          onClearError={vi.fn()}
          onCheckSlug={neverSettles}
          askCityState
        />,
      ),
    );
    expect($(container, "#signup-company-name")!.placeholder).toBe("");
    expect($(container, "#signup-city-state")!.placeholder).toBe("");
  });

  it("Orlando's path: name left empty → clear error, empty-looking box, caret and scroll on it", () => {
    const onSubmit = vi.fn();
    mount({ onSubmit });
    passFirstPage();
    expect(container.textContent).toContain("What's your business called?");

    // Orlando's recorded order: city, tapped the address, ticked terms. Never the name.
    type($(container, "#signup-city-state")!, "Orlando, FL");
    click($(container, "#signup-terms")!);
    submit(container);

    expect(onSubmit).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Please enter your business name.");
    const name = $(container, "#signup-company-name")!;
    expect(name.value).toBe("");
    expect(name.placeholder).toBe("");
    expect(document.activeElement).toBe(name);
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it("the same path with a name typed goes through", () => {
    const onSubmit = vi.fn();
    mount({ onSubmit });
    passFirstPage();
    type($(container, "#signup-company-name")!, "Sunshine Rentals");
    type($(container, "#signup-city-state")!, "Orlando, FL");
    click($(container, "#signup-terms")!);
    submit(container);
    // The business page sends the form, with no password: the account is made
    // with a stand-in, and the password screen comes after the code.
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      companyName: "Sunshine Rentals",
      slug: "sunshine-rentals",
      cityState: "Orlando, FL",
      acceptedTerms: true,
      password: "",
    });
  });
});

// ===========================================================================
// Bug 2: web address rejected, then cleared (Fresno, Google path)
// ===========================================================================

describe("Bug 2 (Fresno): the web address follows the name and survives autofill", () => {
  it("coming back from Google with no address leaves it free to follow the name", () => {
    const empty = draftToBusiness({ companyName: "", slug: "", acceptedTerms: false });
    expect(empty.slugTouched).toBe(false);
    // An address the visitor really did pick still stays theirs.
    expect(draftToBusiness({ companyName: "Acme", slug: "acme-cars", acceptedTerms: true }).slugTouched).toBe(true);
  });

  it("autofill writing into the address box does not take it over", () => {
    const onChange = vi.fn();
    act(() =>
      root.render(
        <TenantIdentityFields
          value={{ ...EMPTY_BUSINESS_DRAFT, companyName: "Fresno Rentals", slug: "fresno-rentals", slugTouched: false }}
          busy={false}
          errors={{}}
          onChange={onChange}
          onClearError={vi.fn()}
          onCheckSlug={neverSettles}
          askCityState
        />,
      ),
    );
    autofill($(container, "#signup-slug")!, "(559) 283-5337");
    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls.at(-1)![0].slugTouched).not.toBe(true);
  });

  it("typing in the address box does make it the visitor's own", () => {
    const onChange = vi.fn();
    act(() =>
      root.render(
        <TenantIdentityFields
          value={{ ...EMPTY_BUSINESS_DRAFT, companyName: "Fresno Rentals", slug: "fresno-rentals", slugTouched: false }}
          busy={false}
          errors={{}}
          onChange={onChange}
          onClearError={vi.fn()}
          onCheckSlug={neverSettles}
          askCityState
        />,
      ),
    );
    type($(container, "#signup-slug")!, "Fresno Car Hire");
    expect(onChange.mock.calls.at(-1)![0]).toEqual({ slug: "fresno-car-hire", slugTouched: true });
  });

  it("the address box does not invite website or password-manager autofill", () => {
    act(() =>
      root.render(
        <TenantIdentityFields
          value={{ ...EMPTY_BUSINESS_DRAFT }}
          busy={false}
          errors={{}}
          onChange={vi.fn()}
          onClearError={vi.fn()}
          onCheckSlug={neverSettles}
        />,
      ),
    );
    const slug = $(container, "#signup-slug")!;
    expect(slug.getAttribute("inputmode")).not.toBe("url");
    expect(slug.getAttribute("autocomplete")).toBe("off");
    expect(slug.hasAttribute("data-1p-ignore")).toBe(true);
    expect(slug.getAttribute("data-lpignore")).toBe("true");
  });

  it("repairs an address autofill spoiled, or one left empty, from the business name", () => {
    const repair = (validation as Record<string, unknown>).repairSlug as
      | ((d: Pick<BusinessDraft, "companyName" | "slug" | "slugTouched">) => string | null)
      | undefined;
    expect(typeof repair).toBe("function");
    // Autofill junk, never typed: rebuilt from the name.
    expect(repair!({ companyName: "Fresno Rentals", slug: "559-283-5337", slugTouched: false })).toBe("fresno-rentals");
    // Emptied, typed or not: filled from the name rather than refused.
    expect(repair!({ companyName: "Fresno Rentals", slug: "", slugTouched: true })).toBe("fresno-rentals");
    // A good address is left alone, and so is one the visitor typed themselves.
    expect(repair!({ companyName: "Fresno Rentals", slug: "fresno-cars", slugTouched: true })).toBeNull();
    expect(repair!({ companyName: "Fresno Rentals", slug: "1stchoice", slugTouched: true })).toBeNull();
    // Nothing to build from: no repair.
    expect(repair!({ companyName: "", slug: "", slugTouched: false })).toBeNull();
  });

  it("Fresno's path end to end: Google return, name typed, autofill twice, Continue works", () => {
    const onSubmitTenant = vi.fn();
    mount({
      mode: "tenant",
      onSubmitTenant,
      initialTenant: draftToBusiness({ companyName: "", slug: "", acceptedTerms: false }),
    });

    // 18:04:48: autofill writes into the address box before anything is typed.
    autofill($(container, "#signup-slug")!, "jamesolajuyin");
    // 18:05:24: the business name.
    type($(container, "#signup-company-name")!, "Fresno Rentals");
    expect($(container, "#signup-slug")!.value).toBe("fresno-rentals");
    // 18:05:26: autofill fills city and address together.
    autofill($(container, "#signup-city-state")!, "Fresno, CA");
    autofill($(container, "#signup-slug")!, "(559) 283-5337");
    click($(container, "#signup-terms")!);
    submit(container);

    expect(container.textContent).not.toContain("must start with a letter");
    expect(container.textContent).not.toContain("Please choose a web address");
    expect(onSubmitTenant).toHaveBeenCalledTimes(1);
    expect(onSubmitTenant.mock.calls[0][0]).toMatchObject({
      companyName: "Fresno Rentals",
      slug: "fresno-rentals",
      cityState: "Fresno, CA",
      acceptedTerms: true,
    });
  });

  it("emptying the address and pressing Continue fills it from the name instead of refusing", () => {
    const onSubmitTenant = vi.fn();
    mount({ mode: "tenant", onSubmitTenant });
    type($(container, "#signup-company-name")!, "Fresno Rentals");
    type($(container, "#signup-city-state")!, "Fresno, CA");
    type($(container, "#signup-slug")!, "");
    click($(container, "#signup-terms")!);
    submit(container);
    expect(onSubmitTenant).toHaveBeenCalledTimes(1);
    expect(onSubmitTenant.mock.calls[0][0].slug).toBe("fresno-rentals");
  });

  it("an address the visitor typed is never cleared, even when it needs fixing", () => {
    const onSubmitTenant = vi.fn();
    mount({ mode: "tenant", onSubmitTenant });
    type($(container, "#signup-company-name")!, "1st Choice Rentals");
    type($(container, "#signup-city-state")!, "Fresno, CA");
    type($(container, "#signup-slug")!, "1stchoice");
    click($(container, "#signup-terms")!);
    submit(container);
    expect(onSubmitTenant).not.toHaveBeenCalled();
    expect($(container, "#signup-slug")!.value).toBe("1stchoice");
    expect(container.textContent).toContain("must start with a letter");
  });

  it("Neema's checklist: \"Joe's Car Rentals\" + a city typed by hand goes through", () => {
    const onSubmitTenant = vi.fn();
    mount({ mode: "tenant", onSubmitTenant });
    type($(container, "#signup-company-name")!, "Joe's Car Rentals");
    expect($(container, "#signup-slug")!.value).toBe("joe-s-car-rentals");
    type($(container, "#signup-city-state")!, "Fresno, CA");
    click($(container, "#signup-terms")!);
    submit(container);
    expect(onSubmitTenant).toHaveBeenCalledTimes(1);
    expect(onSubmitTenant.mock.calls[0][0]).toMatchObject({ slug: "joe-s-car-rentals", cityState: "Fresno, CA" });
  });

  it("\"City and state\" is free text (no list to pick from) and a ZIP code is accepted", () => {
    expect(validation.validateCityState("Fresno, CA")).toBeUndefined();
    expect(validation.validateCityState("Fresno")).toBeUndefined();
    expect(validation.validateCityState("93721")).toBeUndefined();
    expect(validation.validateCityState("93721-1234")).toBeUndefined();
    // Still required, and still has to look like a place.
    expect(validation.validateCityState("")).toBe("Please enter your city and state.");
    expect(validation.validateCityState("123")).toBeTruthy();
    // There is no suggestion list for a keyboard to hide.
    const fields = strip(read("tenant-identity-fields.tsx"));
    expect(fields).not.toMatch(/role="listbox"|datalist|suggestion.*cityState/i);
  });
});

// ===========================================================================
// Bug 3: blank screen between step 1 and the password step
// ===========================================================================

describe("Bug 3 (Dinuba): the next page follows step 1 directly", () => {
  it("one Continue on step 1 shows the business fields straight away", () => {
    mount();
    type($(container, "#signup-full-name")!, "Dinuba Driver");
    type($(container, "#signup-email")!, "dinuba@rentco.com");
    click($(container, '[data-testid="answer-attribution"]')!);
    submit(container);
    expect($(container, "#signup-company-name")).not.toBeNull();
    expect($(container, "#signup-city-state")).not.toBeNull();
    expect($(container, "#signup-full-name")).toBeNull();
  });

  it("the business page asks no password: it comes after the code, on its own screen", () => {
    mount();
    passFirstPage();
    expect($(container, "#signup-password")).toBeNull();
    act(() => root.render(<Harness mode="password" />));
    expect($(container, "#signup-password")).not.toBeNull();
    expect($(container, "#signup-password-confirm")).not.toBeNull();
    expect($(container, "#signup-company-name")).toBeNull();
  });

  it("the password screen sends the password once it passes and matches", () => {
    const onSubmitPassword = vi.fn();
    mount({ mode: "password", onSubmitPassword });
    type($(container, "#signup-password")!, "Str0ng!Passw0rd#2026");
    type($(container, "#signup-password-confirm")!, "Str0ng!Passw0rd#2027");
    submit(container);
    expect(onSubmitPassword).not.toHaveBeenCalled();
    expect(container.textContent).toContain("These passwords don't match.");
    passPasswordScreen();
    expect(onSubmitPassword).toHaveBeenCalledWith("Str0ng!Passw0rd#2026");
  });
});

// ===========================================================================
// Bug 4: two popups in a row on the card step
// ===========================================================================

describe("Bug 4 (Pedro, Friday): one box on the way out of the card step", () => {
  it("the old \"Leave for now? / Keep going / Leave\" box is gone", () => {
    const screen = strip(read("onboarding-screen.tsx"));
    expect(screen).not.toMatch(/Keep going|Leave for now|closeConfirmOpen/);
    const provider = strip(read("onboarding-provider.tsx"));
    const requestClose = provider.slice(provider.indexOf("const requestClose"), provider.indexOf("const submitAccount"));
    expect(requestClose).toContain("closeNow()");
    expect(requestClose).not.toMatch(/confirm/i);
  });
});

// ===========================================================================
// "Please also check"
// ===========================================================================

describe("Step 1: the phone check never silently rejects a valid number", () => {
  it("accepts the common US ways of writing a number, and blank", () => {
    for (const phone of ["(559) 283-5337", "559-283-5337", "5592835337", "+1 559 283 5337", "+15592835337", ""]) {
      expect(isValidPhone(phone)).toBe(true);
    }
  });

  it("a number it does reject comes with a message", () => {
    expect(isValidPhone("call me")).toBe(false);
    const source = read("../../lib/signup-attribution.ts");
    expect(source).toContain("Please enter a valid phone number.");
  });
});

describe("Autofill never trips the anti-bot field", () => {
  it("a hidden field filled by autofill is not sent as a bot signal", () => {
    const onSubmit = vi.fn();
    mount({ onSubmit });
    // Fresno's phone filled it at 18:00:45 along with name, email and phone.
    autofill($(container, 'input[name="hp_x7"]')!, "742 Evergreen Terrace");
    passFirstPage();
    type($(container, "#signup-company-name")!, "Sunshine Rentals");
    type($(container, "#signup-city-state")!, "Orlando, FL");
    click($(container, "#signup-terms")!);
    submit(container);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].companyWebsite).toBe("");
  });

  it("a bot that writes the field directly is still caught", () => {
    const onSubmit = vi.fn();
    mount({ onSubmit });
    setSilently($(container, 'input[name="hp_x7"]')!, "https://spam.example");
    passFirstPage();
    type($(container, "#signup-company-name")!, "Sunshine Rentals");
    type($(container, "#signup-city-state")!, "Orlando, FL");
    click($(container, "#signup-terms")!);
    submit(container);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].companyWebsite).toBe("https://spam.example");
  });
});

// ===========================================================================
// "Also needed" #2: an event at the end of every step, and on every error
// ===========================================================================

describe("Tracking: signup_step_completed and signup_validation_error", () => {
  it("the helpers send the agreed names and properties", () => {
    const step = (analytics as Record<string, unknown>).captureStepCompleted as
      | ((s: number, p?: Record<string, unknown>) => void)
      | undefined;
    const invalid = (analytics as Record<string, unknown>).captureValidationErrors as
      | ((s: number, e: Record<string, string | undefined>) => void)
      | undefined;
    expect(typeof step).toBe("function");
    expect(typeof invalid).toBe("function");
    step!(4);
    invalid!(3, { companyName: "Please enter your business name.", slug: undefined });
    expect(capture).toHaveBeenCalledWith("signup_step_completed", { step: 4, step_name: "email_code" });
    expect(capture).toHaveBeenCalledWith("signup_validation_error", {
      step: 3,
      step_name: "business",
      field: "companyName",
      message: "Please enter your business name.",
    });
    expect(events("signup_validation_error")).toHaveLength(1);
  });

  it("steps 1 and 3 report themselves on the way to the code, in the order they are met", () => {
    mount();
    passFirstPage();
    type($(container, "#signup-company-name")!, "Sunshine Rentals");
    type($(container, "#signup-city-state")!, "Orlando, FL");
    click($(container, "#signup-terms")!);
    submit(container);
    // Step numbers keep their names (3 is still "business"), so PostHog's
    // step_name means the same thing before and after the reorder.
    expect(events("signup_step_completed").map((p) => [p.step, p.step_name])).toEqual([
      [1, "details"],
      [3, "business"],
    ]);
  });

  it("step 2 reports itself on the password screen, after the code", () => {
    mount({ mode: "password" });
    passPasswordScreen();
    expect(events("signup_step_completed").map((p) => [p.step, p.step_name])).toEqual([[2, "password"]]);
  });

  it("step 3 reports itself on the Google path too", () => {
    mount({ mode: "tenant" });
    type($(container, "#signup-company-name")!, "Fresno Rentals");
    type($(container, "#signup-city-state")!, "Fresno, CA");
    click($(container, "#signup-terms")!);
    submit(container);
    expect(events("signup_step_completed")).toEqual([{ step: 3, step_name: "business", screen: "business_only" }]);
  });

  it("every error a visitor sees is reported with its field and message", () => {
    mount({ mode: "tenant" });
    submit(container);
    const errors = events("signup_validation_error");
    expect(errors.map((e) => e.field)).toEqual(expect.arrayContaining(["companyName", "cityState", "acceptedTerms"]));
    expect(errors.find((e) => e.field === "companyName")).toMatchObject({
      step: 3,
      step_name: "business",
      message: "Please enter your business name.",
    });
  });

  it("steps 4 (email code) and 5 (card) report themselves from the provider", () => {
    const provider = strip(read("onboarding-provider.tsx"));
    expect(provider).toMatch(/captureStepCompleted\(4\b/);
    expect(provider).toMatch(/captureStepCompleted\(5\b/);
  });
});
