import { ArrowRight, ArrowUpRight, ChevronDown, Copy, Download, MoreHorizontal, Plus } from "lucide-react";
import { PortalShell } from "../screens";
import "./finances.css";

/*
 * Finances — /finances for a v2 tenant, as the portal renders it first.
 *
 * Mirrors, in apps/portal/src:
 *   app/(dashboard)/finances/page.tsx            the route (v2 area `finances`)
 *   components/finances-v2/finances-view.tsx     header: "Finances", subtitle, actions slot
 *   components/finances-v2/invoices-tab.tsx      Export CSV icon + "Record Payment"
 *                                                (FINANCES_PREVIEW is false), hero row, table
 *   components/finances-v2/finances-overview.tsx Invoiced / Collected metric, Auto-charge card
 *   components/finances-v2/invoice-payments-table.tsx  columns, AmountSum, row actions
 *   components/finances-v2/finance-data.ts       totals, payment state, due state, entity label
 *   components/finances-v2/finance-mock.ts       the rows (SPECS) and their "today" (Sep 28 2026)
 *   components/shared/hero-chart-v2.tsx          HeroChart + HeroRow (30d window, monotone lines)
 *   components/shared/featured-deck-view-v2.tsx  FeaturedCardShell / FeaturedCardFace
 *   components/shared/header-icon-button-v2.tsx  HEADER_ACTIONS_V2, HEADER_PRIMARY_V2, icon pill
 *   components/shared/list-table-v2.tsx          ListTable / ListHead / ListCell / ListFooter
 *   lib/featured-cards.ts                        the `auto-charge` card copy
 *   lib/hero-series.ts                           flowSeries (running totals, previous window)
 *
 * Every figure below is computed from finance-mock.ts the way the portal
 * computes it, with "today" = the mock's TODAY_ISO (2026-09-28).
 */

/* ---- Hero chart: flowSeries("30d") over the mock, Aug 30 – Sep 28 -------- */

// Running totals per day. Invoiced: each invoice's total on its invoice date
// (the cancelled INV-1045-01 included, as finances-overview.tsx counts it).
// Collected: allocations of landed payments, net of refunds, on the day paid.
const INVOICED = [0, 0, 584.08, 584.08, 980.98, 980.98, 1298.5, 1298.5, 1298.5, 1525.3, 1525.3, 1525.3, 1903.3, 1903.3, 1903.3, 2495.92, 2495.92, 2495.92, 2495.92, 2915.92, 2915.92, 2970.92, 2970.92, 2970.92, 2970.92, 2970.92, 2970.92, 3771.52, 3771.52, 3771.52];
const COLLECTED = [0, 0, 584.08, 584.08, 584.08, 584.08, 901.6, 901.6, 901.6, 1001.6, 1001.6, 1128.4, 1128.4, 1148.4, 1148.4, 1448.4, 1598.4, 1598.4, 1598.4, 1598.4, 1598.4, 1598.4, 1598.4, 1798.4, 1798.4, 1798.4, 1798.4, 1798.4, 1798.4, 1798.4];
// The previous 30 days (Jul 31 – Aug 29): INV-F-0011 on Aug 2, INV-1042-01 on Aug 20.
const PREVIOUS = [0, 0, 80, 80, 80, 80, 80, 80, 80, 80, 80, 80, 80, 80, 80, 80, 80, 80, 80, 80, 663.5, 663.5, 663.5, 663.5, 663.5, 663.5, 663.5, 663.5, 663.5, 663.5];

// ChartContainer h-[140px] across the hero row's three columns (680px at 1280),
// margin { top: 6, right: 4, bottom: 2, left: 4 }. The hidden YAxis domain is
// [0, max(1, dataMax)] — recharts 2.15 only "nices" an `auto` domain, so the
// top of the plot is exactly the highest value, $3,771.52.
const CW = 680;
const CH = 140;
const M = { top: 6, right: 4, bottom: 2, left: 4 };
const Y_MAX = 3771.52;

/** Recharts `type="monotone"` is d3's curveMonotoneX; the same maths, as a path. */
function monotoneX(values: number[]) {
  const pw = CW - M.left - M.right;
  const ph = CH - M.top - M.bottom;
  const x = values.map((_, i) => M.left + (i / (values.length - 1)) * pw);
  const y = values.map((v) => M.top + ph - (v / Y_MAX) * ph);
  const sign = (n: number) => (n < 0 ? -1 : 1);
  const n = values.length;
  const t = new Array<number>(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    const h0 = x[i] - x[i - 1];
    const h1 = x[i + 1] - x[i];
    const s0 = (y[i] - y[i - 1]) / h0;
    const s1 = (y[i + 1] - y[i]) / h1;
    const p = (s0 * h1 + s1 * h0) / (h0 + h1);
    t[i] = (sign(s0) + sign(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p)) || 0;
  }
  t[0] = (3 * (y[1] - y[0])) / (x[1] - x[0]) / 2 - t[1] / 2;
  t[n - 1] = (3 * (y[n - 1] - y[n - 2])) / (x[n - 1] - x[n - 2]) / 2 - t[n - 2] / 2;
  const f = (v: number) => Math.round(v * 100) / 100;
  let d = `M${f(x[0])},${f(y[0])}`;
  for (let i = 0; i < n - 1; i++) {
    const dx = (x[i + 1] - x[i]) / 3;
    d += `C${f(x[i] + dx)},${f(y[i] + dx * t[i])},${f(x[i + 1] - dx)},${f(y[i + 1] - dx * t[i + 1])},${f(x[i + 1])},${f(y[i + 1])}`;
  }
  return d;
}

