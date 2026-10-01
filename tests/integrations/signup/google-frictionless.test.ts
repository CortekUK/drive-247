// =============================================================================
// "Continue with Google" asks for nothing first.
//
// The button used to validate the business name and web address BEFORE the
// redirect, reasoning that the trip is one-way and the operator would otherwise
// "come back signed in, with a real auth user, and have to be asked for it
// afterwards".
//
// Being asked afterwards is the point. `accountMode` becomes "tenant" on the
// far side and the step drops to exactly those two fields — the question is
// already asked, in the one place it belongs, after the identity exists.
// Demanding them first made the frictionless path the LONGEST one on screen:
// fill in a form, then press the button that was supposed to save you the
// typing.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../../');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
const strip = (s: string) =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const step = strip(read('apps/web/src/components/onboarding/steps/account-step.tsx'));
const provider = strip(read('apps/web/src/components/onboarding/onboarding-provider.tsx'));

/** Just the Google handler, so assertions cannot pass on the email path's code. */
const handler = step.slice(
  step.indexOf('const handleGoogle'),
  step.indexOf('const handleSignIn'),
);

describe('the Google button leaves immediately', () => {
  it('does not block on the tenant fields', () => {
    expect(handler).not.toMatch(/tenantErrors\(\)/);
    expect(handler).not.toMatch(/focusFirst/);
  });

  it('still carries across anything already typed', () => {
    // Someone who filled the fields in before spotting the button loses nothing.
    expect(handler).toMatch(/onGoogle\(tenantValues\(\)\)/);
  });

  it('clears stale errors rather than leaving them on screen', () => {
    expect(handler).toMatch(/setErrors\(\{\}\)/);
  });
});

describe('the far side still asks', () => {
  it('drops the step to the tenant fields after Google', () => {
    // If this ever stops being true, the change above turns into data loss:
    // nobody would ask for the business name at all.
    expect(provider).toMatch(/accountMode/);
    expect(provider).toMatch(/"tenant"/);
  });
});
