// =============================================================================
// integrations/bonzah — bonzah-grade-quiz. CONTRACT + MATHS.
//
// "FUNCTIONAL test hai, aur phir MATHS wale test hain … maths wale test bade
// important hain." This function is the second place in the Bonzah surface
// where arithmetic decides an outcome, and unlike the premium it decides a
// PERMISSION: 80% of the active questions right, and the operator may submit
// their Bonzah application. Below it, they cannot.
//
// WHY THE MATHS NEEDS ITS OWN CASES:
//   * `score / total >= 0.8` is a >= on a floating-point quotient. 4/5, 8/10,
//     12/15 and 24/30 all have to land EXACTLY on the threshold and pass; a
//     `>` instead of `>=`, or a comparison against a re-typed 0.8, silently
//     fails every operator who scored precisely 80%.
//   * `total` is the number of ACTIVE questions, so a four-question quiz needs
//     four right (3/4 = 0.75). The pass mark moves when the question bank does.
//   * `given === q.correct_option_index` is STRICT. The answer index arrives
//     over JSON; if a caller ever sends "2" instead of 2 every answer is wrong
//     and every operator fails with a perfect paper.
//
// THE RULE THIS FILE FOLLOWS (from rate-card.ts, applied to the scoring):
//   EXPECTED = literals, worked out by hand and typed into this file.
//   ACTUAL   = the shipped grading pass, LIFTED OUT OF THE SOURCE AND RUN.
// A test that recomputed the score with `score / total >= PASS_RATIO` would be
// comparing the code to itself.
// =============================================================================

import { describe, expect, it } from "vitest";
import { classifyLive, liveCall, liveStatus } from "../../helpers/live-call";
import { liftEdgeExpression, readNumericConst } from "./rate-card";
import {
  assertLooseContract,
  fixtureOrNull,
  liftStatements,
  readRepoFile,
  srcOf,
} from "./servicing";

const FN = "bonzah-grade-quiz";
const src = () => srcOf(FN);

const HOOK = "apps/portal/src/hooks/use-bonzah-quiz.ts";
const UI = "apps/portal/src/components/settings/bonzah-onboarding/steps/step-9-quiz.tsx";

// ---------------------------------------------------------------------------
// The shipped arithmetic, lifted.
// ---------------------------------------------------------------------------

/** `const PASS_RATIO = 0.8` as a number. */
const PASS_RATIO = readNumericConst(FN, "PASS_RATIO");

/**
 * The whole grading pass — total, score, the results map and the verdict —
 * taken verbatim from the handler and made callable. Nothing below re-types any
 * of it: `let score = 0`, the strict comparison and the `>=` are the shipped
 * ones.
 */
const gradingPass = liftStatements<
  (
    questions: { id: string; correct_option_index: number }[],
    answers: Record<string, unknown>,
    passRatio: number,
  ) => { score: number; total: number; passed: boolean; results: Record<string, boolean> }
>({
  fn: FN,
  what: "the grading pass (`const total = questions.length` … `const passed = …`)",
  pattern: /(const total = questions\.length[\s\S]*?const passed = [^;\n]+)/,
  params: ["questions", "answers", "PASS_RATIO"],
  epilogue: "return { score, total, passed, results };",
});

/** The verdict alone, so the threshold can be tabulated without fixtures. */
const verdict = liftEdgeExpression<(score: number, total: number, passRatio: number) => boolean>(
  FN,
  "the pass/fail expression `const passed = …`",
  /\bconst\s+passed\s*=\s*([^;\n]+)/,
  ["score", "total", "PASS_RATIO"],
);

/** n questions whose correct answer is always index 1. Fixtures, not arithmetic. */
const questionBank = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `q${i + 1}`, correct_option_index: 1 }));

