/**
 * shared/portal-v2/list-styles.ts restates the operator list kit's strings in
 * the shared `v2-*` colours for the customer portal. Each must be the kit's own
 * string with only the semantic colour swapped for its shared twin, so the
 * customer table can never drift from the operator's reference list.
 */
import { describe, expect, it } from 'vitest';

import { LIST_CLASSES, LIST_TONES } from '@/components/shared/list-table-v2';
import { V2_LIST_CLASSES, V2_LIST_TONES } from '../../../../../shared/portal-v2/list-styles';

/** Semantic utility → its shared twin (both resolve to one token under `.v2-theme`). */
const toShared = (classes: string) =>
  classes
    .replace(/\btext-muted-foreground\b/g, 'text-v2-muted-fg')
    .replace(/\btext-foreground\b/g, 'text-v2-fg')
    .replace(/\bbg-card\b/g, 'bg-v2-card')
    .replace(/\bbg-muted\b/g, 'bg-v2-muted');

describe('shared list styles match the operator list kit', () => {
  for (const [key, classes] of Object.entries(V2_LIST_CLASSES)) {
    it(`${key} is the kit's ${key} in shared colours`, () => {
      expect(classes).toBe(toShared(LIST_CLASSES[key as keyof typeof LIST_CLASSES]));
    });
  }

  for (const [tone, classes] of Object.entries(LIST_TONES)) {
    it(`the ${tone} status colour is the kit's`, () => {
      expect(V2_LIST_TONES[tone as keyof typeof V2_LIST_TONES]).toBe(toShared(classes));
    });
  }
});
