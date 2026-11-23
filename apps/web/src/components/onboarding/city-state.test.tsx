// @vitest-environment jsdom
/**
 * "City and state" on the signup's business page (Neema for Bryan, 2026-11-21:
 * so he can look the business up and find another number to call).
 *
 * WHAT THESE PIN:
 *   - the field is required, free text, one tidy line, at most 80 characters;
 *   - it sits under the business name wherever the business is asked: the
 *     page before the card and the business-only screen after Google;
 *   - it is carried to the server with the answers (signup-begin, or
 *     signup-attribution on its own), survives the Google redirect and a
 *     reload, and never holds up a build for a signup that started without it;
 *   - the rehearsal (mock) signup keeps it like the real server does.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { FIELD_MAX, normalizeCityState, validateCityState } from "@/lib/signup-validation";

import { mockFunction, mockResetSignup } from "./mock-signup";
import {
  clearLocalTenantDraft,
  clearPendingOauth,
  draftToBusiness,
  readLocalTenantDraft,
  readPendingOauth,
  writeLocalTenantDraft,
  writePendingOauth,
} from "./tenant-draft";
import { EMPTY_BUSINESS_DRAFT, type BusinessDraft } from "./onboarding-types";
import { TenantIdentityFields } from "./tenant-identity-fields";

const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");
const strip = (s: string) =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("city and state: the rule", () => {
  it("is required", () => {
    expect(validateCityState("")).toBe("Please enter your city and state.");
    expect(validateCityState("   ")).toBeTruthy();
    expect(validateCityState(undefined)).toBeTruthy();
    expect(validateCityState("x")).toBeTruthy();
  });

  it("must name a place, in any script", () => {
    // A bare number is not a place, but a US ZIP code is (2026-11-22: phone
    // autofill puts one there, and the team can look it up).
    expect(validateCityState("123")).toBeTruthy();
    expect(validateCityState("12345")).toBeUndefined();
    expect(validateCityState("--")).toBeTruthy();
    expect(validateCityState("Houston, TX")).toBeUndefined();
    expect(validateCityState("Toronto, ON")).toBeUndefined();
    expect(validateCityState("São Paulo, SP")).toBeUndefined();
    expect(validateCityState("東京")).toBeUndefined();
  });

  it("is kept to 80 characters", () => {
    expect(FIELD_MAX.cityState).toBe(80);
    expect(validateCityState("a".repeat(80))).toBeUndefined();
    expect(validateCityState("a".repeat(81))).toBe("Please keep this to 80 characters or fewer.");
  });

  it("is sent as one tidy line", () => {
    expect(normalizeCityState("  Houston,\n   TX  ")).toBe("Houston, TX");
    expect(normalizeCityState(null)).toBe("");
  });
});

describe("city and state: on the business page", () => {
  beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = (props: { askCityState?: boolean; value?: Partial<BusinessDraft>; error?: string }) => {
    const onChange = vi.fn();
    const onClearError = vi.fn();
    act(() =>
      root.render(
        <TenantIdentityFields
          value={{ ...EMPTY_BUSINESS_DRAFT, ...props.value }}
          busy={false}
          errors={{ cityState: props.error }}
          onChange={onChange}
          onClearError={onClearError}
          onCheckSlug={async (slug) => ({ slug, available: true, reason: "ok", suggestions: [] })}
          askCityState={props.askCityState}
        />,
      ),
    );
    return { onChange, onClearError };
  };

  it("sits right under the business name, with the business name's style", () => {
    render({ askCityState: true });
    const inputs = Array.from(container.querySelectorAll("input"));
    const ids = inputs.map((i) => i.id);
    expect(ids.indexOf("signup-city-state")).toBe(ids.indexOf("signup-company-name") + 1);
    const city = container.querySelector<HTMLInputElement>("#signup-city-state")!;
    const company = container.querySelector<HTMLInputElement>("#signup-company-name")!;
    // An example, marked as one, so an empty box never reads as filled (2026-11-22).
    expect(city.placeholder).toBe("e.g. Houston, TX");
    expect(city.maxLength).toBe(80);
    expect(city.className).toBe(company.className);
    // Required, so the label carries the star (2026-11-23).
    expect(container.querySelector('label[for="signup-city-state"]')?.textContent).toBe("City and state* (required)");
    // Picked from a list as it is typed (city-state-field.tsx).
    expect(city.getAttribute("role")).toBe("combobox");
  });

  it("hands what is typed to the business draft", () => {
    const { onChange, onClearError } = render({ askCityState: true });
    const city = container.querySelector<HTMLInputElement>("#signup-city-state")!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(city, "Miami, FL");
      city.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith({ cityState: "Miami, FL" });
    expect(onClearError).toHaveBeenCalledWith("cityState");
  });

  it("shows its error under the field", () => {
    render({ askCityState: true, error: "Please enter your city and state." });
    const city = container.querySelector<HTMLInputElement>("#signup-city-state")!;
    expect(city.getAttribute("aria-invalid")).toBe("true");
    expect(container.querySelector("#signup-city-state-error")?.textContent).toBe("Please enter your city and state.");
  });

  it("is not on the build screen's web-address panel", () => {
    render({});
    expect(container.querySelector("#signup-city-state")).toBeNull();
  });
});

describe("city and state: wherever the business is asked", () => {
  const account = strip(read("./steps/account-step.tsx"));

  it("belongs to the business page, after the business name", () => {
    expect(account).toMatch(/\["companyName", "cityState", "slug", "acceptedTerms"\]/);
  });

  it("is asked on both business screens and required on both", () => {
    expect(account.match(/^\s*askCityState\s*$/gm)).toHaveLength(2);
    expect(account.match(/cityState: fieldError\("cityState"\)/g)).toHaveLength(2);
    // One check, used by the page before the card AND the tenant-only screen.
    expect(account).toMatch(/const cityError = validateCityState\(tenant\.cityState\);/);
    // Both screens pass the address `repairSlug` rebuilt, if any (2026-11-22).
    expect(account).toMatch(/const found = tenantErrors\(repairedSlug\);/);
    // The business page checks it before it sends the form and the code.
    expect(account).toMatch(/page === BUSINESS_PAGE \? \(tenantErrors\(repairedSlug\) \?\? \{\}\)/);
  });
});

describe("city and state: to the server", () => {
  const provider = strip(read("./onboarding-provider.tsx"));

  it("goes to signup-begin with the answers", () => {
    const fn = provider.slice(provider.indexOf("const submitAccount"), provider.indexOf("const verifyEmailCode"));
    expect(fn).toMatch(/const cityState = normalizeCityState\(values\.cityState\);/);
    expect(fn).toMatch(/\.\.\.values\.attribution,\s*\.\.\.\(cityState \? \{ cityState \} : \{\}\),/);
    // And to PostHog on the submit event.
    expect(fn).toMatch(/city_state: cityState/);
  });

  it("goes to signup-attribution on its own from the business-only screen", () => {
    const fn = provider.slice(provider.indexOf("const submitTenantDetails"), provider.indexOf("const submitAttribution"));
    expect(fn).toMatch(/await signupSaveCityState\(cityState\)\.catch\(/);
    const api = strip(read("./onboarding-api.ts"));
    expect(api).toMatch(/callFunction<\{ success: true \}>\("signup-attribution", \{ cityState \}/);
  });

  it("never holds up a build for a signup that started without it", () => {
    const fn = provider.slice(provider.indexOf("function tenantValuesFrom"), provider.indexOf("function buildProvisionRequest"));
    expect(fn).not.toMatch(/cityState\)\) return null|!cityState\) return null/);
    expect(fn).toMatch(/\.\.\.\(cityState \? \{ cityState \} : \{\}\)/);
  });
});

describe("city and state: kept across a reload and the Google redirect", () => {
  afterEach(() => {
    clearLocalTenantDraft();
    clearPendingOauth();
  });

  const values = { companyName: "Harbor Car Rentals", slug: "harbor-car-rentals", acceptedTerms: true };

  it("rides in the local draft", () => {
    writeLocalTenantDraft({ ...values, cityState: "Tampa, FL" });
    expect(readLocalTenantDraft()).toEqual({ ...values, cityState: "Tampa, FL" });
    expect(draftToBusiness({ ...values, cityState: "Tampa, FL" }).cityState).toBe("Tampa, FL");
  });

  it("is not required of a draft saved before the question existed", () => {
    writeLocalTenantDraft(values);
    expect(readLocalTenantDraft()).toEqual(values);
    expect(draftToBusiness(values).cityState).toBe("");
  });

  it("crosses the Google redirect", () => {
    writePendingOauth("starter", { ...values, cityState: "Tampa, FL" }, null);
    expect(readPendingOauth()?.values.cityState).toBe("Tampa, FL");
    writePendingOauth("starter", { companyName: "", slug: "", acceptedTerms: false }, null);
    expect(readPendingOauth()?.values.cityState).toBe("");
  });
});

describe("city and state: the rehearsal signup", () => {
  afterEach(() => mockResetSignup());

  /** The fake server's record (mock-signup.ts STORE_KEY). */
  const store = () => JSON.parse(window.sessionStorage.getItem("d247.signupMock.state") ?? "null");

  it("keeps it from signup-begin, and from signup-attribution on its own", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const begin = mockFunction("signup-begin", {
        email: "sam@harbor.test", fullName: "Sam", planId: "starter", heardAbout: "instagram", cityState: "Tampa, FL",
      });
      await vi.advanceTimersByTimeAsync(1000);
      await begin;
      expect(store()?.cityState).toBe("Tampa, FL");

      const save = mockFunction("signup-attribution", { cityState: "Miami, FL" });
      await vi.advanceTimersByTimeAsync(1000);
      await save;
      expect(store()?.cityState).toBe("Miami, FL");
      // A city-only save leaves the earlier answer alone.
      expect(store()?.heardAbout).toBe("instagram");
    } finally {
      vi.useRealTimers();
    }
  });
});
