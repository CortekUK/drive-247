"use client";

import { useRef } from "react";
import { TestimonialsManager, TestimonialsManagerRef } from "@/components/testimonials/testimonials-manager";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/bento";
import { Plus } from "lucide-react";

export default function Testimonials() {
  const testimonialsRef = useRef<TestimonialsManagerRef>(null);

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <Eyebrow>Reviews</Eyebrow>
          <h1 className="mt-1 text-3xl font-extrabold tracking-tight">Testimonials</h1>
          <p className="text-muted-foreground">
            Manage customer testimonials and reviews
          </p>
        </div>
        <Button
          onClick={() => testimonialsRef.current?.openDialog()}
          className="flex items-center gap-2 w-full sm:w-auto"
        >
          <Plus className="h-4 w-4" />
          Add Testimonial
        </Button>
      </div>

      <TestimonialsManager ref={testimonialsRef} />
    </div>
  );
}
