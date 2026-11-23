#!/usr/bin/env node
/**
 * nightly.mjs — run every database eval and produce one report.
 *
 * Staging drifts quietly: prod gains a column, nobody touches staging, and three
 * months later it is thousands of differences behind. Run this on a schedule and
 * drift is caught the next morning, when it is still one line of SQL to fix.
 *
 *   SUPABASE_ACCESS_TOKEN=… node evals/environments/database/nightly.mjs
 *
 *   --with-alarm       also run alarm-test (it writes to staging, so it is opt-in)
 *   --skip-blueprint   skip the pg_dump comparison (use where pg_dump 17 is missing)
 *
 * Set ALERT_WEBHOOK_URL to a Slack-style incoming webhook to be told when a run fails.
 * Exit code 0 only when everything passed.
 */
import { flag, blankResult, applyExceptions, report, requireSetup, PROD_REF, TARGET } from "./lib.mjs";
import { runChecks } from "./db-eval.mjs";
import { runBlindSpots } from "./blind-spots.mjs";
import { runSettingsCheck } from "./settings-check.mjs";
import { runDoorTest } from "./door-test.mjs";
import { runBlueprintDiff } from "./blueprint-diff.mjs";
import { runAlarmTest } from "./alarm-test.mjs";

requireSetup();

const steps = [
  ["db-eval", () => runChecks()],
  ["blind-spots", runBlindSpots],
  ["settings-check", runSettingsCheck],
  ["door-test", runDoorTest],
  ...(flag("skip-blueprint") ? [] : [["blueprint-diff", runBlueprintDiff]]),
  ...(flag("with-alarm") ? [["alarm-test", () => runAlarmTest()]] : []),
];

const results = [];
for (const [name, run] of steps) {
  console.log(`running ${name} ...`);
  try {
    const part = await run();
    // alarm-test reuses db-eval's check names; prefix them so the two cannot be confused.
    results.push(...(name === "alarm-test" ? part.map((r) => ({ ...r, name: `alarm: ${r.name}` })) : part));
  } catch (e) {
    // A step that crashes is a failure, never a silent skip.
    const r = blankResult(`${name} (crashed)`, "safety");
    r.problems.push(String(e.message).slice(0, 300));
    results.push(r);
  }
}

const { ok, summary, file } = await report("full", applyExceptions(results), { show: 4 });

if (!ok && process.env.ALERT_WEBHOOK_URL) {
  await fetch(process.env.ALERT_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: `Drive247 staging no longer matches prod.\n${summary}\nprod ${PROD_REF} vs staging ${TARGET}\nReport: ${file}` }),
  }).catch((e) => console.error(`alert not sent: ${e.message}`));
}
process.exit(ok ? 0 : 1);
