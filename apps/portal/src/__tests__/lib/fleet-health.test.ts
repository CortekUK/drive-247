/**
 * Fleet Health — the shared contract in `types/fleet-health.ts`.
 *
 * Everything here is a DRIFT GUARD. None of it is arithmetic that could be wrong
 * today; all of it is a pair of files that no compiler checks against each other,
 * where a one-word edit silently changes what an operator is told about a car.
 *
 * Three failures this suite exists to catch:
 *
 *  1. A new `VehicleHealthStatus` added to the union but not to LABEL / CLASS /
 *     RANK. TypeScript catches the missing key at build time — but the portal
 *     builds with `ignoreBuildErrors: true`, so it would ship as `undefined`
 *     rendering as an empty chip with rank `NaN`, which sorts a broken vehicle
 *     to an arbitrary position. The union is therefore re-read out of the source
 *     text and compared against the runtime key sets.
 *
 *  2. `SERVICE_TYPES` drifting from the options in add-service-record-dialog.tsx.
 *     A rule matches its completed work by `service_type` string equality, so a
 *     rename on either side makes every rule read "no service history for this
 *     item" — the single most likely way this feature breaks without anyone
 *     noticing, because the screen still renders perfectly.
 *
 *  3. `isVehicleSeeded` regressing to a truthiness check. A brand-new vehicle
 *     legitimately reads 0, and `if (mileage)` is exactly the bug that already
 *     exists in the key-handover writer.
 *
 * Nothing renders. The portal pins React 18.3.1 while the monorepo root hoists
 * React 19, so no test in this workspace may import a component — see the header
 * of `helpers/source.ts`. Everything below is either a direct import of a
 * dependency-free module or a textual read of a source file.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import {
  HEALTH_STATUS_CLASS,
  HEALTH_STATUS_LABEL,
  HEALTH_STATUS_RANK,
  JOB_PRIORITY_LABEL,
  JOB_STATUS_LABEL,
  SERVICE_TYPES,
  confidenceLabel,
  isVehicleSeeded,
  type BurnConfidence,
  type VehicleHealthStatus,
} from "@/types/fleet-health";
import { readPortalSource, liftDeclaration, compile } from "../helpers/edge-source";

const PORTAL_SRC = resolve(__dirname, "../..");

const typesSource = readPortalSource("types/fleet-health.ts");
const dialogSource = readPortalSource("components/vehicles/add-service-record-dialog.tsx");
const rulesHook = readPortalSource("hooks/use-maintenance-rules.ts");

/**
 * The string members of a `export type X = "a" | "b";` declaration, read out of
 * the source. This is the only way to enumerate a TS union at runtime, and it is
 * what turns "did you update all three records?" into a test rather than a
 * build-time error the portal's tsconfig is configured to ignore.
 */
function unionMembers(source: string, typeName: string): string[] {
  const m = source.match(new RegExp(`export type ${typeName}\\s*=([\\s\\S]*?);`));
  if (!m) {
    throw new Error(
      `Could not find 'export type ${typeName}' — it was renamed or deleted. ` +
        "Update this test to match the code it guards rather than deleting the assertion.",
    );
  }
  const members = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  if (members.length === 0) throw new Error(`${typeName} has no string members`);
  return members;
}