describe("bonzah/grade-quiz — the pass mark (Layer 3)", () => {
  it("is 80%, and the screen says 80%", () => {
    // Two hand-typed literals, one on each side of the product. The constant is
    // read out of the function; the promise is read out of the UI. They are the
    // same rule written twice, in two languages, and they can drift.
    expect(
      PASS_RATIO,
      "PASS_RATIO changed. Every operator who has already passed did so under the old " +
        "number, and the screen still tells the next one what the old number was.",
    ).toBe(0.8);
    expect(
      readRepoFile(UI),
      `${UI} no longer says "80%". The quiz screen states the pass mark to the operator ` +
        "before they start; if the constant moved, this is the copy that has to move with it.",
    ).toContain("80%");
  });

  it("passes EXACTLY 80% — the boundary, on four different quiz sizes", () => {
    // The `>=`. Each of these quotients is exactly the double 0.8, so a `>`
    // would fail all four and nobody scoring precisely the pass mark would pass.
    for (const [score, total] of [
      [4, 5],
      [8, 10],
      [12, 15],
      [16, 20],
      [24, 30],
    ] as const) {
      expect(
        verdict.call(score, total, PASS_RATIO),
        `${score}/${total} is exactly 80% and must PASS. It does not, which means the ` +
          "comparison became `>` — or the threshold is no longer a value the quotient can " +
          "reach exactly. Every operator who scores the advertised pass mark is being " +
          "failed.",
      ).toBe(true);
    }
  });

  it("fails the marks just under it", () => {
    // Hand-worked: 3/5 = 0.6, 7/10 = 0.7, 11/15 = 0.733…, 15/20 = 0.75.
    for (const [score, total] of [
      [3, 5],
      [7, 10],
      [11, 15],
      [15, 20],
    ] as const) {
      expect(
        verdict.call(score, total, PASS_RATIO),
        `${score}/${total} is below 80% and must FAIL. Passing it means the threshold has ` +
          "been lowered — the Bonzah partner is then reviewing applications from operators " +
          "who did not pass the training.",
      ).toBe(false);
    }
  });

  it("a four-question quiz needs all four right", () => {
    // 3/4 = 0.75, which is under the bar. Worth pinning as its own case: the
    // effective pass mark is a step function of the question count, so shrinking
    // the active question bank silently makes the quiz harder.
    expect(verdict.call(3, 4, PASS_RATIO), "3 out of 4 is 75% and must not pass.").toBe(false);
    expect(verdict.call(4, 4, PASS_RATIO), "4 out of 4 must pass.").toBe(true);
    // And on seven, six is enough (85.7%) while five is not (71.4%).
    expect(verdict.call(6, 7, PASS_RATIO)).toBe(true);
    expect(verdict.call(5, 7, PASS_RATIO)).toBe(false);
    // A single-question quiz is all-or-nothing.
    expect(verdict.call(1, 1, PASS_RATIO)).toBe(true);
    expect(verdict.call(0, 1, PASS_RATIO)).toBe(false);
  });
});

