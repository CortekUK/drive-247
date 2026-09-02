/* Generates fixture-flight.html — reproduces Turo's REAL App Router payload
 * shape as documented from the Wayback captures of turo.com/gb/en:
 *   self.__next_f.push([1,"<flight chunk>"])
 *   section = { title, deepLink, estimatedQuotes:{"<id>":{...}}, vehicles:[...] }
 * Deliberately includes every quirk the research called out. */
const fs = require("fs");

function veh(o) {
  return {
    id: o.id, year: o.year, type: o.type, tags: [],
    availability: "AVAILABLE",
    avgDailyPrice: { amount: o.daily, currency: o.cur },
    completedTrips: o.trips, hostId: o.hostId,
    images: [{ originalImageUrl: o.img + ".heic",
               // Turo MISSPELLS this key. Checking only "resizable" loses every image.
               resizeableUrlTemplate: o.img + ".{width}x{height}.jpg" }],
    isAllStarHost: !!o.allStar, isFavoritedBySearcher: false,
    isNewListing: !!o.isNew, rating: o.rating,
    location: { city: o.city, country: o.country, state: o.region || null },
    make: o.make, model: o.model, seoCategory: o.seo || null
  };
}
function quote(o) {
  const q = {
    pricingDisplay: { carousel: { value: o.carousel } },
    priceDisplayType: o.basis,
    vehicleDailyPrice: { amount: o.daily, currency: o.cur }
  };
  if (o.total != null) q.totalTripPrice = { amount: o.total, currency: o.cur };
  if (o.savings) q.discountSavingsText = o.savings;
  return q;
}

// --- GB section: monthly pricing, a discount badge, an all-star host --------
const s1v = [
  veh({ id: 3524295, year: 2015, make: "Volkswagen", model: "Tiguan", type: "SUV",
        daily: 41.2, cur: "GBP", trips: 59, rating: 4.81, hostId: 22110011,
        city: "Edinburgh", country: "GB", img: "https://img.turo.com/a1", allStar: true }),
  // isNewListing:false BUT rating null and 0 trips — the site still renders
  // "New listing". Trusting the flag alone leaves a blank rating column.
  veh({ id: 3524296, year: 2016, make: "Honda", model: "HR-V", type: "SUV",
        daily: 33.0, cur: "GBP", trips: 0, rating: null, hostId: 22110012,
        city: "Edinburgh", country: "GB", img: "https://img.turo.com/a2", isNew: false })
];
const s1q = {
  // string keys; vehicles[].id is a NUMBER — the join must coerce.
  "3524295": quote({ carousel: "£1,014/month", basis: "MONTHLY", daily: 41.2,
                     cur: "GBP", savings: "Save £811/mo" }),
  "3524296": quote({ carousel: "£812/month", basis: "MONTHLY", daily: 33.0, cur: "GBP" })
};

// --- US section: doubled currency symbol, trip totals ------------------------
const s2v = [
  veh({ id: 998877, year: 2025, make: "Kia", model: "Niro EV", type: "CAR",
        daily: 35.5, cur: "USD", trips: 16, rating: 5, hostId: 5150,
        city: "Las Vegas", country: "US", region: "NV",
        img: "https://img.turo.com/b1" })
];
const s2q = {
  // US flight data DOUBLES the symbol: "$$143 for 3 days".
  "998877": quote({ carousel: "$$143 for 3 days", basis: "TOTAL",
                    daily: 35.5, cur: "USD", total: 143 })
};

const payload = [
  { title: "Monthly SUV rentals in Edinburgh",
    subtitle: "Average monthly prices",
    deepLink: "/gb/en/suv-rental/united-kingdom/edinburgh",
    estimatedQuotes: s1q, vehicles: s1v },
  { title: "Car rentals in Las Vegas",
    subtitle: "Average daily prices for a 3-day trip",
    deepLink: "/us/en/car-rental/united-states/las-vegas",
    estimatedQuotes: s2q, vehicles: s2v }
];

// Flight chunks are JSON *strings* pushed in pieces. Split mid-payload so the
// test proves the extractor concatenates chunks before mining them.
const blob = "2:" + JSON.stringify({ sections: payload });
const cut = Math.floor(blob.length / 2);
const chunks = [blob.slice(0, cut), blob.slice(cut)];

const scripts = chunks
  .map((c) => `<script>self.__next_f.push([1,${JSON.stringify(c)}])</script>`)
  .join("\n");

fs.writeFileSync(__dirname + "/fixture-flight.html", `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Turo | Car rental</title></head>
<body>
<script>self.__next_f=self.__next_f||[]</script>
${scripts}
<!-- Only ONE listing is rendered in the DOM while the JSON carries three.
     Carousels lazy-render; a DOM-only scraper silently under-reports. -->
<h2>Monthly SUV rentals in Edinburgh</h2>
<a data-testid="vehicle-card-link-box"
   href="/gb/en/suv-rental/united-kingdom/edinburgh/volkswagen/tiguan/3524295">
  <img alt="Volkswagen Tiguan 2015 in Edinburgh" src="https://img.turo.com/a1.jpg">
  <p>Volkswagen Tiguan</p><p>2015</p>
  <div data-testid="vehicle-discount-and-price">Save £811/mo £1,014/month</div>
</a>
</body></html>
`);
console.log("wrote fixture-flight.html");