/** Every string/template literal in a file — i.e. every candidate piece of copy. */
function stringLiterals(source: string, tsx = false): string[] {
  const sf = ts.createSourceFile(
    tsx ? "scan.tsx" : "scan.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    tsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const out: string[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) out.push(n.text);
    else if (ts.isTemplateExpression(n)) {
      out.push(n.head.text, ...n.templateSpans.map((s) => s.literal.text));
    } else if (ts.isJsxText(n)) out.push(n.text);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

describe("VehicleHealthStatus — every status is fully described", () => {
  const declared = unionMembers(typesSource, "VehicleHealthStatus");

  it("has the six statuses the feature is built around", () => {
    expect([...declared].sort()).toEqual([
      "attention",
      "not_road_legal",
      "off_road",
      "ok",
      "overdue",
      "unknown",
    ]);
  });

  it("has a label, a chip class and a rank for every declared status", () => {
    // Adding a status without touching these three records ships an empty chip
    // and a NaN sort key. The build will not stop it — this does.
    for (const status of declared) {
      expect(HEALTH_STATUS_LABEL, `HEALTH_STATUS_LABEL.${status}`).toHaveProperty(status);
      expect(HEALTH_STATUS_CLASS, `HEALTH_STATUS_CLASS.${status}`).toHaveProperty(status);
      expect(HEALTH_STATUS_RANK, `HEALTH_STATUS_RANK.${status}`).toHaveProperty(status);
    }
    expect(Object.keys(HEALTH_STATUS_LABEL).sort()).toEqual(declared.slice().sort());
    expect(Object.keys(HEALTH_STATUS_CLASS).sort()).toEqual(declared.slice().sort());
    expect(Object.keys(HEALTH_STATUS_RANK).sort()).toEqual(declared.slice().sort());
  });

  it("gives every status a distinct, non-empty label", () => {
    const labels = Object.values(HEALTH_STATUS_LABEL);
    expect(labels.every((l) => l.trim().length > 0)).toBe(true);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("HEALTH_STATUS_RANK — the urgency order", () => {
  const byRank = (Object.keys(HEALTH_STATUS_RANK) as VehicleHealthStatus[]).sort(
    (a, b) => HEALTH_STATUS_RANK[a] - HEALTH_STATUS_RANK[b],
  );

  it("orders not_road_legal < overdue < attention < off_road < unknown < ok", () => {
    expect(byRank).toEqual([
      "not_road_legal",
      "overdue",
      "attention",
      "off_road",
      "unknown",
      "ok",
    ]);
  });

  it("gives every status a distinct rank, so the order is total", () => {
    const ranks = Object.values(HEALTH_STATUS_RANK);
    expect(new Set(ranks).size).toBe(ranks.length);
  });

  it("ranks unknown ABOVE ok", () => {
    // Product rule: `unknown` is a first-class status, not a soft "fine". If it
    // ranked below `ok` it would sit under the entire healthy fleet, which is
    // indistinguishable from not surfacing it at all — the missing odometer
    // reading is precisely the thing the operator has to act on.
    expect(HEALTH_STATUS_RANK.unknown).toBeLessThan(HEALTH_STATUS_RANK.ok);
  });

  it("ranks the two blocking statuses above everything actionable", () => {
    expect(HEALTH_STATUS_RANK.not_road_legal).toBeLessThan(HEALTH_STATUS_RANK.overdue);
    expect(HEALTH_STATUS_RANK.overdue).toBeLessThan(HEALTH_STATUS_RANK.attention);
  });
});

describe("unknown never renders as OK", () => {
  it("does not label unknown as OK, or as anything that reads as 'not due'", () => {
    expect(HEALTH_STATUS_LABEL.unknown).toBe("Unknown");
    expect(HEALTH_STATUS_LABEL.unknown).not.toBe(HEALTH_STATUS_LABEL.ok);
    expect(HEALTH_STATUS_LABEL.unknown).not.toMatch(/\b(ok|fine|good|no(t|thing) due|clear)\b/i);
  });

  it("does not give unknown the healthy chip colour", () => {
    // Colour is the only thing read at a glance in a 22-row table. Green on an
    // unknown row is a claim the data does not support.
    expect(HEALTH_STATUS_CLASS.unknown).not.toBe(HEALTH_STATUS_CLASS.ok);
    for (const status of ["unknown", "attention", "overdue", "not_road_legal", "off_road"] as const) {
      expect(HEALTH_STATUS_CLASS[status], `${status} chip`).not.toMatch(/green/);
    }
    expect(HEALTH_STATUS_CLASS.ok).toMatch(/green/);
  });

  it("carries an optional `hint` on HealthReason for the missing input", () => {
    // `unknown` is only defensible if the row can say WHAT is missing. Without a
    // place to put that sentence, the status is just a shrug.
    expect(typesSource).toMatch(/hint\?:\s*string/);
  });
});

describe("isVehicleSeeded — a literal 0 is a reading", () => {
  it("treats 0 miles as seeded", () => {
    // A brand-new vehicle reads 0. The existing key-handover writer guards with
    // `if (mileage)`, so 0 is falsy and the reading is dropped along with the
    // excess-mileage calculation. This is that exact class of bug, and the whole
    // setup gate (`shouldShowSetup`) is computed from this predicate.
    expect(isVehicleSeeded({ current_mileage: 0 })).toBe(true);
  });

  it("treats any real reading as seeded", () => {
    expect(isVehicleSeeded({ current_mileage: 1 })).toBe(true);
    expect(isVehicleSeeded({ current_mileage: 128_400 })).toBe(true);
  });

  it("treats null and undefined as not seeded", () => {
    expect(isVehicleSeeded({ current_mileage: null })).toBe(false);
    expect(isVehicleSeeded({} as { current_mileage: number | null })).toBe(false);
    expect(
      isVehicleSeeded({ current_mileage: undefined } as unknown as { current_mileage: number | null }),
    ).toBe(false);
  });

  it("is a null check, not a truthiness check", () => {
    // Pins the implementation shape as well as the behaviour: `!v.current_mileage`
    // passes none of the assertions above, but a future `Number(x) > 0` would
    // pass them all except this one.
    const decl = liftDeclaration(typesSource, "isVehicleSeeded");
    expect(decl).not.toMatch(/!\s*v\.current_mileage/);
    expect(decl).toMatch(/!==\s*null/);
  });
});

describe("confidenceLabel — a projection states how much to trust it", () => {
  const declared = unionMembers(typesSource, "BurnConfidence") as BurnConfidence[];

  it("covers every declared confidence tier with non-empty copy", () => {
    for (const tier of declared) {
      expect(confidenceLabel(tier), tier).toBeTruthy();
      expect(confidenceLabel(tier).trim().length, tier).toBeGreaterThan(0);
    }
  });

  it("gives the three data-bearing tiers distinct sentences", () => {
    // If two tiers read identically the operator cannot tell an estimate built
    // from this car's own readings from one built off the platform median —
    // which are materially different claims about the same due date.
    const labels = ["observed", "tenant_median", "platform_median"].map((t) =>
      confidenceLabel(t as BurnConfidence),
    );
    expect(new Set(labels).size).toBe(3);
  });

  it("hedges the two estimated tiers and does not hedge the observed one", () => {
    expect(confidenceLabel("observed")).toMatch(/this vehicle's own/i);
    expect(confidenceLabel("observed")).not.toMatch(/estimat|rough/i);
    expect(confidenceLabel("tenant_median")).toMatch(/estimat/i);
    expect(confidenceLabel("platform_median")).toMatch(/estimat|rough/i);
  });

  it("falls back sanely for null, undefined and an unrecognised value", () => {
    const fallback = confidenceLabel(null);
    expect(fallback).toBeTruthy();
    expect(confidenceLabel(undefined)).toBe(fallback);
    expect(confidenceLabel("none")).toBe(fallback);
    // A tier added to the union but not to the switch must not return "" or
    // crash — it degrades to "no usage data", which understates rather than
    // overstates.
    expect(confidenceLabel("telemetry" as BurnConfidence)).toBe(fallback);
  });
});

describe("SERVICE_TYPES stays in sync with the service-record dialog", () => {
  // Everything the dialog can write into service_records.service_type.
  const optionBlock = dialogSource.slice(
    dialogSource.indexOf('name="service_type"'),
    dialogSource.indexOf('name="mileage"'),
  );
  const dialogOptions = [...optionBlock.matchAll(/<SelectItem value="([^"]+)"/g)].map((m) => m[1]);

  it("actually found the dialog's service-type options", () => {
    // Guards the guard: if the dialog is restructured and this slice comes back
    // empty, every assertion below would pass vacuously.
    expect(dialogOptions.length).toBeGreaterThan(5);
  });

  it("has every SERVICE_TYPES entry available in the dialog", () => {
    // A rule authored against a type nobody can log will never see a completed
    // service, so it reports "no service history" forever.
    for (const type of SERVICE_TYPES) {
      expect(dialogOptions, `SERVICE_TYPES entry '${type}' has no dialog option`).toContain(type);
    }
  });

  it("has every dialog option present in SERVICE_TYPES", () => {
    // The other direction: work logged under a type the rules constant does not
    // know about can never be matched back to a rule.
    for (const option of dialogOptions) {
      expect(
        SERVICE_TYPES as readonly string[],
        `dialog option '${option}' is missing from SERVICE_TYPES`,
      ).toContain(option);
    }
  });

  it("has no duplicate or blank service types", () => {
    expect(new Set(SERVICE_TYPES).size).toBe(SERVICE_TYPES.length);
    expect(SERVICE_TYPES.every((t) => t.trim() === t && t.length > 0)).toBe(true);
  });

  it("seeds default schedules only with service types that exist", () => {
    // `seedDefaults` is the one-tap starting point, so a typo here would hand a
    // tenant five rules that can never match anything on their very first
    // interaction with the feature.
    const defaults = compile<Array<{ name: string; service_type: string }>>(
      [liftDeclaration(rulesHook, "defaults")],
      "defaults",
    );
    expect(defaults.length).toBeGreaterThan(0);
    for (const d of defaults) {
      expect(
        SERVICE_TYPES as readonly string[],
        `default schedule '${d.name}' uses unknown service_type '${d.service_type}'`,
      ).toContain(d.service_type);
    }
  });

  it("keeps the British/American spelling split that actually ships", () => {
    // The rule is named "Tyre Rotation" but matches service_type "Tire Rotation".
    // That looks like a bug and has been "fixed" before; it is not. The dialog
    // writes the American spelling, so the rule must match the American spelling
    // while the operator-facing name stays British.
    const defaults = compile<Array<{ name: string; service_type: string }>>(
      [liftDeclaration(rulesHook, "defaults")],
      "defaults",
    );
    const tyre = defaults.find((d) => d.name === "Tyre Rotation");
    expect(tyre?.service_type).toBe("Tire Rotation");
    expect(dialogOptions).toContain("Tire Rotation");
  });
});

describe("job vocabularies are complete", () => {
  it("labels every JobStatus", () => {
    const declared = unionMembers(typesSource, "JobStatus");
    expect(Object.keys(JOB_STATUS_LABEL).sort()).toEqual(declared.slice().sort());
    expect(Object.values(JOB_STATUS_LABEL).every((l) => l.trim().length > 0)).toBe(true);
  });

  it("labels every JobPriority", () => {
    const declared = unionMembers(typesSource, "JobPriority");
    expect(Object.keys(JOB_PRIORITY_LABEL).sort()).toEqual(declared.slice().sort());
    expect(Object.values(JOB_PRIORITY_LABEL).every((l) => l.trim().length > 0)).toBe(true);
  });

  it("closes a job's lifecycle with terminal states the open-jobs filter knows about", () => {
    // `useMaintenanceJobs` filters open work with
    // `.not("status", "in", "(completed,cancelled)")`. If a terminal state were
    // renamed or added, finished jobs would keep counting as open forever.
    const jobsHook = readPortalSource("hooks/use-maintenance-jobs.ts");
    expect(jobsHook).toContain('"(completed,cancelled)"');
    expect(JOB_STATUS_LABEL).toHaveProperty("completed");
    expect(JOB_STATUS_LABEL).toHaveProperty("cancelled");
  });
});

describe("the feature never issues a roadworthiness verdict", () => {
  /**
   * Health here is an operational log — "this interval elapsed", "this date
   * passed". It is not an inspection, and the product must never compress that
   * into a binary "safe". Saying a vehicle is safe is a claim about its physical
   * condition that no data in this system supports, and it is a claim an
   * operator could be held to.
   */
  const SAFETY_CLAIM = /\b(safe|unsafe|roadworthy|road-worthy|fit to drive|safe to (rent|drive))\b/i;

  const contractFiles = [
    "types/fleet-health.ts",
    "hooks/use-fleet-health.ts",
    "hooks/use-maintenance-jobs.ts",
    "hooks/use-vehicle-odometer.ts",
    "hooks/use-maintenance-rules.ts",
  ];

  /** Fleet Health UI, if it has landed yet — the directories are optional. */
  function discoverUi(): string[] {
    const dirs = [
      "app/(dashboard)/fleet-health",
      "components/fleet-health",
      "client-schemas/fleet-health",
    ];
    const out: string[] = [];
    const walk = (abs: string, rel: string): void => {
      for (const entry of readdirSync(abs)) {
        const childAbs = resolve(abs, entry);
        const childRel = `${rel}/${entry}`;
        if (statSync(childAbs).isDirectory()) walk(childAbs, childRel);
        else if (/\.tsx?$/.test(entry)) out.push(childRel);
      }
    };
    for (const dir of dirs) {
      const abs = resolve(PORTAL_SRC, dir);
      if (existsSync(abs)) walk(abs, dir);
    }
    return out;
  }

  it("has no safety verdict in any string the operator could be shown", () => {
    for (const file of [...contractFiles, ...discoverUi()]) {
      const literals = stringLiterals(readPortalSource(file), file.endsWith(".tsx"));
      for (const literal of literals) {
        expect(literal, `${file}: "${literal}"`).not.toMatch(SAFETY_CLAIM);
      }
    }
  });

  it("states its statuses as operational facts, not verdicts", () => {
    // "Not road legal" is a statement about paperwork (MOT/tax expiry), which the
    // system does know. It is deliberately not "unsafe".
    expect(HEALTH_STATUS_LABEL.not_road_legal).toBe("Not road legal");
    expect(Object.values(HEALTH_STATUS_LABEL).join(" ")).not.toMatch(SAFETY_CLAIM);
  });
});
