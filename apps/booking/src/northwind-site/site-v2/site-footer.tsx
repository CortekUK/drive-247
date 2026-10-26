import Link from 'next/link';
import { Mail, MapPin, Phone } from 'lucide-react-nw';

import { loadFleetSeed } from '@nw/components/fleet/fleet-seed';
import { DEFAULT_SITE_CONTACT, DEFAULT_SITE_SOCIAL } from '@nw/lib/cms/defaults';
import { getTenantSlug, loadBlogEnabled, loadSection } from '@nw/lib/cms/server';
import { socialLinks } from '@nw/lib/cms/social';
import { FOOTER_LINKS } from '@nw/lib/constants';
import { cn } from '@nw/lib/utils';

import { SITE_EDGE } from './kit';

/**
 * Northwind booking site v2 — the footer. Server component, like v1's
 * components/layout/footer.tsx, and fed by the same reads: `site-settings /
 * contact` for the operator's details, `site-settings / social` for their
 * networks, the /fleet loader for the "Our cars" column, and the blog switch.
 * Every column that would be empty is left out rather than shown blank.
 *
 * The page ends on a deep slab of the operator's own colour (`nw-footer` in
 * styles/site.css mixes their brand with near-black, so every tenant gets
 * theirs), and its top edge is a skyline in the same colour — tall towers at
 * both edges stepping down to an open middle with the road, two cars in the
 * brand colour and the pin — so the site's last picture is the drive. Columns are as wide as the navbar (`SITE_EDGE`).
 */

/** How many of the operator's cars the footer lists (v1's number). */
const FOOTER_VEHICLES = 5;

const LINK =
  'block w-fit max-w-full text-[14px] leading-5 text-white/65 transition-colors duration-200 hover:text-white focus-visible:text-white focus-visible:outline-none motion-reduce:transition-none';
const HEADING = 'text-[14px] font-bold text-white';

