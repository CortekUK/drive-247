import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge-nw';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
