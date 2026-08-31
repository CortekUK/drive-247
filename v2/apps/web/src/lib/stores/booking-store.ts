"use client";

import { create } from "zustand";

import type { Vehicle } from "@/lib/fixtures/landing";

export type InsuranceChoice = "bonzah" | "own" | null;

export type BookingState = {
  step: number;

  // Step 1
  pickupLocation: string;
  dropoffLocation: string;
  pickupDate: Date | null;
  pickupTime: string;
  dropoffDate: Date | null;
  dropoffTime: string;
  driverAge: string;

  // Step 2
  selectedVehicleId: string | null;
  brandFilter: string;

  // Step 3
  fullName: string;
  email: string;
  phone: string;
  licenseFileName: string;

  // Step 4
  insurance: InsuranceChoice;
  insuranceFileName: string;

  // Step 5
  agreedToTerms: boolean;

  // Actions
  setStep: (step: number) => void;
  next: () => void;
  prev: () => void;
  set: <K extends keyof BookingState>(key: K, value: BookingState[K]) => void;
  selectVehicle: (vehicle: Vehicle) => void;
  reset: () => void;
};

const INITIAL: Omit<
  BookingState,
  "setStep" | "next" | "prev" | "set" | "selectVehicle" | "reset"
> = {
  step: 1,

  pickupLocation: "",
  dropoffLocation: "",
  pickupDate: null,
  pickupTime: "",
  dropoffDate: null,
  dropoffTime: "",
  driverAge: "",

  selectedVehicleId: null,
  brandFilter: "aston-martin",

  fullName: "",
  email: "",
  phone: "",
  licenseFileName: "",

  insurance: null,
  insuranceFileName: "",

  agreedToTerms: false,
};

export const useBookingStore = create<BookingState>((set) => ({
  ...INITIAL,

  setStep: (step) => set({ step }),
  next: () => set((state) => ({ step: Math.min(state.step + 1, 6) })),
  prev: () => set((state) => ({ step: Math.max(state.step - 1, 1) })),
  set: (key, value) =>
    set(() => ({ [key]: value }) as Pick<BookingState, typeof key>),
  selectVehicle: (vehicle) => set({ selectedVehicleId: vehicle.id }),
  reset: () => set({ ...INITIAL }),
}));
