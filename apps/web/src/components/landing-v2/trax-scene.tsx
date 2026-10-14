import { BarChart3, Check, IdCard, ShieldCheck, Sparkles } from "lucide-react";
import Image from "next/image";
import type { ReactNode } from "react";

/*
 * "Trax at work": the still showcase under "Meet Trax." (2026-10-08).
 *
 * The section has ONE star: the Trax chat on the right is the only thing that
 * moves. This piece is fully still and shows Trax's three background jobs
 * side by side, each finished: the document in its scanning frame with the
 * result stamped across it, the job's name, and the facts Trax pulled out.
 *   1. ID          licence read, face matched     (ai-document-ocr + ai-face-match)
 *   2. Insurance   certificate read and checked   (scan-insurance-document +
 *                                                  verify-insurance-document)
 *   3. Report      the month written up           (trax-insights-summary)
 *
 * Drawn in the ILLUSTRATION_GUIDE.md language: ink lines, white cards, indigo
 * only where it means something, green only for a check that is done. Names
 * and figures are illustrative; the portrait is a licensed stock photo
 * (public/landing-v2/people, CREDITS.md).
 */

type Job = {
  key: string;
  tab: string;
  icon: typeof IdCard;
  facts: [string, string][];
  stamp: string;
  Doc: () => ReactNode;
};

/* ── The documents ─────────────────────────────────────────────────────── */