describe("bonzah/grade-quiz — the scoring pass, executed", () => {
  it("scores four of five and marks the fifth wrong", () => {
    const questions = questionBank(5);
    // q1..q4 correct (index 1), q5 wrong (index 0).
    const answers = { q1: 1, q2: 1, q3: 1, q4: 1, q5: 0 };
    expect(
      gradingPass.call(questions, answers, PASS_RATIO),
      "The shipped grading pass no longer scores 4/5 for four correct answers out of five.",
    ).toEqual({
      score: 4,
      total: 5,
      passed: true,
      results: { q1: true, q2: true, q3: true, q4: true, q5: false },
    });
  });

  it("counts an unanswered question as wrong rather than skipping it", () => {
    // `answers[q.id]` is undefined, `undefined === 1` is false. The alternative
    // — treating a missing answer as correct — would let an empty submission
    // pass, and the client-side "all answered" check is not a security control.
    const result = gradingPass.call(questionBank(5), { q1: 1, q2: 1, q3: 1, q4: 1 }, PASS_RATIO);
    expect(result, "An unanswered question is no longer counted as wrong.").toEqual({
      score: 4,
      total: 5,
      passed: true,
      results: { q1: true, q2: true, q3: true, q4: true, q5: false },
    });

    const empty = gradingPass.call(questionBank(5), {}, PASS_RATIO);
    expect(
      empty,
      "An EMPTY answers object no longer scores zero. `{}` is what the function falls back " +
        "to when the body is unparseable, so this is the shape a malformed request grades as.",
    ).toEqual({
      score: 0,
      total: 5,
      passed: false,
      results: { q1: false, q2: false, q3: false, q4: false, q5: false },
    });
  });

  it("ignores answers to questions that are not in the active set", () => {
    // The loop walks QUESTIONS, not answers. A caller cannot inflate the score
    // by inventing question ids, and a retired question in the payload does not
    // change the total.
    const result = gradingPass.call(
      questionBank(2),
      { q1: 1, q2: 1, "not-a-question": 1, "another-invented-id": 1 },
      PASS_RATIO,
    );
    expect(
      result,
      "Answers for unknown question ids are affecting the result. The score must be " +
        "bounded by the number of active questions.",
    ).toEqual({ score: 2, total: 2, passed: true, results: { q1: true, q2: true } });
  });

  it("compares STRICTLY, so a stringified index scores zero — and the caller knows it", () => {
    // "1" === 1 is false. This is only safe because the UI coerces with
    // `Number(v)` before storing the answer, so both sides are asserted: the
    // strictness here, and the coercion there. Either one moving alone fails
    // every operator with a perfect paper and no explanation on screen.
    const stringy = gradingPass.call(questionBank(3), { q1: "1", q2: "1", q3: "1" }, PASS_RATIO);
    expect(
      stringy,
      "The comparison stopped being strict. That looks like a kindness, but the correct " +
        "answer comes from an integer column and `==` would also make `true == 1` grade as " +
        "correct — read the coercion rules before relaxing this.",
    ).toEqual({ score: 0, total: 3, passed: false, results: { q1: false, q2: false, q3: false } });

    expect(
      readRepoFile(UI),
      `${UI} no longer coerces the selected option with Number(). The radio group's value ` +
        "is a STRING, the grader compares with ===, and the correct answer is an integer — " +
        "so every answer would be wrong and every operator would fail with a perfect paper.",
    ).toMatch(/\[q\.id\]:\s*Number\(v\)/);
  });

  it("never lets the score exceed the total", () => {
    // The invariant behind `score / total`: a ratio above 1 would be a scoring
    // bug that still passed, and nothing downstream would notice.
    for (const n of [1, 3, 5, 10]) {
      const answers = Object.fromEntries(questionBank(n).map((q) => [q.id, 1]));
      const r = gradingPass.call(questionBank(n), answers, PASS_RATIO);
      expect(r.score, `A ${n}-question quiz scored ${r.score}.`).toBe(n);
      expect(r.total).toBe(n);
      expect(r.passed).toBe(true);
    }
  });
});