const PATH_PREVIOUS = monotoneX(PREVIOUS);
const PATH_COLLECTED = monotoneX(COLLECTED);
const PATH_INVOICED = monotoneX(INVOICED);

/* ---- Rows: finance-mock.ts SPECS, newest invoice date first -------------- */

type Status = "paid" | "part" | "unpaid" | "cancelled";
type Row = {
  number: string;
  entity: string;
  ref: string;
  customer: string;
  due: string;
  overdue?: boolean;
  total: string;
  paid: string;
  remaining: string;
  status: Status;
};

const ROWS: Row[] = [
  { number: "INV-1043-01", entity: "Rental", ref: "R-1043", customer: "Priya Raman", due: "Oct 3, 2026", total: "$800.60", paid: "$0.00", remaining: "$800.60", status: "unpaid" },
  { number: "INV-F-0012", entity: "Fine", ref: "TOLL-55190", customer: "Nina Kowalski", due: "Oct 4, 2026", total: "$55.00", paid: "$0.00", remaining: "$55.00", status: "unpaid" },
  { number: "INV-C-0007", entity: "Customer", ref: "C-0046", customer: "Camille Duval", due: "Oct 18, 2026", total: "$420.00", paid: "$200.00", remaining: "$220.00", status: "part" },
  { number: "INV-1044-01", entity: "Rental", ref: "R-1044", customer: "Diego Santoro", due: "Sep 14, 2026", overdue: true, total: "$592.62", paid: "$300.00", remaining: "$292.62", status: "part" },
  { number: "INV-1041-03", entity: "Rental", ref: "R-1041 · Ext 2", customer: "Nina Kowalski", due: "Sep 11, 2026", overdue: true, total: "$378.00", paid: "$170.00", remaining: "$208.00", status: "part" },
  { number: "INV-1041-02", entity: "Rental", ref: "R-1041 · Ext 1", customer: "Nina Kowalski", due: "Sep 8, 2026", total: "$226.80", paid: "$226.80", remaining: "$0.00", status: "paid" },
  { number: "INV-1046-01", entity: "Rental", ref: "R-1046", customer: "Camille Duval", due: "Sep 5, 2026", total: "$317.52", paid: "$317.52", remaining: "$0.00", status: "paid" },
  { number: "INV-1045-01", entity: "Rental", ref: "R-1045", customer: "Theo Okafor", due: "Sep 3, 2026", total: "$396.90", paid: "$396.90", remaining: "$0.00", status: "cancelled" },
  { number: "INV-1041-01", entity: "Rental", ref: "R-1041", customer: "Nina Kowalski", due: "Sep 1, 2026", total: "$584.08", paid: "$584.08", remaining: "$0.00", status: "paid" },
  { number: "INV-1042-01", entity: "Rental", ref: "R-1042", customer: "Marcus Bellweather", due: "Aug 20, 2026", total: "$583.50", paid: "$583.50", remaining: "$0.00", status: "paid" },
  { number: "INV-F-0011", entity: "Fine", ref: "PCN-88213", customer: "Marcus Bellweather", due: "Aug 16, 2026", overdue: true, total: "$80.00", paid: "$0.00", remaining: "$80.00", status: "unpaid" },
];

/** SumWidths: the longest formatted figure per slot, in `ch` ("$800.60", "$584.08", "$800.60"). */
const W_TOTAL = 7;
const W_PAID = 7;
const W_REMAINING = 7;

function Op({ children }: { children: string }) {
  return <span className="op">{children}</span>;
}

function AmountSum({ row }: { row: Row }) {
  return (
    <span className="sum">
      {row.status === "cancelled" && <span className="strike" />}
      <span className="fig" style={{ minWidth: `${W_TOTAL}ch` }}>
        {row.total}
      </span>
      <Op>−</Op>
      <span className="fig" style={{ minWidth: `${W_PAID}ch` }}>
        {row.paid}
      </span>
      <Op>=</Op>
      <span className={`ans ${row.status}${row.remaining === "$0.00" ? " settled" : ""}`} style={{ minWidth: `${W_REMAINING}ch` }}>
        {row.remaining}
      </span>
    </span>
  );
}

