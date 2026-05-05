import Link from "next/link";

import { cn } from "@/lib/utils";

type BrandMarkProps = {
  href?: string;
  className?: string;
};

export function BrandMark({ href = "/", className }: BrandMarkProps) {
  return (
    <Link
      href={href}
      aria-label="Drive247 home"
      className={cn("inline-flex items-center justify-center", className)}
    >
      <svg
        width="28"
        height="28"
        viewBox="0 0 28 28"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path
          d="M14 3.5V24.5"
          stroke="#131B16"
          strokeWidth="4.66667"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M3.5 14H24.5"
          stroke="#131B16"
          strokeWidth="4.66667"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M6.57532 6.57422L21.4247 21.4236"
          stroke="#131B16"
          strokeWidth="4.66667"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M21.4247 6.57422L6.57532 21.4236"
          stroke="#131B16"
          strokeWidth="4.66667"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </Link>
  );
}
