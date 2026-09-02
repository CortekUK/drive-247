/**
 * extract.js — three extraction strategies, tried most-reliable first.
 *
 * NO NETWORK. This file contains no fetch/XHR/navigation. It reads the
 * document that is already loaded. See the legal note at the top of schema.js.
 *
 * WHY LAYERED
 * turo.com 403s every automated request, so the real DOM has never been seen.
 * Anything written against a guessed class name would be fiction. So we try,
 * in order:
 *
 *   TIER 1  embedded structured state (JSON the page shipped to itself)
 *   TIER 2  semantic attributes (microdata, data-testid, aria-label)
 *   TIER 3  heuristic shape-matching on the rendered DOM
 *
 * Tier 1 is worth an enormous amount here: a modern JS app serialises its data
 * into the document before rendering it, and that JSON survives every restyle,
 * A/B test and class-name hash. Tier 3 is a genuine last resort and its rows
 * are labelled as such — a heuristic row must never be presented as if it were
 * lifted from JSON.
 *
 * Every row records the tier AND the specific source that produced it.
 */
(function () {
  "use strict";

  var NS = (globalThis.__turoScrape = globalThis.__turoScrape || {});
  var S = NS.schema;

  var MIN_ROWS_TO_ACCEPT_TIER = 2;   // one lucky match is not a win
  var MAX_ROWS = 500;

  // Key aliases. Every one is a guess; that is why there are so many.
  var K = {
    name:    ["name", "title", "vehicleName", "displayName", "label", "headline", "vehicleTitle"],
    make:    ["make", "brand", "manufacturer", "vehicleMake"],
    model:   ["model", "modelName", "vehicleModel"],
    year:    ["year", "modelYear", "vehicleYear"],
    price:   ["price", "dailyPrice", "averageDailyPrice", "avgDailyPrice", "dailyRate", "rate",
              "monthlyPrice", "displayPrice", "priceWithCurrency", "amount", "value", "total"],
    currency:["currency", "currencyCode", "priceCurrency", "currencyIsoCode"],
    rating:  ["rating", "ratingValue", "averageRating", "avgRating", "starRating", "overallRating"],
    reviews: ["reviewCount", "numberOfReviews", "reviewsCount", "ratingCount", "tripCount",
              "numTrips", "completedTrips", "reviews"],
    url:     ["url", "listingUrl", "permalink", "href", "link", "canonicalUrl", "detailUrl"],
    id:      ["id", "vehicleId", "listingId", "vehicleIdStr", "listing_id", "vehicle_id"],
    image:   ["image", "imageUrl", "photo", "photoUrl", "thumbnail", "thumbnailUrl",
              "mainImage", "images", "photos", "imageUrls"],
    section: ["sectionTitle", "heading", "header", "title", "name", "label"],
    subtitle:["subtitle", "subheading", "description", "caption", "secondaryText"]
  };

  function isObj(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }
  function normKey(k) { return String(k).toLowerCase().replace(/[^a-z0-9]/g, ""); }

  /** Case/separator-insensitive lookup: dailyPrice == daily_price == DAILY-PRICE. */
  function pick(obj, aliases) {
    if (!isObj(obj)) return undefined;
    var index = Object.create(null), keys = Object.keys(obj);
    for (var i = 0; i < keys.length; i++) {
      var n = normKey(keys[i]);
      if (!(n in index)) index[n] = obj[keys[i]];
    }
    for (var j = 0; j < aliases.length; j++) {
      var v = index[normKey(aliases[j])];
      if (v !== undefined && v !== null && v !== "") return v;
    }
    return undefined;
  }

  /** Unwrap {amount, currency} / {value} / "12.00" / 12 into a number. */
  function numFrom(v) {
    if (typeof v === "number" && isFinite(v)) return v;
    if (typeof v === "string") return S.parseAmount(v);
    if (isObj(v)) {
      var inner = pick(v, ["amount", "value", "price", "total", "cents", "displayValue"]);
      if (inner !== undefined && !isObj(inner)) return numFrom(inner);
    }
    return null;
  }

  function strFrom(v) {
    if (typeof v === "string") return S.clean(v);
    if (typeof v === "number") return String(v);
    if (Array.isArray(v)) return v.length ? strFrom(v[0]) : null;
    if (isObj(v)) {
      var inner = pick(v, ["url", "src", "value", "text", "name", "label", "displayValue"]);
      if (inner !== undefined && !isObj(inner)) return strFrom(inner);
    }
    return null;
  }

  // =====================================================================
  // TIER 1 — EMBEDDED STRUCTURED STATE
  // =====================================================================

  /**
   * Collect every JSON blob the page shipped to itself.
   *
   * Two ways to reach the same data, and we try both because they fail
   * differently: reading the GLOBAL (works only in the MAIN world, and only if
   * the app has not deleted it after hydration) and reading the <script> TAG
   * TEXT (works from either world, and survives post-hydration cleanup).
   */
  function collectStateBlobs(diag) {
    var blobs = [];

    function add(source, value, note) {
      if (value === undefined || value === null) return;
      blobs.push({ source: source, value: value });
      diag.sources.push({ source: source, found: true, note: note || null });
    }
    function miss(source, note) { diag.sources.push({ source: source, found: false, note: note || null }); }

    // --- 1a. Next.js Pages Router: <script id="__NEXT_DATA__"> ------------
    try {
      var nd = document.getElementById("__NEXT_DATA__");
      if (nd && nd.textContent) {
        add("__NEXT_DATA__", JSON.parse(nd.textContent), nd.textContent.length + " bytes");
      } else miss("__NEXT_DATA__");
    } catch (e) { miss("__NEXT_DATA__", "present but unparseable: " + e.message); }

    // --- 1b. schema.org JSON-LD. Highest confidence when present, because
    //         the mapping to our columns is exact rather than inferred. -----
    try {
      var lds = document.querySelectorAll('script[type="application/ld+json"]');
      if (lds.length) {
        var okCount = 0;
        for (var i = 0; i < lds.length; i++) {
          try { add("ld+json", JSON.parse(lds[i].textContent), "block " + (i + 1)); okCount++; }
          catch (e2) { /* one bad block must not kill the rest */ }
        }
        if (!okCount) miss("ld+json", lds.length + " block(s) present, none parseable");
      } else miss("ld+json");
    } catch (e) { miss("ld+json", e.message); }

    // --- 1c. MAIN-world globals. Undefined in the ISOLATED world, which is
    //         exactly why the popup injects into MAIN. -----------------------
    var globals = [
      ["__APOLLO_STATE__",   "__APOLLO_STATE__"],
      ["__INITIAL_STATE__",  "__INITIAL_STATE__"],
      ["__REDUX_STATE__",    "__INITIAL_STATE__"],
      ["__PRELOADED_STATE__","__INITIAL_STATE__"],
      ["__NUXT__",           "__INITIAL_STATE__"],
      ["__remixContext",     "__INITIAL_STATE__"]
    ];
    for (var g = 0; g < globals.length; g++) {
      try {
        var val = globalThis[globals[g][0]];
        if (val) add(globals[g][1], val, "global " + globals[g][0]);
      } catch (e) { /* getter threw; ignore */ }
    }

    // --- 1d. Next.js App Router flight data ------------------------------
    try {
      var f = globalThis.__next_f;
      if (f && f.length) {
        var text = "";
        for (var n = 0; n < f.length; n++) {
          var chunk = f[n];
          if (typeof chunk === "string") text += chunk;
          else if (Array.isArray(chunk) && typeof chunk[1] === "string") text += chunk[1];
        }
        if (text) {
          var objs = extractBalancedObjects(text, 400);
          if (objs.length) add("__next_f", objs, objs.length + " object(s) from " + text.length + " bytes");
          else miss("__next_f", "present (" + text.length + " bytes) but no listing-shaped objects");
        }
      } else miss("__next_f");
    } catch (e) { miss("__next_f", e.message); }

    // --- 1e. Inline assignments, read as TEXT. Works from the ISOLATED
    //         world and survives the app deleting the global. ---------------
    try {
      var scripts = document.querySelectorAll("script:not([src])");
      diag.inline_script_count = scripts.length;
      var hits = 0;
      for (var s = 0; s < scripts.length && hits < 8; s++) {
        var txt = scripts[s].textContent || "";
        if (txt.length < 200 || txt.length > 8000000) continue;
        if (!/__APOLLO_STATE__|__INITIAL_STATE__|__PRELOADED_STATE__|"vehicleId"|"dailyPrice"/.test(txt)) continue;
        var found = extractBalancedObjects(txt, 200);
        if (found.length) { add("inline-script", found, "script #" + s); hits++; }
      }
      if (!hits) miss("inline-script", scripts.length + " inline script(s), none carried listing-shaped JSON");
    } catch (e) { miss("inline-script", e.message); }

    return blobs;
  }

  /**
   * Pull balanced {...} objects out of an arbitrary string (flight payloads,
   * inline assignments). Only objects that look listing-ish are kept, and the
   * scan is budgeted — this runs on multi-megabyte payloads.
   */
  var LISTING_HINT = /"(?:make|model|vehicleId|listingId|dailyPrice|averageDailyPrice|ratingValue|reviewCount|vehicleName)"/;

  function extractBalancedObjects(text, maxObjects) {
    var out = [];
    if (typeof text !== "string") return out;
    var limit = Math.min(text.length, 6000000);
    var i = 0;
    while (i < limit && out.length < maxObjects) {
      var start = text.indexOf("{", i);
      if (start === -1) break;
      var depth = 0, inStr = false, esc = false, end = -1;
      for (var p = start; p < limit; p++) {
        var c = text[p];
        if (esc) { esc = false; continue; }
        if (c === "\\") { esc = true; continue; }
        if (c === '"') { inStr = !inStr; continue; }
        if (inStr) continue;
        if (c === "{") depth++;
        else if (c === "}") { depth--; if (depth === 0) { end = p; break; } }
        if (p - start > 900000) break;               // runaway guard
      }
      if (end === -1) break;
      var slice = text.slice(start, end + 1);
      if (LISTING_HINT.test(slice)) {
        try { out.push(JSON.parse(slice)); } catch (e) { /* not JSON; skip */ }
      }
      i = end + 1;
    }
    return out;
  }

  /**
   * Does this object look like a vehicle listing?
   * Threshold 5 is what stops a nav item, a promo tile or a breadcrumb from
   * being exported as a car.
   */
  var LISTING_THRESHOLD = 5;

  function listingScore(node) {
    if (!isObj(node)) return 0;
    var s = 0;
    var make = strFrom(pick(node, K.make)), model = strFrom(pick(node, K.model));
    var name = strFrom(pick(node, K.name));
    if (make && model) s += 3;
    else if (S.looksLikeVehicleName(name)) s += 3;
    if (S.parseYear(String(pick(node, K.year) !== undefined ? pick(node, K.year) : "")) !== null) s += 2;
    if (numFrom(pick(node, K.price)) !== null) s += 2;
    if (pick(node, K.rating) !== undefined || pick(node, K.reviews) !== undefined) s += 2;
    if (pick(node, K.url) !== undefined || pick(node, K.id) !== undefined) s += 2;
    if (pick(node, K.image) !== undefined) s += 1;
    return s;
  }

  function bagFromJsonNode(node, sectionTitle, sectionSubtitle) {
    var priceRaw = pick(node, K.price);
    var amount = numFrom(priceRaw);
    // Currency almost always sits inside the money object ({amount, currency}),
    // not on the listing. Look there first, then fall back to the listing.
    var currency = null;
    if (isObj(priceRaw)) currency = strFrom(pick(priceRaw, K.currency));
    if (!currency) currency = strFrom(pick(node, K.currency));
    // A price object often carries its own period ("MONTH", "perDay": true).
    var period = null;
    if (isObj(priceRaw)) {
      var pr = strFrom(pick(priceRaw, ["period", "unit", "interval", "frequency", "per"]));
      if (pr) period = S.detectPeriod(pr) || S.detectPeriod("/" + pr);
    }
    if (!period) {
      var keyHint = Object.keys(node).join(" ");
      period = /monthly|permonth/i.test(keyHint) ? "month"
             : /daily|perday/i.test(keyHint) ? "day"
             : /weekly|perweek/i.test(keyHint) ? "week" : null;
    }
    return {
      vehicle_raw: strFrom(pick(node, K.name)) ||
                   [strFrom(pick(node, K.make)), strFrom(pick(node, K.model))].filter(Boolean).join(" ") || null,
      make: strFrom(pick(node, K.make)),
      model: strFrom(pick(node, K.model)),
      year: pick(node, K.year),
      rating: numFrom(pick(node, K.rating)),
      reviews_count: numFrom(pick(node, K.reviews)),
      price_amount: amount,
      price_currency: currency,
      price_period: period,
      price_raw: typeof priceRaw === "string" ? priceRaw : (amount !== null ? String(amount) : null),
      listing_url: strFrom(pick(node, K.url)),
      image_url: strFrom(pick(node, K.image)),
      listing_id: strFrom(pick(node, K.id)),
      section_title: sectionTitle,
      section_subtitle: sectionSubtitle,
      section_source: sectionTitle ? "json-ancestor" : null
    };
  }

  /**
   * Walk a blob and harvest listings.
   *
   * POST-ORDER, and that matters: if a node scores but one of its DESCENDANTS
   * also scores, the descendant is the real listing and the ancestor is just
   * the card wrapper that quotes its child's fields. Accepting both would
   * duplicate every car. So a node is only accepted when its subtree yielded
   * nothing.
   *
   * Section titles are inherited downward: on this page the heading ("Monthly
   * luxury car rentals in Oxford") sits on the container, not the card.
   */
  function harvestJson(root, source, out, diag) {
    var visited = 0, MAX_VISITS = 60000;

    function walk(node, sectionTitle, sectionSubtitle, depth) {
      if (++visited > MAX_VISITS || depth > 14 || !node || typeof node !== "object") return false;

      if (Array.isArray(node)) {
        var anyArr = false;
        for (var i = 0; i < node.length && i < 400; i++) {
          if (walk(node[i], sectionTitle, sectionSubtitle, depth + 1)) anyArr = true;
        }
        return anyArr;
      }

      // If this object heads a group (a title plus an array of objects), its
      // title becomes the section for everything beneath it.
      var st = sectionTitle, ss = sectionSubtitle;
      var maybeTitle = strFrom(pick(node, K.section));
      if (maybeTitle && maybeTitle.length < 120 && listingScore(node) < LISTING_THRESHOLD) {
        var hasObjArray = false, ks0 = Object.keys(node);
        for (var a = 0; a < ks0.length; a++) {
          var vv = node[ks0[a]];
          if (Array.isArray(vv) && vv.length && isObj(vv[0])) { hasObjArray = true; break; }
        }
        if (hasObjArray) { st = maybeTitle; ss = strFrom(pick(node, K.subtitle)); }
      }

      var childYielded = false;
      var ks = Object.keys(node);
      for (var j = 0; j < ks.length; j++) {
        var v = node[ks[j]];
        if (v && typeof v === "object") {
          if (walk(v, st, ss, depth + 1)) childYielded = true;
        }
      }
      if (childYielded) return true;               // descendants own this subtree

      if (listingScore(node) >= LISTING_THRESHOLD) {
        var bag = bagFromJsonNode(node, st, ss);
        bag.extraction_tier = "json";
        bag.extraction_source = source;
        out.push(bag);
        return true;
      }
      return false;
    }

    walk(root, null, null, 0);
    diag.visited = (diag.visited || 0) + visited;
  }

  /**
   * schema.org JSON-LD gets its own reader. The mapping is EXACT
   * (Car/Product -> offers.price / aggregateRating.ratingValue), so we do not
   * want the generic scorer guessing at it.
   */
  function harvestJsonLd(blob, out) {
    var stack = [blob], seen = 0;
    while (stack.length && seen < 4000) {
      var node = stack.pop(); seen++;
      if (Array.isArray(node)) { for (var i = 0; i < node.length; i++) stack.push(node[i]); continue; }
      if (!isObj(node)) continue;

      var type = node["@type"];
      var types = (Array.isArray(type) ? type : [type]).filter(Boolean).map(String).join(" ");

      if (/\b(Car|Vehicle|Product|Offer)\b/i.test(types)) {
        var offers = node.offers || {};
        if (Array.isArray(offers)) offers = offers[0] || {};
        var agg = node.aggregateRating || {};
        var bag = {
          vehicle_raw: strFrom(node.name) || strFrom(node.model),
          make: strFrom(node.brand && (node.brand.name || node.brand)) || strFrom(node.manufacturer),
          model: strFrom(node.model),
          year: node.vehicleModelDate || node.modelDate || node.productionDate || null,
          rating: numFrom(agg.ratingValue),
          reviews_count: numFrom(agg.reviewCount || agg.ratingCount),
          price_amount: numFrom(offers.price || offers.lowPrice || node.price),
          price_currency: strFrom(offers.priceCurrency || node.priceCurrency),
          price_period: S.detectPeriod(strFrom(offers.unitText || offers.referenceQuantity || "") || ""),
          price_raw: strFrom(offers.price || node.price),
          listing_url: strFrom(node.url || (offers && offers.url)),
          image_url: strFrom(node.image),
          listing_id: strFrom(node.sku || node.productID || node.identifier),
          section_title: null,
          extraction_tier: "json",
          extraction_source: "ld+json"
        };
        if (bag.vehicle_raw) out.push(bag);
      }

      // ItemList carries the section name for the items beneath it.
      var listName = strFrom(node.name);
      var items = node.itemListElement;
      if (items) {
        var arr = Array.isArray(items) ? items : [items];
        for (var k = 0; k < arr.length; k++) {
          var it = arr[k];
          var target = (isObj(it) && it.item) ? it.item : it;
          if (isObj(target)) { target.__sectionName = listName; stack.push(target); }
        }
      }
      var kk = Object.keys(node);
      for (var m = 0; m < kk.length; m++) {
        if (kk[m] === "itemListElement") continue;
        var vv = node[kk[m]];
        if (vv && typeof vv === "object") stack.push(vv);
      }
      if (node.__sectionName) {
        for (var z = out.length - 1; z >= 0 && z > out.length - 30; z--) {
          if (!out[z].section_title) { out[z].section_title = node.__sectionName; out[z].section_source = "ld+json-itemlist"; }
        }
      }
    }
  }

  function tier1(diag) {
    var bags = [];
    var blobs = collectStateBlobs(diag);
    for (var i = 0; i < blobs.length; i++) {
      var b = blobs[i];
      try {
        if (b.source === "ld+json") harvestJsonLd(b.value, bags);
        else harvestJson(b.value, b.source, bags, diag);
      } catch (e) {
        diag.warnings.push("tier1 " + b.source + " failed: " + e.message);
      }
      if (bags.length > MAX_ROWS) break;
    }
    return bags;
  }

  // =====================================================================
  // TIER 2 — SEMANTIC ATTRIBUTES
  // =====================================================================

  var MONEY_RE = /(?:[£$€¥₹₩₽₺₪₦฿]|\b(?:GBP|USD|EUR|CAD|AUD|CHF|SEK|PLN)\b)\s?\d/;
  var RATING_RE = /\b\d(?:[.,]\d{1,2})?\s*\(\s*\d+\s*\)|\bnew listing\b/i;

  function textOf(el) { return el ? S.clean(el.textContent) : null; }

  /**
   * textContent FUSES adjacent elements: <span>Model Y</span><span>2025</span>
   * <span>4.75 (5)</span> reads back as "Model Y20254.75 (5)", which destroys
   * the year and can invent numbers that were never on the page. Every parser
   * below therefore reads THIS, which joins text nodes with a space, never the
   * raw textContent.
   */
  function textWithBoundaries(el) {
    if (!el) return "";
    var parts = [], w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null), n, guard = 0;
    while ((n = w.nextNode()) && guard++ < 400) {
      var t = S.clean(n.nodeValue);
      if (t) parts.push(t);
    }
    return parts.join(" ");
  }

  function tier2(diag) {
    var bags = [];

    // --- 2a. microdata -------------------------------------------------
    try {
      var scopes = document.querySelectorAll('[itemscope][itemtype*="Car" i],[itemscope][itemtype*="Vehicle" i],[itemscope][itemtype*="Product" i]');
      diag.microdata_count = scopes.length;
      setCardSet(Array.prototype.slice.call(scopes));
      for (var i = 0; i < scopes.length; i++) {
        var el = scopes[i];
        function prop(n) {
          var p = el.querySelector('[itemprop="' + n + '"]');
          if (!p) return null;
          return S.clean(p.getAttribute("content") || p.getAttribute("href") || p.getAttribute("src") || p.textContent);
        }
        var bag = {
          vehicle_raw: prop("name") || prop("model"),
          make: prop("brand") || prop("manufacturer"),
          model: prop("model"),
          year: prop("vehicleModelDate") || prop("modelDate"),
          rating_raw: prop("ratingValue"),
          reviews_count: S.parseAmount(prop("reviewCount")),
          price_raw: prop("price"),
          price_currency: prop("priceCurrency"),
          listing_url: prop("url"),
          image_url: prop("image"),
          extraction_tier: "semantic",
          extraction_source: "microdata"
        };
        var pa = S.parseAmount(prop("price"));
        if (pa !== null) { bag.price_amount = pa; }
        if (bag.vehicle_raw) { attachSection(el, bag); bags.push(bag); }
      }
    } catch (e) { diag.warnings.push("tier2 microdata: " + e.message); }

    // --- 2b. data-testid. The most stable DOM hook in a React app, because
    //         the team's own tests break when it changes. ------------------
    try {
      var tid = document.querySelectorAll('[data-testid],[data-test-id],[data-test],[data-qa]');
      diag.testid_count = tid.length;
      var cards = [];
      for (var t = 0; t < tid.length; t++) {
        var e2 = tid[t];
        var name = (e2.getAttribute("data-testid") || e2.getAttribute("data-test-id") ||
                    e2.getAttribute("data-test") || e2.getAttribute("data-qa") || "");
        if (!/vehicle|listing|card|search-?result|result-?item|tile/i.test(name)) continue;
        var txt = textWithBoundaries(e2);
        if (!MONEY_RE.test(txt)) continue;         // a card without a price is not a card
        if (txt.length > 600) continue;            // that's a container, not a card
        cards.push(e2);
      }
      cards = dropNestedElements(cards);
      setCardSet(cards);
      for (var c = 0; c < cards.length; c++) {
        var b = bagFromCardElement(cards[c], "semantic", "data-testid");
        if (b) bags.push(b);
      }
    } catch (e) { diag.warnings.push("tier2 data-testid: " + e.message); }

    // --- 2c. aria-label on listing links -------------------------------
    if (!bags.length) {
      try {
        var links = document.querySelectorAll("a[aria-label]");
        var ariaCards = [], ariaLabels = [];
        for (var l = 0; l < links.length; l++) {
          var a = links[l];
          var label = S.clean(a.getAttribute("aria-label"));
          if (!label || !S.looksLikeVehicleName(label)) continue;
          var card = cardAncestorOf(a);
          if (!card || ariaCards.indexOf(card) !== -1) continue;
          ariaCards.push(card); ariaLabels.push(label);
        }
        setCardSet(ariaCards);
        for (var l2 = 0; l2 < ariaCards.length; l2++) {
          var bb = bagFromCardElement(ariaCards[l2], "semantic", "aria-label");
          if (bb) { if (!bb.vehicle_raw) bb.vehicle_raw = ariaLabels[l2]; bags.push(bb); }
        }
      } catch (e) { diag.warnings.push("tier2 aria-label: " + e.message); }
    }

    return bags;
  }

  // =====================================================================
  // TIER 3 — HEURISTIC DOM
  // =====================================================================

  /**
   * Find repeated card-shaped subtrees. A card is the smallest element that
   * contains a link, a price, and one of {year, rating, image}. We then group
   * candidates by structural signature and keep the repeated ones, which is
   * what separates a grid of listings from a one-off promo tile.
   */
  function tier3(diag) {
    var bags = [];
    try {
      var anchors = document.querySelectorAll("a[href]");
      diag.anchor_count = anchors.length;
      var candidates = [];
      for (var i = 0; i < anchors.length; i++) {
        var card = cardAncestorOf(anchors[i]);
        if (card && candidates.indexOf(card) === -1) candidates.push(card);
        if (candidates.length > 400) break;
      }
      candidates = dropNestedElements(candidates);
      diag.heuristic_candidates = candidates.length;

      // Group by shape; repeated shapes are the real card set.
      var groups = Object.create(null);
      for (var j = 0; j < candidates.length; j++) {
        var sig = signatureOf(candidates[j]);
        (groups[sig] = groups[sig] || []).push(candidates[j]);
      }
      var keys = Object.keys(groups).sort(function (a, b) { return groups[b].length - groups[a].length; });
      var chosen = [];
      for (var k = 0; k < keys.length; k++) {
        if (groups[keys[k]].length >= 2) chosen = chosen.concat(groups[keys[k]]);
      }
      if (!chosen.length) chosen = candidates;      // nothing repeated; take what we have
      diag.heuristic_shape_groups = keys.length;
      setCardSet(chosen);

      for (var c = 0; c < chosen.length && bags.length < MAX_ROWS; c++) {
        var b = bagFromCardElement(chosen[c], "heuristic", "heuristic-dom");
        if (b) bags.push(b);
      }
    } catch (e) { diag.warnings.push("tier3: " + e.message); }
    return bags;
  }

  /** Walk up from a link to the smallest enclosing card-shaped element. */
  function cardAncestorOf(el) {
    var node = el, hops = 0;
    while (node && hops < 7) {
      var txt = textWithBoundaries(node);
      if (txt.length > 20 && txt.length < 500 && MONEY_RE.test(txt)) {
        var hasImg = !!node.querySelector("img,[style*='background-image']");
        if (hasImg || RATING_RE.test(txt) || S.parseYear(txt) !== null) return node;
      }
      node = node.parentElement; hops++;
    }
    return null;
  }

  /** Remove elements that contain another element in the same list. */
  function dropNestedElements(list) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var contained = false;
      for (var j = 0; j < list.length; j++) {
        if (i !== j && list[i].contains(list[j])) { contained = true; break; }
      }
      if (!contained) out.push(list[i]);
    }
    return out;
  }

  /** Structural fingerprint, deliberately class-name-free. */
  function signatureOf(el) {
    var parts = [el.tagName, el.children.length];
    for (var i = 0; i < el.children.length && i < 6; i++) parts.push(el.children[i].tagName);
    parts.push(el.querySelectorAll("img").length, el.querySelectorAll("a").length);
    return parts.join("|");
  }

  /**
   * Read one card element. Shared by tiers 2 and 3 — the difference between
   * them is how the element was FOUND, not how it is read.
   */
  function bagFromCardElement(el, tier, source) {
    var text = textWithBoundaries(el);
    if (!text) return null;

    var link = el.matches && el.matches("a[href]") ? el : el.querySelector("a[href]");
    var href = link ? link.getAttribute("href") : null;

    // --- image: src, then srcset's first URL, then a CSS background --------
    var imgEl = el.querySelector("img");
    var image = null;
    if (imgEl) {
      image = imgEl.getAttribute("src") || imgEl.getAttribute("data-src");
      if (!image) {
        var ss = imgEl.getAttribute("srcset");
        if (ss) image = S.clean(ss.split(",")[0].split(/\s+/)[0]);
      }
    }
    if (!image) {
      var bgEl = el.querySelector("[style*='background-image']") || el;
      var st = bgEl.getAttribute && bgEl.getAttribute("style");
      var bm = st && st.match(/url\((['"]?)(.*?)\1\)/);
      if (bm) image = bm[2];
    }

    // --- price: gather EVERY money mention in the card, in document order,
    //     and let parsePriceGroup decide which is the rate and which the total
    var moneyBits = [];
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    var tn;
    while ((tn = walker.nextNode())) {
      var t = S.clean(tn.nodeValue);
      if (t && MONEY_RE.test(t)) moneyBits.push(t);
      if (moneyBits.length > 8) break;
    }
    var priceText = moneyBits.join("  ");
    if (!priceText) {
      var pm = text.match(/(?:[£$€¥₹₩₽₺₪₦฿]\s?\d[\d.,\s]*)(?:\s*\/\s*\w+|\s+\w+)?/g);
      if (pm) priceText = pm.join("  ");
    }

    // --- rating ---------------------------------------------------------
    var ratingText = null;
    var rm = text.match(/\d(?:[.,]\d{1,2})?\s*\(\s*\d[\d,]*\s*\)/);
    if (rm) ratingText = rm[0];
    else if (/new listing/i.test(text)) ratingText = "New listing";
    else {
      var rm2 = text.match(/\d(?:[.,]\d{1,2})?\s*[·•]\s*\d[\d,]*\s*(?:trips?|reviews?)/i);
      if (rm2) ratingText = rm2[0];
    }

    // --- vehicle name: try the most explicit sources first ---------------
    var name = null;
    var named = el.querySelector('[data-testid*="name" i],[data-testid*="title" i],[data-testid*="make" i]');
    if (named) name = textOf(named);
    if (!name) { var h = el.querySelector("h1,h2,h3,h4,h5,[role='heading']"); if (h) name = textOf(h); }
    if (!name && link && link.getAttribute("aria-label")) name = S.clean(link.getAttribute("aria-label"));
    if (!name && imgEl && imgEl.getAttribute("alt")) name = S.clean(imgEl.getAttribute("alt"));
    if (!name) {
      // Fall back to the first text node that is neither price nor rating.
      var w2 = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null), n2, guard = 0;
      while ((n2 = w2.nextNode()) && guard++ < 60) {
        var c2 = S.clean(n2.nodeValue);
        if (!c2 || MONEY_RE.test(c2) || RATING_RE.test(c2)) continue;
        if (S.looksLikeVehicleName(c2)) { name = c2; break; }
      }
    }
    if (name) name = name.replace(/\s*\b(new listing)\b\s*/i, " ").trim();
    if (!name) return null;

    var bag = {
      vehicle_raw: name,
      year: S.parseYear(text),
      rating_raw: ratingText,
      price_raw: priceText || null,
      listing_url: href,
      image_url: image,
      extraction_tier: tier,
      extraction_source: source
    };
    attachSection(el, bag);
    return bag;
  }

  /**
   * The section heading is the nearest heading BEFORE the card in document
   * order. This is how "Monthly luxury car rentals in Oxford" — which lives on
   * the carousel, not the card — reaches the row.
   */
  var _headings = null;
  var _cardSet = [];

  /**
   * Tell the heading index which elements are the actual cards on this page.
   * Used to distinguish a SECTION heading from a CARD's own vehicle title.
   *
   * An earlier version asked "is this heading inside anything card-shaped?",
   * which on a compact page matched <body> itself and threw away every
   * heading. Excluding against the real, already-selected card list is exact.
   */
  function setCardSet(list) { _cardSet = list || []; _headings = null; }

  function insideCardSet(el) {
    for (var i = 0; i < _cardSet.length; i++) {
      if (_cardSet[i] !== el && _cardSet[i].contains(el)) return true;
    }
    return false;
  }

  function headingIndex() {
    if (_headings) return _headings;
    _headings = [];
    var hs = document.querySelectorAll("h1,h2,h3,h4,[role='heading']");
    for (var i = 0; i < hs.length; i++) {
      var t = S.clean(hs[i].textContent);
      if (!t || t.length <= 2 || t.length >= 140) continue;
      // A heading INSIDE a card is that card's own vehicle title. Treating it
      // as a section heading makes every card inherit the previous card's name
      // as its section, which is both wrong and very convincing-looking.
      if (insideCardSet(hs[i])) continue;
      // A heading wrapped in the listing link is that listing's title. Section
      // headings are not clickable through to a single car.
      if (hs[i].closest && hs[i].closest("a[href]")) continue;
      _headings.push({ el: hs[i], text: t });
    }
    return _headings;
  }

  function attachSection(el, bag) {
    try {
      var hs = headingIndex(), best = null;
      for (var i = 0; i < hs.length; i++) {
        if (hs[i].el.contains(el)) continue;                       // an ancestor heading is not "before"
        var rel = el.compareDocumentPosition(hs[i].el);
        if (rel & Node.DOCUMENT_POSITION_PRECEDING) best = hs[i];   // keep the LAST preceding one
      }
      if (!best) return;
      bag.section_title = best.text;
      bag.section_source = "dom-heading";

      // Subtitle: the short line that follows the heading and is not a card.
      var sib = best.el.nextElementSibling;
      var hops = 0;
      while (sib && hops++ < 3) {
        var st = textWithBoundaries(sib);
        if (st && st.length < 120 && !MONEY_RE.test(st) && sib.querySelectorAll("a").length === 0) {
          bag.section_subtitle = st; break;
        }
        sib = sib.nextElementSibling;
      }
      // Deliberately NO broader fallback here. An earlier version searched the
      // heading's parent for any <p>/<span>, which happily returned the first
      // card's vehicle name as the "section subtitle". A null subtitle is a
      // fact; a wrong one is a lie that survives into the operator's sheet.
    } catch (e) { /* section is optional; never fail the row over it */ }
  }

  // =====================================================================
  // ORCHESTRATION
  // =====================================================================

  /**
   * Run the tiers in order and stop at the first that produces a real result.
   *
   * ONE deliberate exception to tier purity: if the winning tier produced rows
   * with no section, we let the DOM supply the section — it is frequently the
   * only place a section heading exists. That borrowing is recorded per row in
   * `section_source`, so provenance stays honest rather than implied.
   */
  function run() {
    var startedAt = Date.now();
    var diag = { sources: [], warnings: [], tiers: [] };
    var loc = S.parseLocale(location.href, document.documentElement.getAttribute("lang"));
    var ctx = { baseUrl: location.href, currencyHint: null };

    var tiers = [
      { name: "json",      fn: tier1 },
      { name: "semantic",  fn: tier2 },
      { name: "heuristic", fn: tier3 }
    ];

    var rows = [], winner = null;
    for (var i = 0; i < tiers.length; i++) {
      var bags = [];
      try { bags = tiers[i].fn(diag) || []; }
      catch (e) { diag.warnings.push(tiers[i].name + " threw: " + e.message); }

      var built = [];
      for (var b = 0; b < bags.length; b++) {
        var row = S.buildRow(bags[b], ctx);
        if (S.isUsableRow(row)) built.push(row);
      }
      built = S.dedupe(built);
      diag.tiers.push({ tier: tiers[i].name, candidates: bags.length, usable_rows: built.length });

      if (built.length >= MIN_ROWS_TO_ACCEPT_TIER || (built.length && i === tiers.length - 1)) {
        rows = built; winner = tiers[i].name; break;
      }
      if (built.length && !rows.length) { rows = built; winner = tiers[i].name; }
    }

    // Section back-fill from the DOM (see the note above).
    var backfilled = 0;
    if (rows.length && winner !== "heuristic") {
      for (var r = 0; r < rows.length; r++) {
        if (rows[r].section_title || !rows[r].listing_url) continue;
        try {
          var a = document.querySelector('a[href$="' + cssEscapeTail(rows[r].listing_url) + '"]');
          if (a) {
            var tmp = {};
            attachSection(a, tmp);
            if (tmp.section_title) {
              var sec = S.parseSection(tmp.section_title, tmp.section_subtitle);
              rows[r].section_title = sec.title;
              rows[r].section_subtitle = sec.subtitle;
              rows[r].section_location = sec.location;
              rows[r].section_category = sec.category;
              rows[r].section_source = "dom-heading (back-filled)";
              backfilled++;
            }
          }
        } catch (e) { /* selector-hostile URL; skip */ }
      }
    }

    for (var n = 0; n < rows.length; n++) rows[n].row_index = n + 1;

    var meta = {
      scraped_at_iso: new Date().toISOString(),
      scraped_at_local: new Date().toString(),
      page_url: location.href,
      page_title: document.title || null,
      locale: loc.locale, country: loc.country, language: loc.language,
      cards_found: rows.length,
      extraction_tier_won: winner,
      tiers_attempted: diag.tiers,
      state_sources: diag.sources,
      inline_script_count: diag.inline_script_count || 0,
      microdata_elements: diag.microdata_count || 0,
      testid_elements: diag.testid_count || 0,
      anchors_scanned: diag.anchor_count || 0,
      heuristic_candidates: diag.heuristic_candidates || 0,
      sections_backfilled_from_dom: backfilled,
      duration_ms: Date.now() - startedAt,
      warnings: diag.warnings.concat(collectRowWarnings(rows)),
      extension_version: "1.0.0"
    };

    for (var d = 0; d < rows.length; d++) delete rows[d].__warnings;
    return { ok: true, rows: rows, meta: meta };
  }

  function cssEscapeTail(url) {
    try { return new URL(url).pathname.replace(/"/g, ""); } catch (e) { return String(url).replace(/"/g, ""); }
  }

  function collectRowWarnings(rows) {
    var counts = Object.create(null);
    for (var i = 0; i < rows.length; i++) {
      var w = rows[i].__warnings || [];
      for (var j = 0; j < w.length; j++) counts[w[j]] = (counts[w[j]] || 0) + 1;
    }
    return Object.keys(counts).map(function (k) { return counts[k] + " row(s): " + k; });
  }

  NS.extract = { run: run, tier1: tier1, tier2: tier2, tier3: tier3, bagFromCardElement: bagFromCardElement };
})();
