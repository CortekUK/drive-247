/**
 * fixture.js — the bundled sample reservation.
 *
 * WHY THIS EXISTS
 * ---------------
 * Turo does not operate in every country and this PoC has no Turo host account
 * to test against. The extension must still complete the whole round trip —
 * read -> normalise -> POST -> row in the Drive247 portal — on a machine that
 * cannot reach real Turo data. This file is that stand-in.
 *
 * It is loaded in THREE places and must work in all of them, so it attaches to
 * `globalThis` and uses no module syntax, no DOM and no chrome.* API:
 *   1. the MV3 service worker, via importScripts("fixture.js")
 *   2. the ISOLATED world of a turo.com tab, via chrome.scripting.executeScript
 *   3. the MAIN world of a turo.com tab (the retry path), same mechanism
 *
 * HONESTY RULE — do not weaken this.
 * Anything produced from this file is stamped source: "fixture" all the way to
 * the database, whose column carries CHECK (source IN ('turo','fixture')). The
 * popup says "sample data" out loud on this path. A demo that cannot tell you
 * which of the two things it just did is worse than no demo.
 *
 * SHAPE CAVEAT. The object below is shaped like one entry of Turo's
 * GET /api/v2/feeds/upcoming-trips?appMode=HOST response. The URL and the
 * appMode=HOST parameter are confirmed; Turo publishes no schema, and we have
 * never observed a live response, so every FIELD NAME here is a reconstruction.
 * That is deliberately fine: normalize() in content-turo.js discovers fields
 * rather than assuming them, so it does not depend on these names being right.
 */

globalThis.D247_TURO_FIXTURE = {
  /** One upcoming-trips feed entry, in Turo's (reconstructed) shape. */
  raw: {
    id: 900000001,
    reservationId: "R-900000001",
    status: "BOOKED",

    renter: {
      id: 55512345,
      firstName: "Sample",
      lastName: "Guest",
      name: "Sample Guest (fixture)",
      email: "sample.guest@example.invalid"
    },

    vehicle: {
      id: 77712345,
      year: 2023,
      make: "Tesla",
      model: "Model 3",
      trim: "Long Range",
      licensePlate: "SAMPLE-001"
    },

    pickup: {
      dateTime: "2026-09-12T15:00:00.000Z",
      location: { address: "San Francisco International Airport (SFO)" }
    },
    return: {
      dateTime: "2026-09-16T11:00:00.000Z",
      location: { address: "San Francisco International Airport (SFO)" }
    },

    total: { amount: 486.5, currencyCode: "USD" },

    /* Markers, so this can never be mistaken for a live trip in the DB or a log. */
    __drive247_fixture: true,
    __drive247_note:
      "Bundled sample reservation shipped with the Drive247 Turo Bridge extension. NOT real Turo data."
  }
};
