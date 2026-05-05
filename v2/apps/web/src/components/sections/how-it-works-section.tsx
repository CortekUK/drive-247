import { StepCard } from "@/components/cards/step-card";
import { STEPS } from "@/lib/fixtures/landing";

export function HowItWorksSection() {
  return (
    <section className="bg-background">
      <div className="container-page py-16 lg:py-24">
        <header className="mx-auto max-w-2xl text-center">
          <h2 className="text-4xl font-semibold leading-tight tracking-tight text-[#111210] sm:text-5xl sm:leading-none">
            How It Works
          </h2>
          <p className="mx-auto mt-4 max-w-[480px] text-sm leading-relaxed text-[#4a4b48] sm:text-base">
            We’ve redesigned the rental experience to get you from planning to
            driving in record time.
          </p>
        </header>

        <div className="mt-12 grid grid-cols-2 justify-items-center gap-y-10 sm:grid-cols-3 lg:grid-cols-5 lg:gap-6">
          {STEPS.map((step) => (
            <StepCard
              key={step.id}
              title={step.title}
              description={step.description}
              icon={step.icon}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
