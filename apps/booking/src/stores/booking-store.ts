import { create } from 'zustand';

/**
 * Pending insurance file uploaded to storage but not yet linked to a customer/booking
 */
export interface PendingInsuranceFile {
  file_path: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  uploaded_at: string;
}

/**
 * Selected delivery/pickup location from tenant's configured locations
 */
export interface SelectedLocation {
  id: string;
  name: string;
  address: string;
  delivery_fee?: number;
}

/**
 * Booking context - all data collected during the booking flow
 */
export interface BookingContext {
  // Step 1: Dates & Location
  pickupDate: string | null;
  pickupTime: string | null;
  returnDate: string | null;
  returnTime: string | null;
  pickupLocation: string | null;
  returnLocation: string | null;
  sameAsPickup: boolean;

  // Customer info (from booking form)
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  customerType: 'Individual' | 'Company' | null;
  customerTimezone: string | null;

  // Driver info
  driverDOB: string | null;
  driverAge: number | null;

  // Delivery options
  deliveryOption: 'fixed' | 'location' | 'area' | null;
  selectedLocationId: string | null;
  selectedLocation: SelectedLocation | null;
  deliveryFee: number;

  // Legacy delivery/collection fields (backward compatibility)
  requestDelivery: boolean;
  deliveryLocationId: string | null;
  deliveryLocation: SelectedLocation | null;
  requestCollection: boolean;
  collectionLocationId: string | null;
  collectionLocation: SelectedLocation | null;

  // Promo
  promoCode: string | null;

  // Step 2: Vehicle selection
  selectedVehicleId: string | null;

  // Step 3: Extras & Insurance
  selectedExtras: string[];
  insuranceOption: string | null;
}

interface BookingState {
  // Booking flow data
  context: BookingContext;

  // Pending insurance uploads (stored in Supabase storage, not yet linked)
  pendingInsuranceFiles: PendingInsuranceFile[];

  // Actions
  setContext: (context: Partial<BookingContext>) => void;
  updateContext: (updates: Partial<BookingContext>) => void;
  clearContext: () => void;

  // Insurance file actions
  addPendingInsuranceFile: (file: PendingInsuranceFile) => void;
  clearPendingInsuranceFiles: () => void;
  getPendingInsuranceFiles: () => PendingInsuranceFile[];

  // Convenience getters
  getFullContext: () => BookingContext;
}

const initialContext: BookingContext = {
  pickupDate: null,
  pickupTime: null,
  returnDate: null,
  returnTime: null,
  pickupLocation: null,
  returnLocation: null,
  sameAsPickup: true,
  customerName: null,
  customerEmail: null,
  customerPhone: null,
  customerType: null,
  customerTimezone: null,
  driverDOB: null,
  driverAge: null,
  deliveryOption: null,
  selectedLocationId: null,
  selectedLocation: null,
  deliveryFee: 0,
  requestDelivery: false,
  deliveryLocationId: null,
  deliveryLocation: null,
  requestCollection: false,
  collectionLocationId: null,
  collectionLocation: null,
  promoCode: null,
  selectedVehicleId: null,
  selectedExtras: [],
  insuranceOption: null,
};

export const useBookingStore = create<BookingState>()((set, get) => ({
  context: initialContext,
  pendingInsuranceFiles: [],

  setContext: (context) => set({ context: { ...initialContext, ...context } }),

  updateContext: (updates) =>
    set((state) => ({
      context: { ...state.context, ...updates },
    })),

  clearContext: () => set({ context: initialContext, pendingInsuranceFiles: [] }),

  addPendingInsuranceFile: (file) =>
    set((state) => ({
      pendingInsuranceFiles: [...state.pendingInsuranceFiles, file],
    })),

  clearPendingInsuranceFiles: () => set({ pendingInsuranceFiles: [] }),

  getPendingInsuranceFiles: () => get().pendingInsuranceFiles,

  getFullContext: () => get().context,
}));

// Convenience hook for common booking operations
export const useBooking = () => {
  const store = useBookingStore();
  return {
    context: store.context,
    pendingInsuranceFiles: store.pendingInsuranceFiles,
    setContext: store.setContext,
    updateContext: store.updateContext,
    clearContext: store.clearContext,
    addPendingInsuranceFile: store.addPendingInsuranceFile,
    clearPendingInsuranceFiles: store.clearPendingInsuranceFiles,
    hasInsuranceUploads: store.pendingInsuranceFiles.length > 0,
  };
};
