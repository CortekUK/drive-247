/**
 * Agreements v2 in the rental flow: the row's idea of "the template this rental
 * sends" must be /api/esign's idea, exactly, or the row names one contract and
 * the customer is sent another.
 *
 * The route's own decisions are LIFTED out of route.ts and executed
 * (helpers/edge-source.ts), so this compares the row's helpers with the code
 * that actually runs on a send, not with a paraphrase of it:
 *   - `templateCategory`   which category the send is for;
 *   - `agreementTypeLabel` the banner drawn across the top of the PDF;
 * and the route's two-step query (the category's active row, else the active
 * standard row) against `defaultTemplateFor`.
 */
import { describe, expect, it } from "vitest";
import { compileExpression, liftDeclaration, readPortalSource } from "../helpers/edge-source";
import {
  agreementBannerV2,
  rentalTemplateCategoryV2,
  templateIdToSendV2,
  type RentalAgreementTypeV2,
} from "@/components/rentals-v2/rental-detail/agreement-template-row-v2";
import { defaultTemplateFor } from "@/hooks/use-agreement-templates-v2";
import type { AgreementTemplateCategoryV2, AgreementTemplateV2 } from "@/lib/agreements-v2/types";

const ROUTE = readPortalSource("app/api/esign/route.ts");

const routeCategory = compileExpression<(explicit: unknown, rental: unknown, installment: unknown) => string>(
  ["explicit", "rental", "installment"],
  [liftDeclaration(ROUTE, "templateCategory")],
  "templateCategory"
);

const routeBanner = compileExpression<(body: unknown) => string>(
  ["body"],
  [liftDeclaration(ROUTE, "isExtensionAgreement"), liftDeclaration(ROUTE, "agreementTypeLabel")],
  "agreementTypeLabel"
);

const TYPES: (RentalAgreementTypeV2 | undefined)[] = [undefined, "original", "payg", "installment", "extension"];
const BOOLS = [false, true];

describe("the category matches route.ts templateCategory", () => {
  const cases = TYPES.flatMap((agreementType) =>
    BOOLS.flatMap((hasInstallmentPlan) =>
      BOOLS.flatMap((hasLiveInstallmentPlan) =>
        BOOLS.map((isPayAsYouGo) => ({ agreementType, hasInstallmentPlan, hasLiveInstallmentPlan, isPayAsYouGo }))
      )
    )
  );

  it.each(cases)("%o", (input) => {
    const rental = { has_installment_plan: input.hasInstallmentPlan, is_pay_as_you_go: input.isPayAsYouGo };
    const installment = input.hasLiveInstallmentPlan ? { plan_type: "weekly" } : null;
    expect(rentalTemplateCategoryV2(input)).toBe(routeCategory(input.agreementType, rental, installment));
  });

  it("the matrix covers every category the route can pick", () => {
    const seen = new Set(cases.map((c) => rentalTemplateCategoryV2(c)));
    expect([...seen].sort()).toEqual(["extension", "installment", "payg", "standard"]);
  });
});

describe("the banner matches route.ts agreementTypeLabel", () => {
  it.each([
    [undefined, undefined],
    ["original", undefined],
    ["payg", undefined],
    ["installment", undefined],
    ["extension", 2],
    ["extension", undefined],
  ] as const)("%s #%s", (agreementType, extensionNumber) => {
    expect(agreementBannerV2(agreementType, extensionNumber)).toBe(routeBanner({ agreementType, extensionNumber }));
  });

  it("the stage's own send ('original') is the ORIGINAL RENTAL AGREEMENT banner", () => {
    expect(agreementBannerV2("original")).toBe("ORIGINAL RENTAL AGREEMENT");
  });
});

/** route.ts: `.eq(category).eq('is_active', true).single()`, then the same for 'standard'. */
function routeQuery(templates: AgreementTemplateV2[], category: AgreementTemplateCategoryV2) {
  const active = (c: AgreementTemplateCategoryV2) => {
    const rows = templates.filter((t) => t.category === c && t.isDefault);
    return rows.length === 1 ? rows[0] : null; // .single(): exactly one row, else no data
  };
  return active(category) ?? (category !== "standard" ? active("standard") : null);
}

const t = (id: string, category: AgreementTemplateCategoryV2, isDefault: boolean): AgreementTemplateV2 => ({
  id,
  name: id,
  content: `<p>${id}</p>`,
  category,
  isDefault,
  updatedAt: null,
});

describe("defaultTemplateFor picks the row the route's query returns", () => {
  const SETS: Record<string, AgreementTemplateV2[]> = {
    "every category has a default": [
      t("std", "standard", true),
      t("std-2", "standard", false),
      t("payg", "payg", true),
      t("inst", "installment", true),
      t("ext", "extension", true),
    ],
    "only standard has a default": [t("std", "standard", true), t("payg", "payg", false), t("inst", "installment", false)],
    "no default anywhere": [t("std", "standard", false), t("payg", "payg", false)],
    "a category default but no standard default": [t("std", "standard", false), t("payg", "payg", true)],
    "no templates": [],
  };
  const CATEGORIES: AgreementTemplateCategoryV2[] = ["standard", "payg", "installment", "extension"];

  for (const [label, templates] of Object.entries(SETS)) {
    it.each(CATEGORIES)(`${label}: %s`, (category) => {
      expect(defaultTemplateFor(templates, category)?.id ?? null).toBe(routeQuery(templates, category)?.id ?? null);
    });
  }
});

describe("templateIdToSendV2", () => {
  it("names the template only when it differs from the route's own pick", () => {
    expect(templateIdToSendV2("a", "a")).toBeUndefined();
    expect(templateIdToSendV2(null, "a")).toBeUndefined();
    expect(templateIdToSendV2(null, null)).toBeUndefined();
    expect(templateIdToSendV2("b", "a")).toBe("b");
    // No template of its own would be sent (the built-in text): a pick is a change.
    expect(templateIdToSendV2("b", null)).toBe("b");
  });
});
