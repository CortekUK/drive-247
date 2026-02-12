import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

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
  selectedExtras: Record<string, number>;
  insuranceOption: string | null;
}

/**
 * Widget form data — persisted to sessionStorage via Zustand persist.
 * This IS the form state (no separate useState copy).
 */
export interface WidgetFormData {
  pickupLocation: string;
  dropoffLocation: string;
  pickupLocationId: string;
  returnLocationId: string;
  pickupDeliveryFee: number;
  returnDeliveryFee: number;
  pickupDate: string;
  dropoffDate: string;
  pickupTime: string;
  dropoffTime: string;
  specialRequests: string;
  vehicleId: string;
  driverDOB: string;
  promoCode: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  customerType: string;
  licenseNumber: string;
  licenseState: string;
  addressStreet: string;
  addressCity: string;
  addressState: string;
  addressZip: string;
  verificationSessionId: string;
  customerTimezone: string;
}

export const initialWidgetFormData: WidgetFormData = {
  pickupLocation: "",
  dropoffLocation: "",
  pickupLocationId: "",
  returnLocationId: "",
  pickupDeliveryFee: 0,
  returnDeliveryFee: 0,
  pickupDate: "",
  dropoffDate: "",
  pickupTime: "",
  dropoffTime: "",
  specialRequests: "",
  vehicleId: "",
  driverDOB: "",
  promoCode: "",
  customerName: "",
  customerEmail: "",
  customerPhone: "",
  customerType: "",
  licenseNumber: "",
  licenseState: "",
  addressStreet: "",
  addressCity: "",
  addressState: "",
  addressZip: "",
  verificationSessionId: "",
  customerTimezone: "",
};

type FormDataUpdater = WidgetFormData | ((prev: WidgetFormData) => WidgetFormData);
type StepUpdater = number | ((prev: number) => number);
type ExtrasUpdater = string[] | ((prev: string[]) => string[]);

interface BookingState {
  // Booking flow data
  context: BookingContext;

  // Pending insurance uploads (stored in Supabase storage, not yet linked)
  pendingInsuranceFiles: PendingInsuranceFile[];

  // Widget state — persisted to sessionStorage, used directly by the widget (no useState copy)
  formData: WidgetFormData;
  currentStep: number;
  selectedExtras: string[];

  // Actions
  setContext: (context: Partial<BookingContext>) => void;
  updateContext: (updates: Partial<BookingContext>) => void;
  clearContext: () => void;

  // Insurance file actions
  addPendingInsuranceFile: (file: PendingInsuranceFile) => void;
  clearPendingInsuranceFiles: () => void;
  getPendingInsuranceFiles: () => PendingInsuranceFile[];

  // Widget state setters — support both direct value and callback (like useState)
  setFormData: (updater: FormDataUpdater) => void;
  setCurrentStep: (updater: StepUpdater) => void;
  setSelectedExtras: (updater: ExtrasUpdater) => void;

  // Full clear (context + widget + insurance + legacy storage keys)
  clearBooking: () => void;

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
  selectedExtras: {},
  insuranceOption: null,
};

export const useBookingStore = create<BookingState>()(
  persist(
    (set, get) => ({
      context: initialContext,
      pendingInsuranceFiles: [],
      formData: initialWidgetFormData,
      currentStep: 1,
      selectedExtras: [],

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

      setFormData: (updater) =>
        set((state) => ({
          formData: typeof updater === 'function' ? updater(state.formData) : updater,
        })),

      setCurrentStep: (updater) =>
        set((state) => ({
          currentStep: typeof updater === 'function' ? updater(state.currentStep) : updater,
        })),

      setSelectedExtras: (updater) =>
        set((state) => ({
          selectedExtras: typeof updater === 'function' ? updater(state.selectedExtras) : updater,
        })),

      clearBooking: () => {
        set({
          context: initialContext,
          pendingInsuranceFiles: [],
          formData: initialWidgetFormData,
          currentStep: 1,
          selectedExtras: [],
        });

        if (typeof window !== 'undefined') {
          sessionStorage.removeItem('booking_form_data');
          sessionStorage.removeItem('booking_current_step');
          sessionStorage.removeItem('booking_selected_extras');
          localStorage.removeItem('appliedPromoCode');
          localStorage.removeItem('appliedPromoDetails');
        }
      },

      getFullContext: () => get().context,
    }),
    {
      name: 'booking-widget',
      storage: createJSONStorage(() =>
        typeof window !== 'undefined' ? sessionStorage : {
          getItem: () => null,
          setItem: () => {},
          removeItem: () => {},
        }
      ),
      partialize: (state) => ({
        formData: state.formData,
        currentStep: state.currentStep,
        selectedExtras: state.selectedExtras,
      }),
    }
  )
);

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
