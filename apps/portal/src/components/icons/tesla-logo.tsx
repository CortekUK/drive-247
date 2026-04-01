"use client";

import React from "react";

interface TeslaLogoProps {
  className?: string;
  size?: number;
}

export const TeslaLogo: React.FC<TeslaLogoProps> = ({ className = "", size = 24 }) => (
  <svg
    viewBox="0 0 278.7 300"
    width={size}
    height={size}
    className={className}
    fill="currentColor"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M139.3 300L0 87.5c0 0 42.4-31.6 139.3-31.6S278.7 87.5 278.7 87.5L139.3 300zM139.3 38.5c-48.4 0-82.6 10.3-100.6 17.8l100.6 0 100.6 0C221.9 48.8 187.7 38.5 139.3 38.5zM252.1 44.8c-14.9-9.4-47.8-23.7-112.8-23.7S41.5 35.4 26.6 44.8C6.6 34.3 0 28.6 0 28.6 30.2 8.5 83.5 0 139.3 0c55.8 0 109.1 8.5 139.3 28.6C278.7 28.6 272.1 34.3 252.1 44.8z" />
  </svg>
);

export const TeslaLogoIcon: React.FC<TeslaLogoProps> = ({ className = "", size = 16 }) => (
  <TeslaLogo className={className} size={size} />
);

export default TeslaLogo;
