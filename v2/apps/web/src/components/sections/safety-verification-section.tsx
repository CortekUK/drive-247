import { Droplet, Gauge } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

export function SafetyVerificationSection() {
  const engineOilCard = (
    <DiagnosticCard
      icon={<Droplet className="size-3.5 text-danger" strokeWidth={2} />}
      label="Engine Oil"
      value="25% Remaining"
      barValue={25}
      barTone="critical"
      footnote="2,500 km / 10,000 km"
      footnoteRight="Critical"
      footnoteRightTone="critical"
    />
  );

  const tirePressureCard = (
    <DiagnosticCard
      label="Tire Pressure (TPMS)"
      value="32"
      footnote="Normal"
      footnoteTone="success"
      displayLarge
      tinyHelp
    />
  );

  const brakeLifeCard = (
    <DiagnosticCard
      icon={<Gauge className="size-3.5 text-danger" strokeWidth={2} />}
      label="Brake Life"
      value="85% Remaining"
      barValue={85}
      barTone="info"
      footnote="12,790 km / 19,000 km"
      footnoteRight="Healthy"
      footnoteRightTone="success"
    />
  );

  return (
    <section className="bg-white">
      <div className="container-page grid grid-cols-1 items-center gap-10 py-12 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] lg:gap-16 lg:py-24">
        <div className="flex flex-col gap-6">
          <h2 className="font-sans text-3xl font-semibold leading-tight tracking-tight text-brand-text sm:text-4xl lg:text-5xl lg:leading-none">
            Safety Verification is Easier than Ever
          </h2>
          <p className="max-w-[440px] text-sm leading-relaxed text-brand-text-soft sm:text-base">
            With real-time diagnostic sync, we ensure every car is
            safety-certified and sanitized before you even arrive. Experience
            the certainty of a perfectly maintained fleet.
          </p>
          <Link
            href="/booking"
            className="inline-flex w-fit items-center justify-center rounded-full bg-brand-forest px-7 py-[13px] text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            Rent a Car now
          </Link>
        </div>

        {/* Mobile/tablet stacked layout */}
        <div className="flex flex-col gap-4 lg:hidden">
          <div className="flex items-start gap-3">
            <div className="flex-1">{engineOilCard}</div>
            <div className="w-[140px] shrink-0">{tirePressureCard}</div>
          </div>
          <div className="relative -mx-4">
            <Image
              src="/booking_landingpage/camaro.png"
              alt="Red Chevrolet Camaro ZL1"
              width={1039}
              height={565}
              sizes="100vw"
              className="h-auto w-full object-contain drop-shadow-[0_20px_30px_rgba(0,0,0,0.12)]"
              priority={false}
            />
          </div>
          <div>{brakeLifeCard}</div>
        </div>

        {/* Desktop overlay layout */}
        <div className="relative hidden lg:block lg:min-h-[480px]">
          <Image
            src="/booking_landingpage/camaro.png"
            alt="Red Chevrolet Camaro ZL1"
            width={1039}
            height={565}
            sizes="60vw"
            className="absolute inset-x-[-10%] inset-y-0 m-auto h-auto w-[120%] object-contain drop-shadow-[0_30px_40px_rgba(0,0,0,0.12)]"
            priority={false}
          />
          <div className="absolute left-0 top-[8%] z-10 w-[260px]">
            {engineOilCard}
          </div>
          <div className="absolute right-0 top-[2%] z-10 w-[150px]">
            {tirePressureCard}
          </div>
          <div className="absolute right-0 bottom-[6%] z-10 w-[260px]">
            {brakeLifeCard}
          </div>
        </div>
      </div>
    </section>
  );
}

type DiagnosticCardProps = {
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
    <div className="rounded-[10px] bg-white p-3 shadow-[0_8px_24px_rgba(0,0,0,0.08)] ring-1 ring-brand-border-soft">
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-brand-text">
          {icon}
          {label}
          {tinyHelp && (
            <span
              aria-hidden
              className="ml-0.5 inline-flex size-3 items-center justify-center rounded-full text-[8px] text-brand-text-subtle ring-1 ring-brand-border-soft"
            >
              i
            </span>
          )}
        </span>
        {!displayLarge && (
          <span className="text-[12px] font-semibold text-brand-text">
            {value}
          </span>
        )}
      </div>
      {displayLarge && (
        <p className="mt-1 text-[22px] font-semibold leading-[26px] tracking-tight text-brand-text">
          {value}
        </p>
      )}
      {barValue !== undefined && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className={`h-full rounded-full ${
              barTone === "critical" ? "bg-danger" : "bg-brand-progress-bar"
            }`}
            style={{ width: `${barValue}%` }}
          />
        </div>
      )}
      <div className="mt-2 flex items-center justify-between text-[10px] font-medium">
        <span
          className={
            footnoteTone === "critical"
              ? "text-danger"
              : footnoteTone === "success"
                ? "text-success"
                : "text-brand-text-subtle"
          }
        >
          {footnote}
        </span>
        {footnoteRight && (
          <span
            className={
              footnoteRightTone === "critical"
                ? "text-danger"
                : "text-success"
            }
          >
            {footnoteRight}
          </span>
        )}
      </div>
    </div>
  );
}
