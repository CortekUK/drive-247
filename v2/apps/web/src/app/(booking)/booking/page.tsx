import { redirect } from "next/navigation";

/**
 * /booking — no longer a wizard.
 *
 * v2's flow is vehicle-first: a customer picks a car on /fleet and lands on
 * that car's own booking page. There is nothing to book here without one, so
 * this route forwards to the fleet grid rather than rendering a step-one that
 * only asks which car they meant.
 *
 * The navbar, the mobile nav and `components/forms/location-search-form.tsx`
 * all still point at /booking (they are owned elsewhere), and the search form
 * carries `pickup` / `dropoff` in the query string — so the query is forwarded
 * intact rather than dropped on the floor.
 */

type SearchParams = Record<string, string | string[] | undefined>;

export default async function BookingIndexRoute({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const forwarded = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") forwarded.set(key, value);
    // A repeated param arrives as an array; keep every value rather than
    // silently picking one.
    else if (Array.isArray(value)) for (const item of value) forwarded.append(key, item);
  }

  const query = forwarded.toString();
  redirect(query === "" ? "/fleet" : `/fleet?${query}`);
}