export async function SiteV2Footer({ tenantName }: { tenantName: string | null }) {
  const slug = await getTenantSlug();
  const [contact, social, fleet, blogEnabled] = await Promise.all([
    loadSection('site-settings', 'contact', DEFAULT_SITE_CONTACT),
    loadSection('site-settings', 'social', DEFAULT_SITE_SOCIAL),
    slug ? loadFleetSeed(slug) : Promise.resolve(null),
    loadBlogEnabled(),
  ]);

  const vehicles = (fleet?.vehicles ?? []).slice(0, FOOTER_VEHICLES);

  const email = contact.email.trim();
  /* `phone_display` is what a visitor reads; `phone` is the dialable one. */
  const phone = contact.phone_display.trim() || contact.phone.trim();
  const dial = (contact.phone.trim() || contact.phone_display.trim()).replace(/[^+\d]/g, '');
  const address = [
    contact.address_line1,
    contact.address_line2,
    [contact.city, contact.state, contact.zip].map((part) => part.trim()).filter(Boolean).join(', '),
    contact.country,
  ]
    .map((part) => part.trim())
    .filter(Boolean);
  const mapsUrl = contact.google_maps_url.trim();
  /* Configured networks only. `socialLinks` falls back to `#` placeholders for
     the v1 hero rows; a footer icon that goes nowhere is a dead link, so v2
     drops them. */
  const socials = socialLinks(social).filter((link) => link.href !== '#');

  /* Blog joins the Company column when the operator has it switched on. */
  const columns: Record<string, ReadonlyArray<{ href: string; label: string }>> = {
    ...FOOTER_LINKS,
    Company: blogEnabled ? [...FOOTER_LINKS.Company, { href: '/blog', label: 'Blog' }] : FOOTER_LINKS.Company,
  };

  const hasContact = email !== '' || phone !== '' || address.length > 0;

  return (
    <footer className="nw-footer relative z-[1] mt-16 md:mt-24">
      <Skyline />
      <div className={cn(SITE_EDGE, 'bg-[var(--nw-foot)] pb-8 pt-10 md:pt-12')}>
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 lg:grid-cols-[minmax(0,1.5fr)_repeat(4,minmax(0,1fr))_minmax(0,1.5fr)]">
          <div className="col-span-2 space-y-4 sm:col-span-3 lg:col-span-1 lg:pr-8">
            <p className="text-[20px] font-extrabold tracking-[-0.02em] text-white">{tenantName ?? 'Book your car'}</p>
            <p className="max-w-[280px] text-[14px] leading-relaxed text-white/65">Book your car online, day or night. We&apos;ll have it ready for you.</p>
            <Link
              href="/booking"
              className="inline-flex h-11 items-center rounded-full bg-white px-5 text-[14px] font-semibold text-[var(--nw-foot)] transition-opacity duration-200 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 motion-reduce:transition-none"
            >
              Book a car
            </Link>
          </div>
          {Object.entries(columns).map(([heading, links]) => (
            <div key={heading} className="space-y-3">
              <h3 className={HEADING}>{heading}</h3>
              <ul className="space-y-2.5">
                {links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className={LINK}>
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {vehicles.length > 0 ? (
            <div className="space-y-3">
              <h3 className={HEADING}>Our cars</h3>
              <ul className="space-y-2.5">
                {vehicles.map((vehicle) => (
                  <li key={vehicle.id} className="min-w-0">
                    <Link href={`/booking/${vehicle.id}`} className={cn(LINK, 'truncate')}>
                      {vehicle.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {hasContact ? (
            <div className="col-span-2 space-y-3 sm:col-span-1">
              <h3 className={HEADING}>Contact us</h3>
              <ul className="space-y-2.5">
                {email !== '' ? (
                  <li>
                    <a href={`mailto:${email}`} className={cn(LINK, 'flex items-start gap-2 break-all')}>
                      <Mail className="mt-[3px] size-3.5 shrink-0" />
                      {email}
                    </a>
                  </li>
                ) : null}
                {phone !== '' ? (
                  <li>
                    <a href={`tel:${dial}`} className={cn(LINK, 'flex items-start gap-2')}>
                      <Phone className="mt-[3px] size-3.5 shrink-0" />
                      {phone}
                    </a>
                  </li>
                ) : null}
                {address.length > 0 ? (
                  <li>
                    {mapsUrl !== '' ? (
                      <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className={cn(LINK, 'flex items-start gap-2')}>
                        <MapPin className="mt-[3px] size-3.5 shrink-0" />
                        <span>{address.join(', ')}</span>
                      </a>
                    ) : (
                      <span className="flex items-start gap-2 text-[14px] leading-5 text-white/65">
                        <MapPin className="mt-[3px] size-3.5 shrink-0" />
                        <span>{address.join(', ')}</span>
                      </span>
                    )}
                  </li>
                ) : null}
              </ul>
            </div>
          ) : null}
        </div>

        <div className="mt-12 flex flex-col items-center gap-4 border-t border-white/10 pt-6 sm:flex-row sm:justify-between">
          <p className="text-[13px] text-white/55">
            © {new Date().getFullYear()} {tenantName ?? ''}. All rights reserved.
          </p>
          {socials.length > 0 ? (
            <ul className="flex items-center gap-1">
              {socials.map(({ key, href, label, Icon }) => (
                <li key={key}>
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={label}
                    className="grid size-11 place-items-center rounded-full text-white/65 transition-colors duration-200 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 motion-reduce:transition-none"
                  >
                    <Icon className="size-4" />
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </footer>
  );
}

/* ─────────────────────────────── the skyline ───────────────────────────── */

/* A 1440×240 canvas: rolling hills, a small town on each, tall slim towers at
   both edges, a Ferris wheel, trees, street lamps, two clouds, the pin
   floating over the valley and cars driving along the hilltops. Everything but the cars and the pin is filled with the
   footer's own colour, so the skyline and the slab are one shape. */
const W = 1440;
const H = 240;

type Seg = [number, number, number, number, number, number, number, number];
/** The hilltop line, as cubic segments (x0 y0 c1x c1y c2x c2y x1 y1). */
const HILLS: Seg[] = [
  [0, 202, 180, 168, 330, 160, 470, 188],
  [470, 188, 600, 214, 700, 154, 860, 152],
  [860, 152, 1010, 150, 1100, 186, 1240, 188],
  [1240, 188, 1330, 189, 1390, 174, 1440, 170],
];
const HILL_D =
  `M${HILLS[0][0]} ${HILLS[0][1]} ` + HILLS.map(([, , a, b, c, d, e, f]) => `C${a} ${b} ${c} ${d} ${e} ${f}`).join(' ');
/** The road the cars drive: the hilltops, run on past both edges so they drive in and out of view. */
const ROAD_D = `M-220 202 L0 202 ${HILL_D.slice(HILL_D.indexOf('C'))} L1660 170`;

const bez = (t: number, a: number, b: number, c: number, d: number) =>
  (1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t ** 2 * c + t ** 3 * d;

/** Where the hilltop is at x. */
function hillY(x: number): number {
  const seg = HILLS.find(([x0, , , , , , x1]) => x >= x0 && x <= x1) ?? (x < 0 ? HILLS[0] : HILLS[HILLS.length - 1]);
  const [x0, y0, ax, ay, bx, by, x1, y1] = seg;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (bez(mid, x0, ax, bx, x1) < x) lo = mid;
    else hi = mid;
  }
  return bez((lo + hi) / 2, y0, ay, by, y1);
}

/* [left, width, height above the hill, roof]. The edge towers are tall and
   slim, the towns on the hills lower, and a few houses sit near the valley. */
type Roof = 'flat' | 'spire' | 'setback' | 'antenna' | 'dome' | 'gable';
type Block = [number, number, number, Roof];
const BLOCKS: Block[] = [
  // the edge towers
  [6, 34, 156, 'antenna'], [46, 26, 110, 'flat'], [78, 42, 188, 'spire'], [126, 28, 132, 'setback'],
  [1286, 30, 124, 'dome'], [1322, 42, 170, 'setback'], [1370, 26, 138, 'antenna'], [1402, 38, 192, 'spire'],
  // the towns
  [196, 24, 52, 'gable'], [226, 32, 86, 'setback'], [264, 20, 66, 'flat'], [290, 38, 100, 'spire'], [334, 24, 72, 'antenna'], [364, 28, 50, 'gable'],
  [900, 26, 58, 'gable'], [932, 38, 94, 'dome'], [976, 22, 110, 'spire'], [1004, 34, 84, 'setback'], [1044, 24, 98, 'antenna'], [1074, 32, 60, 'gable'],
  // houses
  [446, 22, 24, 'gable'], [1176, 24, 26, 'gable'], [1206, 20, 22, 'gable'],
];
const TREES: [number, number][] = [
  [30, 11], [62, 8], [168, 10], [410, 11], [432, 8], [520, 9], [668, 7],
  [872, 9], [1128, 12], [1154, 8], [1240, 10], [1262, 7], [1436, 9],
];
const LAMPS = [492, 780, 846, 1112];

const FOOT = 'var(--nw-foot)';
const LIGHT = 'var(--nw-foot-accent)';
/** A lit home window: warm yellow against the night-blue blocks. */
const WARM = '#fcd34d';

function building([x, w, h, roof]: Block) {
  const ground = Math.min(hillY(x), hillY(x + w));
  const top = ground - h;
  const mid = x + w / 2;
  /* Windows: a grid down the block, a few left dark so it looks lived in.
     A house gets one window and a lit door instead. */
  const lit: React.ReactNode[] = [];
  const spots: [number, number][] = [];
  if (roof === 'gable') {
    lit.push(<rect key="w" x={x + 4} y={top + 6} width="6" height="6" />);
    lit.push(<rect key="d" x={x + w - 11} y={ground - 12} width="6" height="12" />);
  } else {
    const cols = Math.max(1, Math.floor((w - 10) / 11));
    const rows = Math.max(0, Math.floor((h - 20) / 13));
    const left = x + (w - (cols * 11 - 5)) / 2;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if ((r * 7 + c * 3 + x) % 5 === 0) continue;
        spots.push([left + c * 11, top + 10 + r * 13]);
        lit.push(<rect key={`${r}-${c}`} x={left + c * 11} y={top + 10 + r * 13} width="6" height="6" />);
      }
    }
  }
  /* One or two windows per tower where someone is home: a warm light that
     switches on and off on its own slow, uneven timer (`nw-lamp`), so the
     city never blinks in step. Picked from the block's position, so the same
     windows light on every render. */
  const homes =
    spots.length < 4
      ? []
      : [...new Set([(x * 13) % spots.length, ...(x % 3 === 0 ? [] : [(x * 29 + 7) % spots.length])])].map((i, n) => ({
          at: spots[i],
          duration: 11 + ((x + n * 17) % 13),
          delay: -((x * 7 + n * 31) % 23),
        }));
  return (
    <g key={x}>
      <rect x={x} y={top} width={w} height={H - top} fill={FOOT} />
      {roof === 'spire' ? <path d={`M${mid - 4} ${top} L${mid} ${top - 18} L${mid + 4} ${top} Z`} fill={FOOT} /> : null}
      {roof === 'setback' ? (
        <>
          <rect x={x + w * 0.2} y={top - h * 0.16} width={w * 0.6} height={h * 0.16 + 1} fill={FOOT} />
          <rect x={mid - 1} y={top - h * 0.16 - 10} width="2" height="10" fill={FOOT} />
        </>
      ) : null}
      {roof === 'dome' ? <path d={`M${x + 3} ${top + 1} A${w / 2 - 3} ${w / 2 - 3} 0 0 1 ${x + w - 3} ${top + 1} Z`} fill={FOOT} /> : null}
      {roof === 'gable' ? <path d={`M${x - 3} ${top + 1} L${mid} ${top - w * 0.45} L${x + w + 3} ${top + 1} Z`} fill={FOOT} /> : null}
      {roof === 'antenna' ? (
        <>
          <rect x={mid - 1} y={top - 22} width="2" height="22" fill={FOOT} />
          <circle className="nw-blink" cx={mid} cy={top - 23} r="2.6" fill={LIGHT} style={{ animationDelay: `${(x % 7) * 0.3}s` }} />
        </>
      ) : null}
      <g fill={LIGHT} opacity=".5">
        {lit}
      </g>
      {homes.map(({ at: [wx, wy], duration, delay }) => (
        <rect
          key={`home-${wx}-${wy}`}
          className="nw-lamp"
          x={wx}
          y={wy}
          width="6"
          height="6"
          fill={WARM}
          style={{ animationDuration: `${duration}s`, animationDelay: `${delay}s` }}
        />
      ))}
    </g>
  );
}

function tree([x, r]: [number, number]) {
  const y = hillY(x);
  return (
    <g key={x} fill={FOOT}>
      <rect x={x - 1.5} y={y - 16} width="3" height="22" />
      <circle cx={x} cy={y - 16 - r * 0.8} r={r} />
    </g>
  );
}

/** A street lamp beside the road, its light in the brand colour. */
function lamp(x: number) {
  const y = hillY(x);
  return (
    <g key={x}>
      <rect x={x - 1} y={y - 30} width="2" height="34" fill={FOOT} />
      <path d={`M${x} ${y - 30} Q${x} ${y - 34} ${x + 7} ${y - 34}`} fill="none" stroke={FOOT} strokeWidth="2" />
      <circle cx={x + 8} cy={y - 32.5} r="2.6" fill={LIGHT} />
    </g>
  );
}

/** The Ferris wheel on the left hill, turning slowly (styles/site.css). */
function wheel(cx: number) {
  const ground = hillY(cx);
  const r = 34;
  const cy = ground - r - 12;
  const spokes = Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4);
  return (
    <g key="wheel">
      <path d={`M${cx - 18} ${ground + 4} L${cx} ${cy} L${cx + 18} ${ground + 4}`} fill="none" stroke={FOOT} strokeWidth="3.5" strokeLinejoin="round" />
      <g className="nw-wheel">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={FOOT} strokeWidth="3" />
        <circle cx={cx} cy={cy} r={r - 9} fill="none" stroke={FOOT} strokeWidth="1.2" />
        {spokes.map((a) => (
          <path key={a} d={`M${cx} ${cy} L${cx + Math.cos(a) * r} ${cy + Math.sin(a) * r}`} stroke={FOOT} strokeWidth="1.6" />
        ))}
        {spokes.map((a) => (
          <circle key={`c${a}`} cx={cx + Math.cos(a) * r} cy={cy + Math.sin(a) * r} r="4.2" fill={LIGHT} opacity=".75" />
        ))}
      </g>
      <circle cx={cx} cy={cy} r="4" fill={FOOT} />
    </g>
  );
}

/** A soft cloud, drifting (styles/site.css). */
function cloud(x: number, y: number, scale: number, key: string) {
  return (
    <g key={key} className="nw-cloud" transform={`translate(${x} ${y}) scale(${scale})`}>
      <path d="M10 30 Q0 30 0 21 Q0 12 11 12 Q14 0 28 0 Q40 0 44 10 Q58 8 60 20 Q62 30 52 30 Z" fill={FOOT} opacity=".07" />
    </g>
  );
}

/** A flat car in the brand colour, drawn with its origin at the middle of its wheels' line.
    The drawing faces left, so a car heading right is mirrored. */
function flatCar(facing: 'right' | 'left') {
  return (
    <g transform={`scale(${facing === 'right' ? -0.6 : 0.6} 0.6) translate(-48 -37)`}>
      <path
        d="M0 30 L0 21 Q0 16 6 15 L20 13 L34 3 Q38 0 44 0 L66 0 Q72 0 76 4 L86 13 Q96 15 96 22 L96 30 Z"
        fill="var(--nw-foot-accent)"
      />
      <path d="M27 13 L38 5 L52 5 L52 13 Z M56 13 L56 5 L66 5 L75 13 Z" fill="var(--nw-foot)" opacity=".55" />
      <circle cx="22" cy="30" r="7" fill="var(--nw-foot)" />
      <circle cx="22" cy="30" r="2.6" fill="var(--nw-foot-accent)" />
      <circle cx="75" cy="30" r="7" fill="var(--nw-foot)" />
      <circle cx="75" cy="30" r="2.6" fill="var(--nw-foot-accent)" />
    </g>
  );
}

/* Three cars on the road: two heading right, one coming back the other way,
   slow and out of step. Negative `begin`s start them part-way, so the road is
   never empty on load. */
const DRIVES = [
  { facing: 'right' as const, dur: 28, begin: 0 },
  { facing: 'right' as const, dur: 28, begin: -14 },
  { facing: 'left' as const, dur: 34, begin: -9 },
];
/** Where the cars stand when motion is reduced: on the hills, clear of the towns. */
const PARKED: { x: number; facing: 'right' | 'left' }[] = [
  { x: 160, facing: 'right' },
  { x: 540, facing: 'right' },
  { x: 1200, facing: 'left' },
];

function Skyline() {
  const pinX = 720;
  const pinGround = hillY(pinX);
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      // Its height follows the width (1440:240), so nothing is cropped on a wide
      // screen; below ~780px it holds at 130px and trims the edges instead.
      preserveAspectRatio="xMidYMax slice"
      aria-hidden="true"
      className="-mb-px block h-[max(130px,16.67vw)] w-full"
    >
      {cloud(330, 40, 1.4, 'a')}
      {cloud(1010, 22, 1.1, 'b')}
      {BLOCKS.map(building)}
      {wheel(604)}
      {TREES.map(tree)}
      {LAMPS.map(lamp)}
      <path d={`${HILL_D} L${W} ${H} L0 ${H} Z`} fill="var(--nw-foot)" />

      {/* Where you'll collect it: the pin floats over the valley, its shadow
          on the hill shrinking as it rises (styles/site.css). */}
      <ellipse className="nw-pin-shadow" cx={pinX} cy={pinGround - 2} rx="12" ry="3" fill="var(--nw-foot-accent)" opacity=".35" />
      <g className="nw-pin">
        <g transform={`translate(${pinX - 14} ${pinGround - 64})`} fill="var(--nw-foot-accent)">
          <path d="M14 0 C6 0 0 6 0 14 C0 24 14 38 14 38 C14 38 28 24 28 14 C28 6 22 0 14 0 Z" />
          <circle cx="14" cy="14" r="5" fill="var(--nw-foot)" />
        </g>
      </g>

      {/* Driving along the hilltops; tilted with the road. */}
      <g className="nw-sky-driving">
        {DRIVES.map(({ facing, dur, begin }, index) => (
          <g key={index}>
            {flatCar(facing)}
            <animateMotion
              dur={`${dur}s`}
              begin={`${begin}s`}
              repeatCount="indefinite"
              rotate="auto"
              path={ROAD_D}
              {...(facing === 'left' ? { keyPoints: '1;0', keyTimes: '0;1', calcMode: 'linear' } : {})}
            />
          </g>
        ))}
      </g>
      {/* Reduced motion: the same cars, parked. */}
      <g className="nw-sky-parked">
        {PARKED.map(({ x, facing }) => (
          <g key={x} transform={`translate(${x} ${hillY(x)})`}>
            {flatCar(facing)}
          </g>
        ))}
      </g>
    </svg>
  );
}