describe("bonzah/grade-quiz — contract and guards", () => {
  it("agrees with the payload the portal hook builds", () => {
    // `const body = await req.json().catch(() => ({}))` — the fourth body shape,
    // parsed by servicing.ts because tests/helpers throws on it rather than
    // silently reporting no fields.
    const shape = assertLooseContract({
      fn: FN,
      builtIn: HOOK,
      payload: { answers: { "00000000-0000-0000-0000-000000000000": 0 } },
      serverOnlyOptional: {
        submissionId:
          "The re-grade path. The function's own header says the normal flow grades BEFORE " +
          "the submission exists and the client carries the result into the insert, so no " +
          "caller in apps/** sends this today. It stamps quiz_score/quiz_total/quiz_passed " +
          "on bonzah_onboarding_submissions when present — which is the only WRITE this " +
          "function can perform, and the reason its live case never sends it.",
      },
    });
    expect(shape.fields, "The request no longer carries `answers`.").toContain("answers");
    expect(
      readRepoFile(HOOK),
      `${HOOK} no longer sends { answers }.`,
    ).toMatch(/invoke\('bonzah-grade-quiz',\s*\{\s*body:\s*\{\s*answers\s*\}/);
  });

  it("refuses an unauthenticated caller BEFORE it can read the answer key", () => {
    // The correct answers live in bonzah_quiz_questions.correct_option_index,
    // which RLS and an answer-omitting view keep away from the client. The only
    // thing standing between an anonymous caller and that column is the order of
    // these two blocks: the service-role client is what can read it.
    const s = src();
    const headerGuardAt = s.indexOf('req.headers.get("Authorization")');
    const unauthorizedAt = s.indexOf('errorResponse("Unauthorized", 401)');
    const serviceRoleAt = s.indexOf("SUPABASE_SERVICE_ROLE_KEY");
    const selectAt = s.indexOf('.from("bonzah_quiz_questions")');
    expect(headerGuardAt, "The Authorization header check is gone.").toBeGreaterThan(-1);
    expect(unauthorizedAt, "The 401 on an unresolvable user is gone.").toBeGreaterThan(-1);
    expect(serviceRoleAt, "The service-role client is gone.").toBeGreaterThan(-1);
    expect(
      headerGuardAt < serviceRoleAt && unauthorizedAt < serviceRoleAt && unauthorizedAt < selectAt,
      `The auth checks moved below the service-role client (header@${headerGuardAt}, ` +
        `401@${unauthorizedAt}, serviceRole@${serviceRoleAt}, select@${selectAt}). The ` +
        "service-role client bypasses RLS: below it, an anonymous caller reaches the column " +
        "holding the correct answers.",
    ).toBe(true);
    expect(
      s,
      "The missing-header response is no longer a 401. Callers cannot tell 'log in again' " +
        "from 'the quiz is broken' on any other status.",
    ).toMatch(/Missing authorization header",\s*401/);
  });

  it("returns the verdict, never the answer key", () => {
    const s = src();
    expect(
      s,
      "The response shape changed. It is `{ score, total, passed, results }` where results " +
        "are BOOLEANS — the moment correct_option_index reaches the response, the quiz is " +
        "answerable from the network tab and the whole server-side grading is pointless.",
    ).toMatch(/jsonResponse\(\{\s*score,\s*total,\s*passed,\s*results\s*\}\)/);
    expect(
      s,
      "`results[q.id]` is no longer the boolean `correct`. Anything else risks putting the " +
        "expected index in front of the client.",
    ).toMatch(/results\[q\.id\]\s*=\s*correct/);
    // The one place the answer key is read, and it must stay inside the
    // service-role query rather than being echoed anywhere.
    const echoes = [...s.matchAll(/jsonResponse\([^)]*correct_option_index/g)];
    expect(echoes.length, "correct_option_index appears inside a jsonResponse call.").toBe(0);
  });

  it("grades only ACTIVE questions", () => {
    expect(
      src(),
      "The is_active filter is gone from the questions query. Retired questions would be " +
        "graded, the total would jump, and every operator's percentage would drop against a " +
        "bank they were never shown — the UI lists the active ones from a different view.",
    ).toMatch(/\.eq\("is_active",\s*true\)/);
  });

  it("refuses an empty question bank instead of dividing by zero", () => {
    // 0/0 is NaN, and `NaN >= 0.8` is false — so without this guard an operator
    // with no configured quiz fails a quiz that does not exist, forever, with no
    // way to progress.
    const s = src();
    const guardAt = s.indexOf("questions.length === 0");
    const divisionAt = s.indexOf("score / total");
    expect(guardAt, "The empty-question-bank guard is gone.").toBeGreaterThan(-1);
    expect(divisionAt, "The pass ratio is no longer computed.").toBeGreaterThan(-1);
    expect(
      guardAt < divisionAt,
      `The empty-bank guard moved below the division (guard@${guardAt}, division@${divisionAt}). ` +
        "0/0 is NaN, NaN >= 0.8 is false, and the operator is told they failed.",
    ).toBe(true);
    expect(s, "The empty-bank refusal no longer answers 400.").toMatch(
      /No active quiz questions configured",\s*400/,
    );
  });

  it("only writes when a submissionId is supplied, and never fails the grade over it", () => {
    // This is the one write, and it is what decides the live rung below: the
    // live case sends no submissionId, so it writes nothing.
    const s = src();
    const ifAt = s.indexOf("if (submissionId)");
    const updateAt = s.indexOf('.from("bonzah_onboarding_submissions")');
    expect(ifAt, "The submissionId guard around the stamping write is gone.").toBeGreaterThan(-1);
    expect(updateAt, "The submission stamping write is gone.").toBeGreaterThan(-1);
    expect(
      ifAt < updateAt,
      "The submission update is no longer inside `if (submissionId)`. It would then run " +
        "with `.eq('id', undefined)` on every grade.",
    ).toBe(true);
    expect(
      s,
      "A failed stamp is no longer swallowed. It must not lose the operator their result: " +
        "they answered the questions, and the grade is the client's to carry into the insert.",
    ).toMatch(/stampError\)\s*\{\s*console\.error/);
  });
});

describe("bonzah/grade-quiz — how the gateway sees it", () => {
  it("is not in supabase/config.toml, so the gateway keeps demanding a JWT", () => {
    // verify_jwt defaults to TRUE; the only way to make an edge function public
    // is to add it to config.toml. Its ONLY protection is the auth check in its own handler; the correct answers live in a column that RLS and an answer-omitting view keep from the client, and the service-role client here can read them.
    //
    // Derived from the file rather than remembered: a `[functions.bonzah-grade-quiz]` block
    // with verify_jwt = false is a one-line change with no other visible effect.
    const toml = readRepoFile("supabase/config.toml");
    const block = new RegExp(`\\[functions\\.bonzah-grade-quiz\\]([\\s\\S]*?)(?=\\n\\[|$)`).exec(toml);
    const verifyJwtOff = block ? /verify_jwt\s*=\s*false/.test(block[1]) : false;
    expect(
      verifyJwtOff,
      "bonzah-grade-quiz has been given verify_jwt = false in supabase/config.toml.\n" +
        "  The handler's own 401s still stand, so this is defence in depth rather than the last line — but the last line is one `if` in a function whose whole purpose is to keep an answer key server-side.",
    ).toBe(false);
  });
});

// ===========================================================================
// LAYER 2 — live. Both cases are read-only BECAUSE they send no submissionId,
// which is the only field that makes this function write. Neither needs
// D247_LIVE_ALLOW_WRITES, and neither may ever be given a submissionId.
// ===========================================================================
describe("bonzah/grade-quiz — live (Layer 2)", () => {
  it("live: refuses the anon key, which is not a user", async (ctx) => {
    const status = liveStatus();
    if (!status.enabled) {
      ctx.skip(status.reason);
      return;
    }
    if (!status.target.anonKey) {
      ctx.skip("D247_LIVE_ANON_KEY is not set — there would be nothing to present.");
      return;
    }
    const res = await liveCall(FN, { answers: {} }, { token: status.target.anonKey });
    expect(
      res.status,
      "Expected 401. The anon key is a valid JWT but resolves to no user, and this " +
        "function's whole job is to grade with a service-role client that can read the " +
        "answer key.\n" +
        `  got ${res.status}: ${res.text.slice(0, 300)}\n` +
        classifyLive(res).explain,
    ).toBe(401);
  });

  it("live: grades an empty submission as zero without writing anything", async (ctx) => {
    const status = liveStatus();
    if (!status.enabled) {
      ctx.skip(status.reason);
      return;
    }
    const jwt = fixtureOrNull("D247_LIVE_PORTAL_JWT") ?? fixtureOrNull("D247_LIVE_SESSION_JWT");
    if (!jwt) {
      ctx.skip(
        "Neither D247_LIVE_PORTAL_JWT nor D247_LIVE_SESSION_JWT is set. This function needs " +
          "a real user; the anon key only reaches the 401 above.",
      );
      return;
    }

    // NO submissionId. That is deliberate and is what keeps this case read-only.
    const res = await liveCall(FN, { answers: {} }, { token: jwt });

    if (res.status === 400 && /No active quiz questions/.test(res.text)) {
      ctx.skip(
        "The target project has no active bonzah_quiz_questions rows, so there is nothing " +
          "to grade. That is a fixture gap, not a regression — the guard itself is asserted " +
          "offline above.",
      );
      return;
    }

    expect(res.status, `${FN} did not return 200.\n` + classifyLive(res).explain).toBe(200);
    expect(
      Number(res.json?.total),
      "The deployed quiz reports zero active questions with a 200. The empty-bank guard " +
        "should have answered 400.",
    ).toBeGreaterThan(0);
    expect(
      res.json?.score,
      "An empty answer set scored above zero on the deployed function. Something is " +
        "grading `undefined` as correct.",
    ).toBe(0);
    expect(res.json?.passed, "An empty answer set passed the quiz.").toBe(false);
    expect(
      Object.values(res.json?.results ?? {}).every((v) => v === false),
      "The deployed results map is not all-false for an empty submission: " +
        JSON.stringify(res.json?.results).slice(0, 200),
    ).toBe(true);
  });
});
