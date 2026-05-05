import { Droplet, Gauge } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

export function SafetyVerificationSection() {
  return (
    <section className="bg-white">
      <div className="container-page grid grid-cols-1 items-center gap-10 py-16 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] lg:gap-16 lg:py-24">
        <div className="flex flex-col gap-6">
          <h2 className="font-sans text-4xl font-semibold leading-tight tracking-tight text-[#111210] sm:text-5xl sm:leading-none">
            Safety Verification is Easier than Ever
          </h2>
          <p className="max-w-[440px] text-sm leading-relaxed text-[#4a4b48] sm:text-base">
            With real-time diagnostic sync, we ensure every car is
            safety-certified and sanitized before you even arrive. Experience
            the certainty of a perfectly maintained fleet.
          </p>
          <Link
            href="/booking"
            className="inline-flex w-fit items-center justify-center rounded-full bg-[#162921] px-7 py-[13px] text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            Rent a Car now
          </Link>
        </div>

        <div className="relative min-h-[380px] lg:min-h-[480px]">
          <Image
            src="/booking_landingpage/camaro.png"
            alt="Red Chevrolet Camaro ZL1"
            width={1039}
            height={565}
            sizes="(min-width: 1024px) 60vw, 100vw"
            className="absolute inset-x-[-4%] inset-y-0 m-auto h-auto w-[108%] object-contain drop-shadow-[0_30px_40px_rgba(0,0,0,0.12)] lg:inset-x-[-10%] lg:w-[120%]"
            priority={false}
          />

          <DiagnosticCard
            className="absolute left-0 top-[8%] z-10 w-[260px] sm:left-[2%]"
            icon={<Droplet className="size-3.5 text-[#dc2626]" strokeWidth={2} />}
            label="Engine Oil"
            value="25% Remaining"
            barValue={25}
            barTone="critical"
            footnote="2,500 km / 10,000 km"
            footnoteRight="Critical"
            footnoteRightTone="critical"
          />
          <DiagnosticCard
            className="absolute right-0 top-[2%] z-10 w-[150px]"
            label="Tire Pressure (TPMS)"
            value="32"
            footnote="Normal"
            footnoteTone="success"
            displayLarge
            tinyHelp
          />
          <DiagnosticCard
            className="absolute right-0 bottom-[6%] z-10 w-[260px] sm:right-[2%]"
            icon={<Gauge className="size-3.5 text-[#dc2626]" strokeWidth={2} />}
            label="Brake Life"
            value="85% Remaining"
            barValue={85}
            barTone="info"
            footnote="12,790 km / 19,000 km"
            footnoteRight="Healthy"
            footnoteRightTone="success"
          />
        </div>
      </div>
    </section>
  );
}

type DiagnosticCardProps = {
  className?: string;
  icon?: React.ReactNode;
  label: string;
  value: string;
  barValue?: number;
  barTone?: "critical" | "info";
  footnote: string;
  footnoteTone?: "critical" | "success";
  footnoteRight?: string;
  footnoteRightTone?: "critical" | "success";
  displayLarge?: boolean;
  tinyHelp?: boolean;
};

function DiagnosticCard({
  className,
  icon,
  label,
  value,
  barValue,
  barTone,
  footnote,
  footnoteTone,
  footnoteRight,
  footnoteRightTone,
  displayLarge,
  tinyHelp,
}: DiagnosticCardProps) {
  return (
    <div
      className={
        "rounded-[10px] bg-white p-3 shadow-[0_8px_24px_rgba(0,0,0,0.08)] ring-1 ring-[#ececec] " +
        (className ?? "")
      }
    >
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#111210]">
          {icon}
          {label}
          {tinyHelp && (
            <span
              aria-hidden
              className="ml-0.5 inline-flex size-3 items-center justify-center rounded-full text-[8px] text-[#8a8c88] ring-1 ring-[#ececec]"
            >
              i
            </span>
          )}
        </span>
        {!displayLarge && (
          <span className="text-[12px] font-semibold text-[#111210]">
            {value}
          </span>
        )}
      </div>
      {displayLarge && (
        <p className="mt-1 text-[22px] font-semibold leading-[26px] tracking-tight text-[#111210]">
          {value}
        </p>
      )}
      {barValue !== undefined && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[#eef0ec]">
          <div
            className={`h-full rounded-full ${
              barTone === "critical" ? "bg-[#dc2626]" : "bg-[#5b6cff]"
            }`}
            style={{ width: `${barValue}%` }}
          />
        </div>
      )}
      <div className="mt-2 flex items-center justify-between text-[10px] font-medium">
        <span
          className={
            footnoteTone === "critical"
              ? "text-[#dc2626]"
              : footnoteTone === "success"
                ? "text-[#16a34a]"
                : "text-[#8a8c88]"
          }
        >
          {footnote}
        </span>
        {footnoteRight && (
          <span
            className={
              footnoteRightTone === "critical"
                ? "text-[#dc2626]"
                : "text-[#16a34a]"
            }
          >
            {footnoteRight}
          </span>
        )}
      </div>
    </div>
  );
}
