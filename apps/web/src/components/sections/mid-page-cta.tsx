import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export function MidPageCTA() {
  return (
    <section className="py-14 sm:py-16">
      <div className="mx-auto max-w-6xl px-4 text-center sm:px-6">
        <p className="text-lg font-medium tracking-tight text-muted-foreground sm:text-xl">
          Ready to see if Drive247 fits your fleet?
        </p>
        <Button
          asChild
          size="lg"
          className="mt-5 bg-indigo-600 text-sm font-normal shadow-lg shadow-indigo-600/25 transition-all hover:bg-indigo-700 hover:shadow-xl hover:shadow-indigo-600/30"
        >
          <a href="/strategy-call">
            Book a 20-min fit call
            <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
          </a>
        </Button>
      </div>
    </section>
  );
}
