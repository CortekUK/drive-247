import { describe, expect, it } from 'vitest';

import {
  FIRST_RUN_QUESTIONS,
  FIRST_RUN_QUESTION_SET_VERSION,
  isAnswered,
} from '@/lib/first-run-questions';

/**
 * The question list is meant to be swapped by hand — Ghulam's real list is
 * still to come. These assertions are the contract the wizard relies on, so an
 * edit that breaks one fails here rather than in front of an operator.
 */
describe('FIRST_RUN_QUESTIONS', () => {
  it('asks 4 to 5 questions', () => {
    expect(FIRST_RUN_QUESTIONS.length).toBeGreaterThanOrEqual(4);
    expect(FIRST_RUN_QUESTIONS.length).toBeLessThanOrEqual(5);
  });

  it('has unique, non-empty ids — answers are keyed by them', () => {
    const ids = FIRST_RUN_QUESTIONS.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.trim().length).toBeGreaterThan(0);
  });

  it('gives every question a prompt, and every choice question options', () => {
    for (const q of FIRST_RUN_QUESTIONS) {
      expect(q.prompt.trim().length, `${q.id} needs a prompt`).toBeGreaterThan(0);
      if (q.kind === 'single' || q.kind === 'multi') {
        expect(q.options.length, `${q.id} needs options`).toBeGreaterThan(1);
        const values = q.options.map((o) => o.value);
        expect(new Set(values).size, `${q.id} has duplicate option values`).toBe(
          values.length,
        );
        for (const o of q.options) expect(o.label.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('records a question-set version, so old answers stay interpretable', () => {
    expect(FIRST_RUN_QUESTION_SET_VERSION).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(FIRST_RUN_QUESTION_SET_VERSION)).toBe(true);
  });
});

describe('isAnswered', () => {
  const single = FIRST_RUN_QUESTIONS.find((q) => q.kind === 'single' && q.required)!;
  const multi = FIRST_RUN_QUESTIONS.find((q) => q.kind === 'multi')!;
  const text = FIRST_RUN_QUESTIONS.find((q) => q.kind === 'text')!;
  const optional = FIRST_RUN_QUESTIONS.find((q) => !q.required);

  it('treats an optional question as always answered', () => {
    // Skip rather than fail if every question is made required later — the
    // wizard works either way, this branch simply stops existing.
    if (!optional) return;
    expect(isAnswered(optional, undefined)).toBe(true);
  });

  it('requires a value for a required single-choice question', () => {
    expect(isAnswered(single, undefined)).toBe(false);
    expect(isAnswered(single, '')).toBe(false);
    expect(isAnswered(single, 'anything')).toBe(true);
  });

  it('requires at least one selection for a multi-choice question', () => {
    expect(isAnswered(multi, [])).toBe(false);
    expect(isAnswered(multi, ['one'])).toBe(true);
  });

  it('rejects whitespace-only free text', () => {
    expect(isAnswered(text, '   ')).toBe(false);
    expect(isAnswered(text, 'Denver, CO')).toBe(true);
  });
});
