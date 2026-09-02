/* _mock.js — TEST HARNESS ONLY. Not shipped; delete before packaging.
 * Fakes the chrome.* surface popup.js talks to, so every UI state can be
 * driven and screenshotted without a real Turo tab. Feeds popup.js exactly
 * the shapes runExtractor() resolves with — nothing in popup.js is changed. */
(function () {
  "use strict";
  var STATE = new URLSearchParams(location.search).get("state") || "ready";

  var LONG = "Mercedes-AMG G 63 4MATIC Edition 55 Magno Night Package Long Wheelbase";

  function row(o) {
    return Object.assign({
      name: "Volkswagen Tiguan", year: 2021, rating: 4.92, reviewCount: 88,
      isNewListing: false, priceDisplay: "£1,014/month", priceAmount: 1014,
      currency: "GBP", section: "Monthly deals", city: "London",
      listingUrl: "https://turo.com/gb/en/car-rental/united-kingdom/london/volkswagen/tiguan/123456",
      __tier: "json-state", __filledFromLowerTier: false
    }, o);
  }

  var MIXED_ROWS = [
    row({ name: LONG, year: 2024, rating: 5, reviewCount: 3, priceDisplay: "£2,480/month", section: "Luxury & performance" }),
    row({ name: "Volkswagen Tiguan", section: "Monthly deals" }),
    row({ name: "Tesla Model 3 Long Range", year: 2023, rating: 4.87, reviewCount: 214, priceDisplay: "£1,190/month", section: "Electric" }),
    row({ name: "BMW 3 Series", year: 2020, rating: null, reviewCount: null, isNewListing: true, priceDisplay: "£860/month", section: "Monthly deals", __tier: "data-testid" }),
    row({ name: "Ford Puma ST-Line", year: 2022, rating: 4.7, reviewCount: 41, priceDisplay: "£640/month", section: "Everyday", __tier: "data-testid" }),
    row({ name: "Audi Q5 40 TDI quattro S line", year: 2021, rating: 4.95, reviewCount: 120, priceDisplay: "£1,320/month", section: "SUVs", __tier: "data-testid", __filledFromLowerTier: true }),
    row({ name: "Nissan Qashqai", year: null, rating: 4.4, reviewCount: 12, priceDisplay: "£590/month", section: "Everyday", __tier: "heuristic" }),
    row({ name: "MINI Cooper S", year: 2019, rating: null, reviewCount: null, isNewListing: false, priceDisplay: null, priceAmount: null, section: null, listingUrl: null, city: "Manchester", __tier: "heuristic" }),
    row({ name: "Range Rover Evoque", year: 2022, rating: 4.81, reviewCount: 57, priceDisplay: "£1,540/month", section: "Luxury & performance", __tier: "heuristic" }),
    row({ name: "Kia Niro EV", year: 2023, rating: 4.6, reviewCount: 9, priceDisplay: "£720/month", section: "Electric", __tier: "heuristic" }),
    row({ name: "Vauxhall Corsa", year: 2018, rating: 4.2, reviewCount: 30, priceDisplay: "£410/month", section: "Everyday", __tier: "mystery-tier" }),
    row({ name: "Porsche 911 Carrera 4S Cabriolet", year: 2021, rating: 5, reviewCount: 18, priceDisplay: "£3,900/month", section: "Luxury & performance" }),
    row({ name: "Toyota Yaris Cross", year: 2023, rating: 4.75, reviewCount: 64, priceDisplay: "£560/month", section: "Everyday" }),
    row({ name: "Volvo XC40 Recharge", year: 2022, rating: 4.9, reviewCount: 101, priceDisplay: "£1,080/month", section: "Electric" })
  ];

  var CLEAN_ROWS = MIXED_ROWS.slice(1, 6).map(function (r) {
    return Object.assign({}, r, { __tier: "json-state", __filledFromLowerTier: false });
  });

  var PAGE_FACTS = {
    scriptCount: 42, hasNextData: false, hasNextFlight: true, hasNextStatic: true,
    ldJsonTags: 2, dataTestIdCount: 318, vehicleCardTestIds: 14, microdataCount: 0,
    imgCount: 96, knownGlobals: ["__next_f", "__APOLLO_STATE__"],
    flightChars: 481203, stateBlobs: { apollo: 1, flight: 3 }, priceMapEntries: 14
  };

  function diagnostics(produced) {
    return {
      tiers: [
        { tier: "fingerprint", ok: true, produced: 0, ms: 3 },
        { tier: "json-state+deep", ok: true, produced: produced.json || 0, ms: 41 },
        { tier: "data-testid", ok: true, produced: produced.testid || 0, ms: 18 },
        { tier: "heuristic", ok: true, produced: produced.heur || 0, ms: 27 },
        { tier: "merge", ok: true, produced: produced.total || 0, ms: 2 }
      ],
      errors: produced.err ? [{ tier: "data-testid", error: "TypeError: cards.map is not a function\n  at x" }] : [],
      page: PAGE_FACTS
    };
  }

  var RESULTS = {
    rows: MIXED_ROWS, refused: false,
    message: "merged 14 rows from 3 strategies",
    summary: { sections: ["Monthly deals", "Luxury & performance", "Electric", "Everyday", "SUVs"] },
    diagnostics: diagnostics({ json: 6, testid: 3, heur: 4, total: 14, err: true })
  };

  var RESULTS_CLEAN = {
    rows: CLEAN_ROWS, refused: false, message: "ok",
    summary: { sections: ["Monthly deals", "Luxury & performance"] },
    diagnostics: diagnostics({ json: 5, total: 5 })
  };

  var EMPTY = {
    rows: [], refused: false,
    message: "No listings extracted. Tried json-state+deep (0), data-testid (0), heuristic (0). " +
      "Page fingerprint: " + JSON.stringify(PAGE_FACTS),
    summary: { sections: [] },
    diagnostics: diagnostics({ total: 0 })
  };

  var REFUSED = {
    rows: [], refused: true,
    message: "Refused: path matches robots.txt disallow rule /{locale}/p/*",
    summary: { sections: [] }, diagnostics: diagnostics({ total: 0 })
  };

  var CFG = {
    ready:        { url: "https://turo.com/gb/en", result: RESULTS_CLEAN },
    working:      { url: "https://turo.com/gb/en", result: RESULTS, hang: true, click: true },
    results:      { url: "https://turo.com/gb/en", result: RESULTS, click: true },
    "results-clean": { url: "https://turo.com/gb/en", result: RESULTS_CLEAN, click: true },
    details:      { url: "https://turo.com/gb/en", result: RESULTS, click: true, openDetails: true },
    empty:        { url: "https://turo.com/gb/en", result: EMPTY, click: true },
    offsite:      { url: "https://example.com/pricing" },
    disallowed:   { url: "https://turo.com/gb/en/search?location=London" },
    notweb:       { url: "chrome://settings/" },
    refused:      { url: "https://turo.com/gb/en", result: REFUSED, click: true },
    isolated:     { url: "https://turo.com/gb/en", result: RESULTS, click: true, refuseMain: true },
    loaderror:    { url: "https://turo.com/gb/en", result: { rows: [], __loadError: "extractor did not load" }, click: true },
    blocked:      { url: "https://turo.com/gb/en", click: true, throwAll: true }
  };

  var cfg = CFG[STATE] || CFG.ready;
  window.__HARNESS = cfg;

  window.chrome = {
    runtime: { getManifest: function () { return { version: "1.0.0" }; }, lastError: null },
    tabs: {
      query: function (q, cb) {
        cb([{ id: 1, url: cfg.url, title: "Rent cars near you · Turo" }]);
      },
      create: function () {}
    },
    scripting: {
      executeScript: function (o, cb) {
        if (cfg.throwAll) {
          chrome.runtime.lastError = { message: "Cannot access contents of the page." };
          cb(); chrome.runtime.lastError = null; return;
        }
        if (o.world === "MAIN" && cfg.refuseMain) {
          chrome.runtime.lastError = { message: "blocked" };
          cb(); chrome.runtime.lastError = null; return;
        }
        if (o.files) return cb([{ result: null }]);
        if (cfg.hang) return; // never calls back -> stays in the Working state
        cb([{ result: cfg.result }]);
      }
    }
  };
})();
