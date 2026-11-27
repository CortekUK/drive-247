// Proves spec 02 · Landing in the portal after the card.
//
// A full provision makes a company and a Stripe subscription, so the walk from
// the card into the portal is in the QA report. Here: the link is always made,
// and a link of that kind works once.
import { statement, run, ok, equal } from "../../eval-kit.mjs";
import { makeUser, magicLinkHash, useMagicLink, source } from "./lib/account.mjs";

statement("02.1", "signup-provision always returns a portal sign-in link (no switch)", async () => {
  const src = source("supabase/functions/signup-provision/index.ts");
  // A read of the switch, not the word: the code's own comment says it is gone.
  ok(!/Deno\.env\.get\(\s*["']SIGNUP_PORTAL_MAGICLINK/.test(src), "signup-provision still reads SIGNUP_PORTAL_MAGICLINK");
  ok(/generateLink\(\s*\{[\s\S]{0,80}type:\s*["']magiclink["']/.test(src), "signup-provision does not make a magic link");
});

statement("02.3", "The sign-in link works once", async () => {
  const u = await makeUser({ tag: "link", confirmed: true });
  const hash = await magicLinkHash(u.email);
  ok(hash, "no link was made");
  equal(await useMagicLink(hash), 200, "first use");
  ok((await useMagicLink(hash)) >= 400, "the link signed in a second time");
});

await run(import.meta.url);
