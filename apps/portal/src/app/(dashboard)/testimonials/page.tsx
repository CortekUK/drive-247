"use client";

import { useRef } from "react";
import { TestimonialsManager, TestimonialsManagerRef } from "@/components/testimonials/testimonials-manager";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export default function Testimonials() {
  const testimonialsRef = useRef<TestimonialsManagerRef>(null);

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Testimonials</h1>
          <p className="text-muted-foreground">
            Manage customer testimonials and reviews
          </p>
        </div>
        <Button
          onClick={() => testimonialsRef.current?.openDialog()}
          className="flex items-center gap-2"
        >
          <Plus className="h-4 w-4" />
          Add Testimonial
        </Button>
      </div>

      <TestimonialsManager ref={testimonialsRef} />
    </div>
  );
}
