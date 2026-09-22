import { NextResponse, type NextRequest } from "next/server";
import { normalizeReferralCode, REFERRAL_COOKIE, REFERRAL_COOKIE_DAYS } from "@/lib/referral-cookie";

/**
 * A referral link: drive-247.com/r/SUNSET-4821.
 *
 * Remembers the code (cookie — the signup journey's redirects drop query
 * strings) and lands the visitor on the home page, whose banner says who
 * invited them and what they get. Whether the code is still good is checked
 * there and again at checkout, never here: this route only carries it.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = await params;
  const code = normalizeReferralCode(decodeURIComponent(raw ?? ""));
  const home = new URL("/", req.url);
  if (!code) return NextResponse.redirect(home, 307);

  home.searchParams.set("ref", code);
  home.hash = "pricing";
  const res = NextResponse.redirect(home, 307);
  res.cookies.set(REFERRAL_COOKIE, code, {
    maxAge: REFERRAL_COOKIE_DAYS * 24 * 60 * 60,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    httpOnly: false,
  });
  return res;
}
