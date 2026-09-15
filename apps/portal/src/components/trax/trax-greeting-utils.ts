/**
 * The time-of-day greeting, shared logic for Trax's empty state.
 *
 * A VERBATIM copy of `getGreeting` in components/dashboard-v2/dashboard-v2.tsx
 * (line ~52), where it is module-private. It is copied rather than imported
 * because that file is owned by other work; the follow-up is for dashboard-v2
 * to import from here so there is one copy. Until then, change both together —
 * an operator who reads "Good evening" on the dashboard and "Good night" in
 * Trax a second later would rightly think one of them is broken.
 */
export function getGreeting(hour: number): { text: string } {
  if (hour < 5) return { text: "Working late" };
  if (hour < 12) return { text: "Good morning" };
  if (hour < 17) return { text: "Good afternoon" };
  if (hour < 21) return { text: "Good evening" };
  return { text: "Good night" };
}

/**
 * First name only, the way the dashboard hero does it (dashboard-v2.tsx ~165).
 * Deliberately no email fallback: the dashboard greets "Good morning." rather
 * than "Good morning, jsmith", and Trax should say the same thing.
 */
export function firstNameOf(name?: string | null): string {
  return (name || "").trim().split(/\s+/)[0] ?? "";
}
