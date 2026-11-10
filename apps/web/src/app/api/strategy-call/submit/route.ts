import { NextResponse } from "next/server";
import { submitStrategyCallAction, type StrategyCallState } from "@/actions/strategy-call";

/*
 * The Book a demo form posts here (components/book-demo/book-demo-flow.tsx).
 *
 * It runs the same function the old /strategy-call page ran as a server action, unchanged:
 * same checks, same save, same session cookie. It is a plain endpoint rather than a server
 * action because the dialog opens over ANY page. A server action that sets a cookie makes
 * Next re-send the whole page it was called from in the same response; over the landing
 * page that is a 300 KB re-render, and the dialog (and the visitor's place in it) did not
 * survive it. Here the answer is three fields of JSON and the page is left alone.
 */

export const dynamic = "force-dynamic";

const refuse = (message: string, status: number) =>
  NextResponse.json({ success: false, message } satisfies StrategyCallState, { status });

export async function POST(request: Request) {
  // Server actions refuse a post from another site; a plain route has to say so itself.
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  let originHost: string | null = null;
  try {
    originHost = origin ? new URL(origin).host : null;
  } catch {
    originHost = null;
  }
  if (!originHost || !host || originHost !== host) {
    return refuse("Something went wrong. Please try again.", 403);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return refuse("Something went wrong. Please try again.", 400);
  }

  const result = await submitStrategyCallAction(null, formData);
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
