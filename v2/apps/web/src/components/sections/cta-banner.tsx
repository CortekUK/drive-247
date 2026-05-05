import { Car } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

export function CtaBanner() {
  return (
    <section className="relative isolate overflow-hidden text-white">
      <Image
        src="/booking_landingpage/tesla-bg.png"
        alt=""
        fill
        priority={false}
        sizes="100vw"
        className="-z-20 scale-105 object-cover object-center blur-[6px]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-black/55"
      />

      <div className="container-page relative flex flex-col items-center gap-6 py-24 text-center lg:py-32">
        <h2 className="max-w-3xl font-sans text-4xl font-semibold leading-tight tracking-tight text-white sm:text-5xl sm:leading-none">
          Your Verified Drive is Just a Click Away
        </h2>
        <p className="max-w-xl text-sm leading-relaxed text-white/80 sm:text-base">
          Secure your exact vehicle from our verified fleet today. Experience
          high-performance rental with absolute certainty.
        </p>
        <Link
          href="/booking"
          className="inline-flex items-center justify-center rounded-full bg-[#f2c12c] px-8 py-[13px] text-sm font-semibold text-[#111210] transition-opacity hover:opacity-90"
        >
          Get Started
        </Link>
        <p className="inline-flex items-center gap-2 text-xs text-white/85">
          <Car className="size-3.5" strokeWidth={1.75} />
          14 cars available for pickup today in Los Angeles.
        </p>
      </div>
    </section>
  );
}
