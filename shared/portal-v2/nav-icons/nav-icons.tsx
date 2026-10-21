import { forwardRef, useId, type ReactNode, type SVGProps } from "react";

/**
 * The v2 navigation icons — monoline, in the manner of Resend's sidebar
 * (Oct 6 2026): one even stroke, no fills, simple geometric shapes drawn large
 * and BOLD (2.2 on the 24 grid, shown at 18px — the gauge set the standard and
 * the rest were brought up to it), and a
 * small gesture of their own when the row is hovered or focused (the needle
 * revs, the key turns, the signature writes itself). The gestures and their
 * wind-up-and-snap timing live in `nav-icons.css`, keyed on `data-m`,
 * `data-draw`, `data-hop` and `data-grow` attributes on the moving parts.
 *
 * Drop-in for a lucide icon: 24px viewBox, `currentColor` stroke, the same
 * props (`className`, `strokeWidth`), so a nav list can hold either. An active
 * row still turns the whole icon its accent through `currentColor`.
 */

type IconProps = SVGProps<SVGSVGElement>;

function makeIcon(name: string, draw: () => ReactNode, weight = 2.2) {
  const Icon = forwardRef<SVGSVGElement, IconProps>(({ strokeWidth = weight, className, ...props }, ref) => (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className ? `nav-ic ${className}` : "nav-ic"}
      {...props}
    >
      {draw()}
    </svg>
  ));
  Icon.displayName = name;
  return Icon;
}

/**
 * The gauge — a car's dashboard, literally. Hover: the needle revs.
 * Drawn larger than the rest of the set (the dial runs almost edge to edge) and
 * a step bolder, by request (Oct 6 2026): it is the home row and leads the rail.
 * Kept to three marks — the dial, the needle, the hub — with no tick marks.
 */
export const NavDashboard = makeIcon("NavDashboard", () => (
  <>
    <path d="M3.5 17.9A9.8 9.8 0 1 1 20.5 17.9" />
    <g data-m="needle">
      <path d="M12 13 15.9 8.4" />
    </g>
    <circle cx="12" cy="13" r="1.3" fill="currentColor" />
  </>
), 2.2);

/**
 * Three people — one in front, two behind: the whole customer base rather than
 * one person (Oct 7 2026; picked from six on a sheet, replacing two people).
 *
 * Hover: a CAROUSEL — the people change places. The crowd slides one place to
 * the right and fades as an identical crowd slides in from the left and fades
 * up, so everyone appears to move along one seat. It ends on exactly the
 * picture it started from (the incoming copy holds the frame), so nothing has
 * to animate back on leave.
 */
function Crowd() {
  return (
    <>
      <path d="M5.2 6.2a2.6 2.6 0 0 0 0 5M2 17.8c0-2.3 1.2-4 3-4.6" />
      <circle cx="12" cy="8" r="3.2" />
      <path d="M6.5 20c0-3.3 2.4-5.6 5.5-5.6s5.5 2.3 5.5 5.6" />
      <path d="M18.8 6.2a2.6 2.6 0 0 1 0 5M22 17.8c0-2.3-1.2-4-3-4.6" />
    </>
  );
}

export const NavCustomers = makeIcon("NavCustomers", () => (
  <>
    <g data-m="crowd-out">
      <Crowd />
    </g>
    <g data-m="crowd-in">
      <Crowd />
    </g>
  </>
));

/**
 * A steering wheel — the fleet without drawing a car (Oct 8 2026; Ghulam did
 * not want a car, so option A of the no-car sheet). The rim, a hub, three
 * spokes and a short "rally stripe" at twelve o'clock so a turn reads at 17px.
 * Hover: a lane change — the wheel turns left, swings right, and settles back
 * to centre. Ends at rest.
 */
export const NavVehicles = makeIcon("NavVehicles", () => (
  <g data-m="wheel">
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12.6" r="2.5" />
    <path d="M9.6 12 3.1 11.1M14.4 12l6.5-.9M12 15.1V21" />
    <path d="M12 3v2.2" strokeWidth={3} />
  </g>
));

/** A car key — a rental is the keys changing hands. Hover: it goes in and turns. */
export const NavRentals = makeIcon("NavRentals", () => (
  <g data-m="key">
    <circle cx="8" cy="8" r="4.8" />
    <circle cx="8" cy="8" r="0.9" fill="currentColor" />
    <path d="M11.4 11.4 20.5 20.5" />
    <path d="M16.2 16.2l2.4-2.4" />
  </g>
));

/** A calendar. Hover: the rings hop and a booking writes itself in. */
export const NavAvailability = makeIcon("NavAvailability", () => (
  <>
    <rect x="3" y="4.5" width="18" height="16.5" rx="3" />
    <path d="M3 10h18" />
    <g data-m="rings">
      <path d="M8 2.5v3.6M16 2.5v3.6" />
    </g>
    <path data-draw="" pathLength={1} d="M7.5 15.5h6" />
  </>
));

/** A signed page. Hover: the page rocks and the signature writes itself. */
export const NavAgreements = makeIcon("NavAgreements", () => (
  <g data-m="page">
    <path d="M6 2.5h8l5.5 5.5v11.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-15a2 2 0 0 1 2-2Z" />
    <path d="M14 2.5V7a1 1 0 0 0 1 1h4.5" />
    <path
      data-draw=""
      pathLength={1}
      d="M7.5 16.5c1.2-2.3 2.1-2.6 2.6-.8.4 1.4 1.3 1.4 2.4-.4.5-.8 1-.9 1.4-.2.3.5.8.6 1.6.2"
    />
  </g>
));

