/**
 * Agreements v2: what the editor's Variables tab says about each variable
 * (build-spec D10, and the 12:45 whiteboard: the description on the first
 * line, "e.g.: …" on the second).
 *
 * Everything comes from `TEMPLATE_VARIABLES` (lib/template-variables.ts), which
 * already carries a label, a description and a sample for all of them. Nothing
 * is re-worded here, so the tooltip and the catalogue cannot drift apart.
 */

import { TEMPLATE_VARIABLES, type TemplateVariable } from "@/lib/template-variables";

export type VariableCategoryV2 = TemplateVariable["category"];

/** The order the tab lists them in: what an individual agreement can fill first. */
export const VARIABLE_CATEGORY_ORDER_V2: readonly VariableCategoryV2[] = [
  "company",
  "customer",
  "rental",
  "vehicle",
  "payment",
  "extension",
  "additional_driver",
];

export const VARIABLE_CATEGORY_LABEL_V2: Record<VariableCategoryV2, string> = {
  company: "Company",
  customer: "Customer",
  rental: "Rental",
  vehicle: "Vehicle",
  payment: "Payments and installments",
  extension: "Extension",
  additional_driver: "Additional drivers",
};

/** Said instead of a blank example (the catalogue leaves a few samples empty). */
export const VARIABLE_EXAMPLE_FALLBACK = "filled in from the rental";

/** The two tooltip lines for a variable. Never blank. */
export function variableTooltipLines(variable: Pick<TemplateVariable, "description" | "sample">): {
  description: string;
  example: string;
} {
  const sample = (variable.sample ?? "").trim();
  return {
    description: variable.description,
    example: `e.g.: ${sample || VARIABLE_EXAMPLE_FALLBACK}`,
  };
}

/** The token a variable is inserted as. */
export const variableToken = (key: string) => `{{${key}}}`;

export interface VariableGroupV2 {
  category: VariableCategoryV2;
  label: string;
  variables: TemplateVariable[];
}

/**
 * The catalogue grouped for the tab, filtered by `query` on the label, the key
 * and the description (case-insensitive). Empty groups are left out.
 */
export function groupVariablesV2(query = "", variables: readonly TemplateVariable[] = TEMPLATE_VARIABLES): VariableGroupV2[] {
  const needle = query.trim().toLowerCase().replace(/^\{+|\}+$/g, "");
  const matches = (v: TemplateVariable) =>
    !needle ||
    v.label.toLowerCase().includes(needle) ||
    v.key.toLowerCase().includes(needle) ||
    v.description.toLowerCase().includes(needle);
  return VARIABLE_CATEGORY_ORDER_V2.map((category) => ({
    category,
    label: VARIABLE_CATEGORY_LABEL_V2[category],
    variables: variables.filter((v) => v.category === category && matches(v)),
  })).filter((group) => group.variables.length > 0);
}