function Licence() {
  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl border-[1.5px] border-[#1f2040] bg-[#f4f5fb]">
      <div className="flex h-6 items-center bg-[#442DD7] px-2.5 text-[8px] font-bold uppercase tracking-[0.16em] text-white">
        Driver licence
      </div>
      <div className="flex gap-2.5 p-2.5">
        <Image
          src="/landing-v2/people/person-3.jpg"
          alt=""
          width={44}
          height={56}
          className="h-[56px] w-[44px] rounded-md border-[1.5px] border-[#1f2040] object-cover"
        />
        <div className="flex-1 space-y-1.5 pt-1">
          <div className="h-2 w-4/5 rounded-full bg-[#d5d8ea]" />
          <div className="h-2 w-3/5 rounded-full bg-[#d5d8ea]" />
          <div className="h-2 w-2/3 rounded-full bg-[#d5d8ea]" />
          <div className="h-2 w-2/5 rounded-full bg-[#d5d8ea]" />
        </div>
      </div>
      {/* the selfie, matched to the licence photo */}
      <div className="absolute right-2 top-9">
        <Image
          src="/landing-v2/people/person-3.jpg"
          alt=""
          width={34}
          height={34}
          className="size-[34px] rounded-full border-2 border-white object-cover outline outline-[1.5px] outline-[#1f2040]"
        />
        <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-[#12a594] text-white ring-2 ring-white">
          <Check className="size-2.5" strokeWidth={3} aria-hidden />
        </span>
      </div>
    </div>
  );
}

function Certificate() {
  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl border-[1.5px] border-[#1f2040] bg-[#f4f5fb] p-2.5">
      <div className="text-[7.5px] font-bold uppercase tracking-[0.14em] text-[#442DD7]">Certificate of insurance</div>
      <div className="mt-2 space-y-1.5">
        <div className="h-2 w-3/4 rounded-full bg-[#d5d8ea]" />
        <div className="h-2 w-1/2 rounded-full bg-[#d5d8ea]" />
      </div>
      <div className="mt-2.5 flex items-center gap-2.5">
        <span className="flex size-9 items-center justify-center rounded-lg border-[1.5px] border-[#1f2040] bg-[#442DD7] text-white">
          <ShieldCheck className="size-5" aria-hidden />
        </span>
        <div className="flex-1 space-y-1.5">
          <div className="h-2 w-full rounded-full bg-[#d5d8ea]" />
          <div className="h-2 w-2/3 rounded-full bg-[#d5d8ea]" />
          <div className="h-2 w-4/5 rounded-full bg-[#d5d8ea]" />
        </div>
      </div>
      <div className="absolute bottom-2.5 left-2.5 right-2.5 flex items-end justify-between">
        <div className="h-2 w-1/3 rounded-full bg-[#d5d8ea]" />
        <svg width="56" height="18" viewBox="0 0 56 18" aria-hidden>
          <path d="M2 14 C10 2 14 18 22 8 S34 4 38 12 S50 6 54 9" fill="none" stroke="#1f2040" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  );
}

function Report() {
  const bars = [44, 58, 50, 66, 61, 82];
  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden rounded-xl border-[1.5px] border-[#1f2040] bg-[#f4f5fb] p-2.5">
      <div className="flex items-center justify-between">
        <div className="text-[7.5px] font-bold uppercase tracking-[0.14em] text-[#442DD7]">September</div>
        <Sparkles className="size-3.5 text-[#442DD7]" aria-hidden />
      </div>
      <div className="mt-0.5 text-[16px] font-bold leading-none tracking-[-0.02em] text-[#12141c]">$18,420</div>
      <div className="mt-auto flex h-[52px] items-end gap-1.5 border-b-[1.5px] border-[#1f2040] pb-px">
        {bars.map((h, i) => (
          <span
            key={i}
            className="flex-1 rounded-t-[4px] border-[1.5px] border-b-0 border-[#1f2040]"
            style={{
              height: `${h}%`,
              backgroundColor: i === bars.length - 1 ? "#442DD7" : "#ffffff",
            }}
          />
        ))}
      </div>
    </div>
  );
}

const JOBS: Job[] = [
  {
    key: "id",
    tab: "Checks IDs",
    icon: IdCard,
    facts: [
      ["Name", "Maya Torres"],
      ["Licence", "In date to 2029"],
      ["Face", "Matches selfie"],
    ],
    stamp: "Cleared to drive",
    Doc: Licence,
  },
  {
    key: "insurance",
    tab: "Verifies insurance",
    icon: ShieldCheck,
    facts: [
      ["Policyholder", "Leo Grant"],
      ["Covers", "Rental cars"],
      ["Valid until", "14 March"],
    ],
    stamp: "Insurance verified",
    Doc: Certificate,
  },
  {
    key: "report",
    tab: "Writes reports",
    icon: BarChart3,
    facts: [
      ["Collected", "Up 12%"],
      ["Top car", "Model 3"],
      ["Idle", "Mustang, 9 days"],
    ],
    stamp: "Report ready",
    Doc: Report,
  },
];

/* ── On show: the ID check only (Ghulam, 2026-10-08). Insurance and Report
   stay defined above, parked for later. ─────────────────────────────────── */

const ON_SHOW = new Set(["id"]);

export function TraxScene({ className = "" }: { className?: string }) {
  return (
    <div className={`w-full max-w-[300px] ${className}`}>
      {JOBS.filter((j) => ON_SHOW.has(j.key)).map((job) => {
        const Doc = job.Doc;
        const Icon = job.icon;
        return (
          <div key={job.key} className="rounded-[22px] bg-white p-3 text-[#12141c] shadow-[0_24px_60px_-28px_rgb(10_6_60/0.65)]">
            {/* the document, in its scanning frame, stamped */}
            <div className="relative mx-1 mt-1 h-[150px]">
              <Doc />
              <span aria-hidden className="pointer-events-none absolute -inset-1.5">
                <span className="absolute left-0 top-0 size-3 rounded-tl-md border-l-2 border-t-2 border-[#442DD7]" />
                <span className="absolute right-0 top-0 size-3 rounded-tr-md border-r-2 border-t-2 border-[#442DD7]" />
                <span className="absolute bottom-0 left-0 size-3 rounded-bl-md border-b-2 border-l-2 border-[#442DD7]" />
                <span className="absolute bottom-0 right-0 size-3 rounded-br-md border-b-2 border-r-2 border-[#442DD7]" />
              </span>
              <div className="pointer-events-none absolute inset-x-0 -bottom-3 flex justify-center">
                <div className="flex -rotate-[4deg] items-center gap-1 whitespace-nowrap rounded-full border-2 border-[#12a594] bg-white px-2.5 py-1 text-[11px] font-bold text-[#12a594] shadow-[0_6px_16px_-6px_rgb(18_165_148/0.6)]">
                  <Check className="size-3" strokeWidth={3} aria-hidden />
                  {job.stamp}
                </div>
              </div>
            </div>

            {/* what it is, and what Trax pulled out */}
            <p className="mt-6 flex items-center gap-1.5 px-1 text-[14px] font-bold tracking-[-0.01em]">
              <Icon className="size-4 shrink-0 text-[#442DD7]" aria-hidden />
              {job.tab}
            </p>
            <ul className="mt-2 space-y-1.5 px-1">
              {job.facts.map(([k, v]) => (
                <li key={k} className="flex items-center gap-1.5 text-[12px] leading-tight">
                  <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-[#e4f6f3] text-[#12a594]">
                    <Check className="size-2.5" strokeWidth={3} aria-hidden />
                  </span>
                  <span className="truncate">{v}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