export function FinancesScreen() {
  return (
    <PortalShell active="Finances" search={{ scopeLabel: "Invoices", placeholder: "Search by invoice #, customer, or vehicle…" }}>
      <div className="scr-fin">
        {/* finances-view.tsx — the header line */}
        <div className="head">
          <div className="titles">
            <h1>Finances</h1>
            <p>Every invoice, the payments made against it, and a receipt for each</p>
          </div>
          <div className="acts">
            <span className="hib" aria-label="Export CSV">
              <Download />
            </span>
            <span className="hpb">
              <Plus />
              Record Payment
            </span>
          </div>
        </div>

        <div className="ftab">
          {/* hero-chart-v2.tsx HeroRow */}
          <div className="hero">
            <section className="chart">
              <div className="cap">
                <div className="r1">
                  <span className="metric">Invoiced</span>
                  <span className="range">
                    Last 30 days
                    <ChevronDown />
                  </span>
                </div>
                <div className="r2">
                  <div className="num">
                    <span className="big">$3,771.52</span>
                    <span className="chip">
                      <ArrowUpRight />
                      468%
                    </span>
                  </div>
                  <div className="legend">
                    <span>
                      <i className="sw cur" />
                      Invoiced
                    </span>
                    <span>
                      <i className="sw sec" />
                      Collected
                      <b>$1,798.40</b>
                    </span>
                    <span>
                      <i className="sw prev" />
                      Previous 30 days
                      <b>$663.50</b>
                    </span>
                  </div>
                </div>
              </div>
              <svg className="plot" viewBox={`0 0 ${CW} ${CH}`} width={CW} height={CH} aria-hidden>
                <line x1={M.left} x2={CW - M.right} y1={CH - M.bottom} y2={CH - M.bottom} stroke="#e5e5e5" />
                <path d={PATH_PREVIOUS} fill="none" stroke="#737373" strokeOpacity={0.6} strokeWidth={2} strokeDasharray="2 4" strokeLinecap="round" />
                <path d={PATH_COLLECTED} fill="none" stroke="rgb(68 45 215 / 0.4)" strokeWidth={2} />
                <path d={PATH_INVOICED} fill="none" stroke="#442dd7" strokeWidth={2.5} />
              </svg>
            </section>

            {/* featured-deck-view-v2.tsx — the one card, lib/featured-cards.ts `auto-charge` */}
            <section className="feat">
              <div className="act">
                <h3>Auto-charge</h3>
                <div className="foot">
                  <p>Bill saved cards automatically</p>
                  <span className="open">
                    Open
                    <ArrowRight />
                  </span>
                </div>
              </div>
            </section>
          </div>

          {/* invoice-payments-table.tsx on list-table-v2.tsx */}
          <div className="card">
            <div className="scroll">
              <table>
                <colgroup>
                  <col style={{ width: "14%" }} />
                  <col style={{ width: "10%" }} />
                  <col style={{ width: "13%" }} />
                  <col style={{ width: "15%" }} />
                  <col style={{ width: "11%" }} />
                  <col style={{ width: "29%" }} />
                  <col style={{ width: "8%" }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>Invoice #</th>
                    <th>Entity</th>
                    <th>Entity ref</th>
                    <th>Customer</th>
                    <th>Due date</th>
                    <th className="r">
                      <span className="sumh">
                        <span style={{ minWidth: `${(W_TOTAL * 13) / 11}ch` }}>Total</span>
                        <Op>−</Op>
                        <span style={{ minWidth: `${(W_PAID * 13) / 11}ch` }}>Paid</span>
                        <Op>=</Op>
                        <span style={{ minWidth: `${(W_REMAINING * 15) / 11}ch` }}>Remaining</span>
                      </span>
                    </th>
                    <th className="r" />
                  </tr>
                </thead>
                <tbody>
                  {ROWS.map((row) => (
                    <tr key={row.number}>
                      <td>
                        <span className="idw">
                          <span className="id">{row.number}</span>
                          <span className="copy">
                            <Copy />
                          </span>
                        </span>
                      </td>
                      <td>
                        <span className="chipm">{row.entity}</span>
                      </td>
                      <td>
                        <span className="txt tnum">{row.ref}</span>
                      </td>
                      <td>
                        <span className="txt">{row.customer}</span>
                      </td>
                      <td className="tnum">
                        <span className={`due${row.status === "cancelled" ? " muted" : row.overdue ? " red" : ""}`}>{row.due}</span>
                      </td>
                      <td className="r">
                        <AmountSum row={row} />
                      </td>
                      <td className="r">
                        <span className="rowact">
                          <MoreHorizontal />
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="lfoot">All 11 invoices shown</div>
        </div>
      </div>
    </PortalShell>
  );
}
