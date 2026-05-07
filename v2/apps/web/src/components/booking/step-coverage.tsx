"use client";

import { ArrowRight, Upload } from "lucide-react";
import Image from "next/image";
import { useRef, useState } from "react";

import { useBookingStore } from "@/lib/stores/booking-store";
import { cn } from "@/lib/utils";

export function StepCoverage() {
  const store = useBookingStore();
  const { insurance, insuranceFileName } = store;
  const [error, setError] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      store.set("insuranceFileName", file.name);
      store.set("insurance", "own");
    }
  }

  function handleProceed() {
    if (!insurance) {
      setError("Please choose a coverage option");
      return;
    }
    if (insurance === "own" && !insuranceFileName) {
      setError("Please upload your insurance declaration page");
      return;
    }
    setError("");
    store.next();
  }

  return (
    <div className="w-full max-w-[800px]">
      <h1 className="text-center text-[26px] font-semibold leading-tight text-brand-text sm:text-[32px]">
        Coverage & Protection
      </h1>
      <p className="mx-auto mt-3 max-w-[520px] text-center text-sm leading-relaxed text-brand-text-soft">
        To maintain our premium fleet standards, all drivers are required to
        provide verified third-party insurance.
      </p>

      <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Bonzah option — second on mobile, first on tablet+ */}
        <article
          className={cn(
            "order-2 flex flex-col rounded-[14px] border bg-white p-6 transition-all md:order-1",
            insurance === "bonzah"
              ? "border-brand-amber ring-2 ring-brand-amber/40"
              : "border-brand-border-soft",
          )}
        >
          <div className="flex h-16 items-center justify-center">
            <Image
              src="/booking_landingpage/bonzah.png"
              alt="Bonzah"
              width={47}
              height={47}
              className="h-12 w-auto object-contain"
            />
          </div>
          <h2 className="mt-3 text-base font-semibold text-brand-text">
            I Don’t have my own insurance.
          </h2>
          <p className="mt-2 flex-1 text-sm leading-relaxed text-brand-text-soft">
            Most our drivers choose Bonzah for instant, affordable rental
            coverage. It takes less than 2 minutes and syncs with your booking.
          </p>
          <button
            type="button"
            onClick={() => store.set("insurance", "bonzah")}
            className="mt-5 inline-flex h-11 items-center justify-center gap-2 rounded-full bg-brand-forest px-5 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            Get Instant Coverage via Bonzah
            <ArrowRight className="size-4" strokeWidth={2} />
          </button>
        </article>

        {/* Own insurance option — first on mobile, second on tablet+ */}
        <article
          className={cn(
            "order-1 flex flex-col rounded-[14px] border bg-white p-6 transition-all md:order-2",
            insurance === "own"
              ? "border-brand-amber ring-2 ring-brand-amber/40"
              : "border-brand-border-soft",
          )}
        >
          <div className="flex h-16 items-center justify-center">
            <Image
              src="/booking_landingpage/shield_image.png"
              alt="Shield"
              width={66}
              height={66}
              className="h-14 w-auto object-contain"
            />
          </div>
          <h2 className="mt-3 text-base font-semibold text-brand-text">
            I have my own insurance.
          </h2>
          <p className="mt-2 flex-1 text-sm leading-relaxed text-brand-text-soft">
            Please provide your current insurance declaration page for
            verification.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.pdf"
            className="hidden"
            onChange={handleFile}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="mt-5 inline-flex h-11 items-center justify-center gap-2 rounded-full bg-brand-cream px-5 text-sm font-medium text-brand-text ring-1 ring-brand-border-soft transition-colors hover:bg-white"
          >
            <Upload className="size-3.5" strokeWidth={1.75} />
            {insuranceFileName || "Upload"}
          </button>
        </article>
      </div>

      {error && (
        <p className="mt-4 text-center text-xs text-danger">{error}</p>
      )}

      <div className="sticky bottom-6 mt-8 flex justify-center">
        <button
          type="button"
          onClick={handleProceed}
          className="inline-flex h-12 items-center justify-center rounded-full bg-brand-forest px-8 text-sm font-medium text-white shadow-[0_8px_20px_-6px_rgba(0,0,0,0.25)] transition-opacity hover:opacity-90"
        >
          Continue to Review
        </button>
      </div>
    </div>
  );
}