/** A card. Hover: it slides up out of the wallet, tips, and settles. */
export const NavFinances = makeIcon("NavFinances", () => (
  <g data-m="card">
    <rect x="2.5" y="5" width="19" height="14" rx="3" />
    <path d="M2.5 9.8h19" />
    <path d="M6.5 15h3.5" />
  </g>
));

/** A speech bubble. Hover: it pops, and the three dots hop in turn. */
export const NavSupport = makeIcon("NavSupport", () => (
  <g data-m="bubble">
    <path d="M5 3.5h14a2.5 2.5 0 0 1 2.5 2.5v8.5A2.5 2.5 0 0 1 19 17h-6.5L8 21v-4H5a2.5 2.5 0 0 1-2.5-2.5V6A2.5 2.5 0 0 1 5 3.5Z" />
    <path data-hop="1" d="M8 10.3h.01" strokeWidth={3} />
    <path data-hop="2" d="M12 10.3h.01" strokeWidth={3} />
    <path data-hop="3" d="M16 10.3h.01" strokeWidth={3} />
  </g>
));

/** Three bars. Hover: they shoot up from the baseline in turn, overshoot, settle. */
export const NavInsights = makeIcon("NavInsights", () => (
  <>
    <path data-grow="1" d="M5.5 20.5V13" />
    <path data-grow="2" d="M12 20.5V8" />
    <path data-grow="3" d="M18.5 20.5V3.5" />
  </>
));

/** A shield. Hover: it pulses and the tick draws itself. */
export const NavInsurances = makeIcon("NavInsurances", () => (
  <g data-m="shield">
    <path d="M12 2.5 20 5.5v5.8c0 5-3.3 8.8-8 10.4-4.7-1.6-8-5.4-8-10.4V5.5Z" />
    <path data-draw="" pathLength={1} d="m8.5 12.2 2.4 2.4 4.6-4.9" />
  </g>
));

/**
 * Two interlocking puzzle pieces — an integration is a piece added to the
 * operator's setup (Oct 6 2026; after a bouncing plug, a plug-and-socket and a
 * hub-and-spokes). Hover: the right piece lifts out of its slot and tilts,
 * then snaps back in; the left piece takes the knock and both settle locked.
 * It ends where it rests, so leaving needs no return trip.
 */
export const NavIntegrations = makeIcon("NavIntegrations", () => (
  <>
    <path data-m="piece-a" d="M12.4 5H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h7.4v-5.2a2.2 2.2 0 1 0 0-3.6Z" />
    <path data-m="piece-b" d="M13.6 5H19a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-5.4v-5a2.45 2.45 0 1 0 0-4Z" />
  </>
), 2.2);

/**
 * A wallet with its clasp — where the money for the plan comes from (Oct 7
 * 2026; replaced the crown, picked from six on a sheet).
 *
 * Hover, in order: the wallet's FLAP OPENS (it swings up on its hinge at the
 * left), then ONE CARD rises out of the opening in front of it, arcs up and
 * settles tilted above the wallet. On leave the card goes back in first and
 * the flap closes after it (the flap's return is delayed in the CSS).
 *
 * A line drawing has no fill to hide one part behind another, so two masks do
 * the occluding:
 *   - `inWallet` hides everything below the wallet's top edge — the card is
 *     invisible at rest and shows only as it clears the opening;
 *   - `behindCard` cuts the card's silhouette out of the flap, so the card
 *     passes IN FRONT of the open flap instead of tangling with its lines.
 * The card's silhouette inside that mask carries the same `data-m` as the
 * card, so the hover CSS moves both in step. Mask ids come from useId so two
 * wallets on one page (sidebar and the phone's More screen) never share one.
 */
const WALLET_FLAP = "M19 7.5V5.8A1.8 1.8 0 0 0 17.2 4H5.5a2.5 2.5 0 0 0 0 5H19";
const WALLET_CARD = "M7 10.4h10a2 2 0 0 1 2 2v4.6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-4.6a2 2 0 0 1 2-2Z";

function BillingArt() {
  const uid = useId().replace(/:/g, "");
  const inWallet = `nav-wallet-in-${uid}`;
  const behindCard = `nav-wallet-card-${uid}`;
  return (
    <>
      <defs>
        <mask id={inWallet} maskUnits="userSpaceOnUse" x="-6" y="-16" width="36" height="44">
          <rect x="-6" y="-16" width="36" height="44" fill="#fff" stroke="none" />
          <rect x="-6" y="7.9" width="36" height="22" fill="#000" stroke="none" />
        </mask>
        <mask id={behindCard} maskUnits="userSpaceOnUse" x="-6" y="-16" width="36" height="44">
          <rect x="-6" y="-16" width="36" height="44" fill="#fff" stroke="none" />
          <g mask={`url(#${inWallet})`}>
            <path data-m="card-a" d={WALLET_CARD} fill="#000" stroke="#000" strokeWidth={4.6} />
          </g>
        </mask>
      </defs>
      <g mask={`url(#${behindCard})`}>
        <path data-m="flap" d={WALLET_FLAP} />
      </g>
      <g mask={`url(#${inWallet})`}>
        <g data-m="card-a">
          <path d={WALLET_CARD} />
          <path d="M5 13.8h14" />
        </g>
      </g>
      <path d="M5.5 9H19a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5.5A2.5 2.5 0 0 1 3 17.5v-11" />
      <path d="M16.5 14.5h.01" strokeWidth={3.2} />
    </>
  );
}

export const NavBilling = makeIcon("NavBilling", () => <BillingArt />);
