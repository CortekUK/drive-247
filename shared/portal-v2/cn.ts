import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** The apps' own `cn`, for the shared portal v2 components. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
