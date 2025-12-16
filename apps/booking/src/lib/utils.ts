import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function toTitleCase(str: string): string {
  return str
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function getNavigationUrl(address: string, app: 'google' | 'waze' | 'apple' = 'google'): string {
  const encodedAddress = encodeURIComponent(address);
  
  switch (app) {
    case 'google':
      return `https://www.google.com/maps/dir/?api=1&destination=${encodedAddress}`;
    case 'waze':
      return `https://waze.com/ul?q=${encodedAddress}&navigate=yes`;
    case 'apple':
      return `http://maps.apple.com/?daddr=${encodedAddress}`;
    default:
      return `https://www.google.com/maps/dir/?api=1&destination=${encodedAddress}`;
  }
}
