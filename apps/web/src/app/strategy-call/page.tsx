import { redirect } from "next/navigation";

/*
 * The strategy call page is gone (Ghulam, 2026-11-10): booking a demo is a dialog now
 * (components/book-demo). This address stays, because it is in emails, ads and old links,
 * and every Book a demo button still points here: it opens the landing page with the dialog
 * already up. /strategy-call/confirmation, where a finished booking lands, is unchanged.
 */
export default function StrategyCallPage() {
  redirect("/?demo=1");
}
