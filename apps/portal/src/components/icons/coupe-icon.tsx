import { forwardRef, type SVGProps } from "react";

/**
 * The brand coupe as a 24px line icon — low and wide, glass worn like
 * sunglasses (ILLUSTRATION_GUIDE.md, "quiet confidence").
 * Drop-in for a lucide icon: same viewBox, stroke and props.
 */
export const CoupeIcon = forwardRef<SVGSVGElement, SVGProps<SVGSVGElement>>(
  ({ strokeWidth = 2, ...props }, ref) => (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <g transform="translate(0 -1.5)">
        <path d="M4.5 16.5H3Q2 16.5 2 15.5V14Q2 12.9 3.1 12.6L7.5 11.6Q10.8 8.8 14 8.8Q17 8.8 19.2 11.4L21 12Q22 12.4 22 13.5V15.5Q22 16.5 21 16.5H19.5M15.5 16.5H8.5" />
        <path d="M10 11.6H18" />
        <circle cx="6.5" cy="16.5" r="2" />
        <circle cx="17.5" cy="16.5" r="2" />
      </g>
    </svg>
  ),
);
CoupeIcon.displayName = "CoupeIcon";
