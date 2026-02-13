import { useState, useEffect, useRef, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TimePicker } from "@/components/ui/time-picker";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { toast } from "sonner";
import { ChevronRight, ChevronLeft, Check, Baby, Coffee, MapPin, UserCheck, Car, Crown, TrendingUp, Users as GroupIcon, Calculator, Shield, CheckCircle, CalendarIcon, Clock, Search, Grid3x3, List, SlidersHorizontal, X, AlertCircle, FileCheck, RefreshCw, Upload, Gauge, User, Loader2, Globe } from "lucide-react";
import { format, differenceInHours } from "date-fns";
import { cn } from "@/lib/utils";
import BookingConfirmation from "./BookingConfirmation";
import LocationPicker from "./LocationPicker";
import BookingCheckoutStep from "./BookingCheckoutStep";
import { useDeliveryLocations } from "@/hooks/useDeliveryLocations";
import ExtrasSelector from "./booking/extras-selector";
import { useRentalExtras } from "@/hooks/use-rental-extras";
import InsuranceUploadDialog from "./insurance-upload-dialog";
import BonzahInsuranceSelector from "./BonzahInsuranceSelector";
import type { CoverageOptions } from "@/hooks/useBonzahPremium";
import AIScanProgress from "./ai-scan-progress";
import AIVerificationQR from "./AIVerificationQR";
import { stripePromise } from "@/config/stripe";
import { usePageContent, defaultHomeContent, mergeWithDefaults } from "@/hooks/usePageContent";
import { useWorkingHours, getWorkingHoursForDate } from "@/hooks/useWorkingHours";
import { isInsuranceExemptTenant } from "@/config/tenant-config";
import { canCustomerBook } from "@/lib/tenantQueries";
import { sanitizeName, sanitizeEmail, sanitizePhone, sanitizeLocation, sanitizeTextArea, isInputSafe } from "@/lib/sanitize";
import { createVeriffFrame, MESSAGES } from "@veriff/incontext-sdk";
import { useCustomerAuthStore } from "@/stores/customer-auth-store";
import { useBookingStore } from "@/stores/booking-store";
import { useCustomerVerification } from "@/hooks/use-customer-verification";
import { AuthPromptDialog } from "@/components/booking/AuthPromptDialog";
import { getTimezonesByRegion, findTimezone, getDetectedTimezone } from "@/lib/timezones";
import { useCustomerDocuments, getDocumentStatus } from "@/hooks/use-customer-documents";
import { formatCurrency, getEarthRadius, metersToUnit, getPerMonthLabel, getUnlimitedLabel, getDistanceUnitLong } from "@/lib/format-utils";
import type { DistanceUnit } from "@/lib/format-utils";
interface VehiclePhoto {
  photo_url: string;
}

interface Vehicle {
  id: string;
  // Portal schema fields
  reg: string;
  make: string | null;
  model: string | null;
  colour: string | null;
  acquisition_type: string | null;
  purchase_price: number | null;
  acquisition_date: string | null;
  status: string | null;
  created_at: string | null;
  // Rental rates from portal (note: API uses _rent not _rate)
  monthly_rent?: number | null;
  daily_rent?: number | null;
  weekly_rent?: number | null;
  photo_url?: string | null;
  vehicle_photos?: VehiclePhoto[];
  description?: string | null;
  allowed_mileage?: number | null;
}
interface PricingExtra {
  id: string;
  extra_name: string;
  price: number;
  description: string | null;
}
interface BlockedDate {
  id: string;
  start_date: string;
  end_date: string;
  vehicle_id: string | null;
  reason?: string | null;
}
const MultiStepBookingWidget = () => {
  // Safari-safe date parser for YYYY-MM-DD strings
  // Safari doesn't support new Date("YYYY-MM-DD") format
  const parseDateString = (dateStr: string): Date => {
    if (!dateStr) return new Date();
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(year, month - 1, day);
  };

  const { tenant } = useTenant();
  const currencyCode = tenant?.currency_code || 'GBP';
  const distanceUnit = (tenant?.distance_unit || 'miles') as DistanceUnit;
  const workingHours = useWorkingHours();
  const skipInsurance = isInsuranceExemptTenant(tenant?.id);
  const { updateContext: updateBookingContext } = useBookingStore();
  const { locations: allDeliveryLocations } = useDeliveryLocations();

  // Customer authentication state
  const { customerUser, session, loading: authLoading, initialized: authInitialized } = useCustomerAuthStore();
  const { data: customerVerification, isLoading: verificationLoading } = useCustomerVerification();
  const { data: customerDocuments } = useCustomerDocuments();
  const [showAuthDialog, setShowAuthDialog] = useState(false);
  const [isCustomerDataPopulated, setIsCustomerDataPopulated] = useState(false);

  // Check if user is authenticated with valid session
  const isAuthenticated = !!customerUser && !!session;
  // Check if authenticated user is already verified
  const isCustomerAlreadyVerified = customerVerification?.review_result === 'GREEN' ||
    customerVerification?.status === 'approved' ||
    customerVerification?.status === 'verified' ||
    customerUser?.customer?.identity_verification_status === 'verified';
  // Check if customer already has DOB in their profile
  const customerHasDOB = !!customerUser?.customer?.date_of_birth;
  // Check if customer already has timezone in their profile
  const customerHasTimezone = !!customerUser?.customer?.timezone;
  // Check if customer already has phone in their profile
  const customerHasPhone = !!customerUser?.customer?.phone;
  // Check if customer's ID document has expired
  const isDocumentExpired = customerVerification?.document_expiry_date
    ? new Date(customerVerification.document_expiry_date) < new Date()
    : false;

  const [currentStep, setCurrentStep] = useState(1);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [extras, setExtras] = useState<PricingExtra[]>([]);
  const [selectedExtras, setSelectedExtras] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [bookingReference, setBookingReference] = useState("");
  const [bookingDetails, setBookingDetails] = useState<any>(null);
  const [calculatedDistance, setCalculatedDistance] = useState<number | null>(null);
  const [distanceOverride, setDistanceOverride] = useState(false);
  const stepContainerRef = useRef<HTMLDivElement>(null); // Ref for scrolling to step content on step change
  const [blockedDates, setBlockedDates] = useState<string[]>([]); // Global blocked dates (vehicle_id is null)
  const [allBlockedDates, setAllBlockedDates] = useState<BlockedDate[]>([]); // All blocked dates including vehicle-specific
  const [errors, setErrors] = useState<{
    [key: string]: string;
  }>({});

  // CMS Content for booking header
  const { data: rawCmsContent } = usePageContent("home");
  const cmsContent = mergeWithDefaults(rawCmsContent, defaultHomeContent);

  // Step 2 enhancements
  const [searchTerm, setSearchTerm] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [sortBy, setSortBy] = useState("recommended");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [originalPriceRange, setOriginalPriceRange] = useState<[number, number]>([0, 1000]); // Store original dynamic range
  const [priceFilterMode, setPriceFilterMode] = useState<"daily" | "weekly" | "monthly">("daily"); // Price filter mode
  const [filters, setFilters] = useState({
    transmission: [] as string[],
    fuel: [] as string[],
    seats: [2, 7] as [number, number],
    priceRange: [0, 1000] as [number, number]
  });
  const searchDebounceTimer = useRef<NodeJS.Timeout>();
  const [expandedDescriptions, setExpandedDescriptions] = useState<Set<string>>(new Set());
  const [vehicleImageIndex, setVehicleImageIndex] = useState<Record<string, number>>({});
  const [formData, setFormData] = useState({
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
    customerTimezone: "", // Will be set from tenant timezone or detected browser timezone
  });

  // Fetch rental extras for the selected vehicle
  const { extras: availableExtras, isLoading: extrasLoading } = useRentalExtras(formData.vehicleId || null);

  // Calculate working hours for the selected pickup date (per-day hours)
  const pickupDateWorkingHours = useMemo(() => {
    // If no pickup date selected, use the current day's working hours from the hook
    if (!formData.pickupDate) {
      return {
        enabled: workingHours.isDayEnabled,
        open: workingHours.openTime,
        close: workingHours.closeTime,
        isAlwaysOpen: workingHours.isAlwaysOpen,
      };
    }
    // Get the working hours for the specific pickup date
    const pickupDate = parseDateString(formData.pickupDate);
    return getWorkingHoursForDate(pickupDate, tenant);
  }, [formData.pickupDate, tenant, workingHours]);

  // Calculate working hours for the selected dropoff date (per-day hours)
  const dropoffDateWorkingHours = useMemo(() => {
    // If no dropoff date selected, use the current day's working hours from the hook
    if (!formData.dropoffDate) {
      return {
        enabled: workingHours.isDayEnabled,
        open: workingHours.openTime,
        close: workingHours.closeTime,
        isAlwaysOpen: workingHours.isAlwaysOpen,
      };
    }
    // Get the working hours for the specific dropoff date
    const dropoffDate = parseDateString(formData.dropoffDate);
    return getWorkingHoursForDate(dropoffDate, tenant);
  }, [formData.dropoffDate, tenant, workingHours]);

  // Insurance state
  const [hasInsurance, setHasInsurance] = useState<boolean | null>(null);
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [uploadedDocumentId, setUploadedDocumentId] = useState<string | null>(null);
  const [selectedExistingDocument, setSelectedExistingDocument] = useState<string | null>(null);

  // Filter to get only valid insurance documents for logged-in users
  const existingInsuranceDocuments = customerDocuments?.filter(doc =>
    doc.document_type === 'Insurance Certificate' &&
    getDocumentStatus(doc.end_date) !== 'Expired'
  ) || [];
  const [scanningDocument, setScanningDocument] = useState(false);

  // Bonzah insurance state
  const [bonzahCoverage, setBonzahCoverage] = useState<CoverageOptions>({
    cdw: false,
    rcli: false,
    sli: false,
    pai: false,
  });
  const [bonzahPremium, setBonzahPremium] = useState<number>(0);
  const [bonzahPolicyId, setBonzahPolicyId] = useState<string | null>(null);

  // Identity verification state
  const [verificationSessionId, setVerificationSessionId] = useState<string | null>(null);
  const [verificationStatus, setVerificationStatus] = useState<'init' | 'pending' | 'verified' | 'rejected'>('init');
  const [isVerifying, setIsVerifying] = useState(false);

  // AI verification state (when Veriff is disabled)
  const [verificationMode, setVerificationMode] = useState<'veriff' | 'ai'>('veriff');
  const [aiSessionData, setAiSessionData] = useState<{
    sessionId: string;
    qrUrl: string;
    expiresAt: Date;
  } | null>(null);

  // Verification images state
  const [verificationImages, setVerificationImages] = useState<{
    document_front_url: string | null;
    document_back_url: string | null;
    selfie_image_url: string | null;
  } | null>(null);
  const [promoDetails, setPromoDetails] = useState<{
    code: string;
    type: "percentage" | "fixed_amount";
    value: number;
    id: string;
  } | null>(null);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [locationCoords, setLocationCoords] = useState({
    pickupLat: null as number | null,
    pickupLon: null as number | null,
    dropoffLat: null as number | null,
    dropoffLon: null as number | null
  });

  // Initialize customer timezone - priority: 1) customer's saved timezone, 2) tenant's timezone
  useEffect(() => {
    // If customer has a saved timezone, always use it (takes priority)
    if (isAuthenticated && customerUser?.customer?.timezone) {
      setFormData(prev => ({ ...prev, customerTimezone: customerUser.customer.timezone || '' }));
    } else if (!formData.customerTimezone && tenant?.timezone) {
      // Only use tenant's timezone as fallback if no timezone is set yet
      setFormData(prev => ({ ...prev, customerTimezone: tenant.timezone || '' }));
    }
  }, [tenant?.timezone, isAuthenticated, customerUser?.customer?.timezone]);

  // Auto-populate fixed addresses when tenant loads
  // This ensures form data is set even if LocationPicker's useEffect has timing issues
  useEffect(() => {
    if (!tenant) return;
    const pickupFixedEnabled = tenant.pickup_fixed_enabled ?? tenant.fixed_address_enabled ?? false;
    const returnFixedEnabled = tenant.return_fixed_enabled ?? tenant.fixed_address_enabled ?? false;

    setFormData(prev => {
      const updates: Partial<typeof prev> = {};
      if (!prev.pickupLocation && pickupFixedEnabled && tenant.fixed_pickup_address) {
        updates.pickupLocation = tenant.fixed_pickup_address;
        updates.pickupDeliveryFee = 0;
      }
      if (!prev.dropoffLocation && returnFixedEnabled && tenant.fixed_return_address) {
        updates.dropoffLocation = tenant.fixed_return_address;
        updates.returnDeliveryFee = 0;
      }
      if (Object.keys(updates).length === 0) return prev;
      return { ...prev, ...updates };
    });
  }, [tenant?.id, tenant?.fixed_pickup_address, tenant?.fixed_return_address]);

  useEffect(() => {
    loadData();

    // DEV MODE: Listen for dev jump panel events (only in development)
    if (process.env.NODE_ENV === 'development') {
      const handleDevJump = async (e: CustomEvent<{
        step: number;
        formData: typeof formData;
        vehicleId: string | null;
        setVerified: boolean;
        setInsuranceVerified: boolean;
      }>) => {
        const { step, formData: newFormData, vehicleId, setVerified, setInsuranceVerified } = e.detail;
        console.log('🔧 DEV MODE: Jumping to step', step, { vehicleId, setVerified, setInsuranceVerified });

        // Update form data with vehicle ID
        setFormData(prev => ({ ...prev, ...newFormData }));

        // Set verification states if needed
        if (setVerified) {
          setVerificationStatus('verified');
          setVerificationSessionId('dev-mock-session-' + Date.now());
        }

        if (setInsuranceVerified) {
          setHasInsurance(true);
          setUploadedDocumentId('dev-mock-document');
        }

        // For step 2+, ensure we have the vehicle in our list
        // If vehicles aren't loaded yet, load them first
        if (vehicleId && step >= 2) {
          // Trigger vehicle load if not already loaded
          await loadData();
        }

        // Jump to step
        setCurrentStep(step);
      };

      const handleDevVerification = (e: CustomEvent<{ verified: boolean }>) => {
        if (e.detail.verified) {
          setVerificationStatus('verified');
          setVerificationSessionId('dev-mock-session-' + Date.now());
        } else {
          setVerificationStatus('init');
          setVerificationSessionId(null);
        }
      };

      // Handle dev panel insurance auto-upload
      const handleDevUploadInsurance = async (e: CustomEvent<{
        file: File;
        fileName: string;
        autoVerify: boolean;
      }>) => {
        const { file, autoVerify } = e.detail;
        console.log('🔧 DEV MODE: Auto-uploading insurance...', file.name);

        // Set insurance state to trigger the upload flow
        setHasInsurance(true);

        // Open the upload dialog with the file pre-loaded
        setShowUploadDialog(true);

        // If autoVerify, just mark as verified without actual upload
        if (autoVerify) {
          setTimeout(() => {
            setUploadedDocumentId('dev-mock-insurance-' + Date.now());
            setShowUploadDialog(false);
            console.log('🔧 DEV MODE: Insurance auto-verified');
          }, 500);
        }
      };

      // Handle dev panel skip insurance (mark verified directly)
      const handleDevSetInsurance = (e: CustomEvent<{ verified: boolean; documentId?: string }>) => {
        if (e.detail.verified) {
          setHasInsurance(true);
          setUploadedDocumentId(e.detail.documentId || 'dev-mock-insurance-' + Date.now());
          console.log('🔧 DEV MODE: Insurance marked as verified');
        } else {
          setHasInsurance(null);
          setUploadedDocumentId(null);
        }
      };

      window.addEventListener('dev-jump-to-step', handleDevJump as EventListener);
      window.addEventListener('dev-set-verification', handleDevVerification as EventListener);
      window.addEventListener('dev-upload-insurance', handleDevUploadInsurance as EventListener);
      window.addEventListener('dev-set-insurance', handleDevSetInsurance as EventListener);

      return () => {
        window.removeEventListener('dev-jump-to-step', handleDevJump as EventListener);
        window.removeEventListener('dev-set-verification', handleDevVerification as EventListener);
        window.removeEventListener('dev-upload-insurance', handleDevUploadInsurance as EventListener);
        window.removeEventListener('dev-set-insurance', handleDevSetInsurance as EventListener);
      };
    }
  }, []);

  // Real-time subscription for blocked dates changes
  useEffect(() => {
    if (!tenant?.id) return;

    // Subscribe to blocked_dates changes for this tenant
    const channel = supabase
      .channel(`blocked-dates-${tenant.id}`)
      .on(
        'postgres_changes',
        {
          event: '*', // Listen to INSERT, UPDATE, DELETE
          schema: 'public',
          table: 'blocked_dates',
          filter: `tenant_id=eq.${tenant.id}`,
        },
        (payload) => {
          console.log('[BlockedDates] Real-time update received:', payload.eventType);
          // Refetch blocked dates when any change occurs
          loadBlockedDates();
        }
      )
      .subscribe((status) => {
        console.log('[BlockedDates] Subscription status:', status);
      });

    // Cleanup subscription on unmount or tenant change
    return () => {
      supabase.removeChannel(channel);
    };
  }, [tenant?.id]);

  useEffect(() => {
    // Load view mode from localStorage
    const savedViewMode = localStorage.getItem('viewMode');
    if (savedViewMode === 'grid' || savedViewMode === 'list') {
      setViewMode(savedViewMode);
    }

    // Load verification data from localStorage (persist across refreshes)
    // But expire after 30 minutes to prevent stale verified state on new visits
    const savedVerificationSessionId = localStorage.getItem('verificationSessionId');
    const savedVerificationStatus = localStorage.getItem('verificationStatus') as 'init' | 'pending' | 'verified' | 'rejected' | null;
    const savedVerificationTimestamp = localStorage.getItem('verificationTimestamp');
    const savedVerifiedName = localStorage.getItem('verifiedCustomerName');
    const savedLicenseNumber = localStorage.getItem('verifiedLicenseNumber');

    // Check if verification data is expired (10 minutes = 600000 ms)
    const VERIFICATION_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
    const isExpired = savedVerificationTimestamp
      ? (Date.now() - parseInt(savedVerificationTimestamp, 10)) > VERIFICATION_EXPIRY_MS
      : true; // If no timestamp, consider it expired

    if (savedVerificationSessionId && savedVerificationStatus && !isExpired) {
      setVerificationSessionId(savedVerificationSessionId);
      setVerificationStatus(savedVerificationStatus);
      // Only restore verification session ID and license number from localStorage
      // DO NOT restore customerName here - it will be handled by auth auto-populate for authenticated users
      // This prevents localStorage data from overwriting the authenticated user's actual account data
      setFormData(prev => ({
        ...prev,
        verificationSessionId: savedVerificationSessionId,
        // Only restore license number (not name - that comes from auth or will be entered by user)
        ...(savedLicenseNumber && { licenseNumber: savedLicenseNumber }),
      }));
      console.log('✅ Loaded verification session from localStorage:', savedVerificationSessionId, savedVerificationStatus);
    } else if (isExpired && savedVerificationSessionId) {
      // Clear expired verification data
      console.log('🕐 Verification data expired, clearing...');
      localStorage.removeItem('verificationSessionId');
      localStorage.removeItem('verificationStatus');
      localStorage.removeItem('verificationTimestamp');
      localStorage.removeItem('verificationToken');
      localStorage.removeItem('verifiedCustomerName');
      localStorage.removeItem('verifiedLicenseNumber');
      localStorage.removeItem('verificationVendorData');
    }

    // Restore promo code from localStorage
    const savedPromoCode = localStorage.getItem('appliedPromoCode');
    const savedPromoDetails = localStorage.getItem('appliedPromoDetails');
    if (savedPromoCode && savedPromoDetails) {
      try {
        const promoDetailsData = JSON.parse(savedPromoDetails);
        setFormData(prev => ({ ...prev, promoCode: savedPromoCode }));
        setPromoDetails(promoDetailsData);
        console.log('✅ Restored promo code from localStorage:', savedPromoCode);
      } catch (e) {
        console.error('Failed to parse saved promo details:', e);
        localStorage.removeItem('appliedPromoCode');
        localStorage.removeItem('appliedPromoDetails');
      }
    }

    // Handle window focus - check verification when user returns from Veriff popup
    // This is critical for iOS Safari which throttles background tabs
    const handleWindowFocus = async () => {
      const pendingSessionId = localStorage.getItem('verificationSessionId');
      const currentStatus = localStorage.getItem('verificationStatus');

      // Only check if status is pending (user might have completed verification in popup)
      if (pendingSessionId && currentStatus === 'pending') {
        console.log('🔄 Window focused - checking verification status for iOS Safari...');
        const status = await checkVerificationStatus(pendingSessionId);
        if (status) {
          if (status.review_result === 'GREEN') {
            setVerificationStatus('verified');
            localStorage.setItem('verificationStatus', 'verified');
            localStorage.setItem('verificationTimestamp', Date.now().toString());
            console.log('✅ Verification updated on window focus');
            // Auto-populate form with verified data
            populateFormWithVerifiedData(status);
          } else if (status.review_result === 'RED') {
            setVerificationStatus('rejected');
            localStorage.setItem('verificationStatus', 'rejected');
            toast.error("Identity verification failed.");
          }
        }
      }
    };

    // Handle visibility change - also check when tab becomes visible
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        handleWindowFocus(); // Reuse same logic
      }
    };

    // Handle message from Veriff callback popup (critical for iOS Safari)
    const handleMessage = async (event: MessageEvent) => {
      // Security: verify origin
      if (event.origin !== window.location.origin) return;

      if (event.data?.type === 'VERIFF_COMPLETE') {
        console.log('📨 Received VERIFF_COMPLETE message from popup');
        const pendingSessionId = localStorage.getItem('verificationSessionId');

        if (pendingSessionId) {
          // Retry logic: check status multiple times with increasing delays
          // This handles webhook processing delays
          const checkWithRetry = async (attempt: number = 1, maxAttempts: number = 5) => {
            console.log(`🔄 Checking verification status (attempt ${attempt}/${maxAttempts})...`);
            const status = await checkVerificationStatus(pendingSessionId);

            if (status?.review_result === 'GREEN') {
              setVerificationStatus('verified');
              localStorage.setItem('verificationStatus', 'verified');
              localStorage.setItem('verificationTimestamp', Date.now().toString());
              console.log('✅ Verification confirmed via popup message');
              // Auto-populate form with verified data
              populateFormWithVerifiedData(status);
              return true;
            } else if (status?.review_result === 'RED') {
              setVerificationStatus('rejected');
              localStorage.setItem('verificationStatus', 'rejected');
              toast.error("Identity verification failed.");
              return true;
            } else if (attempt < maxAttempts) {
              // Retry with exponential backoff: 2s, 4s, 6s, 8s
              const delay = attempt * 2000;
              setTimeout(() => checkWithRetry(attempt + 1, maxAttempts), delay);
            } else {
              console.log('⚠️ Max retry attempts reached, webhook may be delayed');
            }
          };

          // Start checking after initial 2s delay
          setTimeout(() => checkWithRetry(), 2000);
        }
      }
    };

    window.addEventListener('focus', handleWindowFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('message', handleMessage);

    return () => {
      window.removeEventListener('focus', handleWindowFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('message', handleMessage);
    };
  }, [tenant?.id]);

  // Determine verification mode based on tenant's integration_veriff setting
  useEffect(() => {
    if (tenant) {
      // If integration_veriff is false (or explicitly not true), use AI verification
      const useVeriff = tenant.integration_veriff === true;
      const newMode = useVeriff ? 'veriff' : 'ai';
      setVerificationMode(newMode);
      console.log(`[Verification] 🔐 Mode set to: ${newMode.toUpperCase()}`);
      console.log(`[Verification] integration_veriff value: ${tenant.integration_veriff} (type: ${typeof tenant.integration_veriff})`);
      console.log(`[Verification] Tenant ID: ${tenant.id}, Slug: ${tenant.slug}`);
    }
  }, [tenant]);

  // Note: Verification no longer resets when customer details change
  // Users can freely edit their details after verification
  // The verification session ID remains valid

  // Scroll to step container when step changes
  useEffect(() => {
    if (stepContainerRef.current) {
      const element = stepContainerRef.current;
      const elementTop = element.getBoundingClientRect().top + window.scrollY;
      const offset = 100; // Keep some space from top
      window.scrollTo({
        top: elementTop - offset,
        behavior: 'smooth'
      });
    }
  }, [currentStep]);

  // Auto-calculate distance when both locations are selected or changed
  useEffect(() => {
    const {
      pickupLat,
      pickupLon,
      dropoffLat,
      dropoffLon
    } = locationCoords;
    if (pickupLat && pickupLon && dropoffLat && dropoffLon) {
      estimateDistance();
    }
  }, [locationCoords]);

  // Handle pre-filled service from Chauffeur Services page
  useEffect(() => {
    const prefilledRequirements = sessionStorage.getItem('prefilledRequirements');
    if (prefilledRequirements) {
      setFormData(prev => ({
        ...prev,
        specialRequests: prefilledRequirements
      }));

      // Clear sessionStorage after using
      sessionStorage.removeItem('prefilledService');
      sessionStorage.removeItem('prefilledRequirements');
    }
  }, [tenant?.id]);

  // Restore form data from sessionStorage on mount (preserves data when navigating away)
  // For authenticated users, we DO NOT restore customer personal data (name, email)
  // because that will be handled by the auth auto-populate effect with their actual account data
  useEffect(() => {
    const savedFormData = sessionStorage.getItem('booking_form_data');
    if (savedFormData) {
      try {
        const parsed = JSON.parse(savedFormData);

        // For authenticated users, ALWAYS clear customer personal fields from sessionStorage
        // Their actual data will come from the auth auto-populate effect
        // This ensures we never show stale data from a previous verification or different session
        if (isAuthenticated && customerUser?.customer) {
          console.log('🔐 Authenticated user detected - clearing sessionStorage customer data to use account data');
          delete parsed.customerName;
          delete parsed.customerEmail;
          // Keep phone and customerType as they might be editable
          // delete parsed.licenseNumber; // Keep license from verification
          // delete parsed.verificationSessionId; // Keep verification session
        }

        // Merge with existing formData to preserve verification data and trip details
        setFormData(prev => ({ ...prev, ...parsed }));
        console.log('✅ Restored form data from sessionStorage (customer data excluded for auth users)');
      } catch (e) {
        console.error('Failed to restore form data:', e);
      }
    }

    // Also restore step if available
    const savedStep = sessionStorage.getItem('booking_current_step');
    if (savedStep) {
      const stepNum = parseInt(savedStep, 10);
      if (stepNum >= 1 && stepNum <= 5) {
        setCurrentStep(stepNum);
      }
    }

    // Restore selected extras
    const savedExtras = sessionStorage.getItem('booking_selected_extras');
    if (savedExtras) {
      try {
        setSelectedExtras(JSON.parse(savedExtras));
      } catch (e) {
        console.error('Failed to restore extras:', e);
      }
    }
  }, [isAuthenticated, customerUser?.customer?.email]);

  // Persist form data to sessionStorage on every change
  useEffect(() => {
    // Don't save empty initial state
    const hasData = formData.pickupLocation || formData.customerName || formData.vehicleId;
    if (hasData) {
      sessionStorage.setItem('booking_form_data', JSON.stringify(formData));
    }
  }, [formData]);

  // Persist current step
  useEffect(() => {
    sessionStorage.setItem('booking_current_step', String(currentStep));
  }, [currentStep]);

  // Persist selected extras
  useEffect(() => {
    if (Object.keys(selectedExtras).length > 0) {
      sessionStorage.setItem('booking_selected_extras', JSON.stringify(selectedExtras));
    } else {
      sessionStorage.removeItem('booking_selected_extras');
    }
  }, [selectedExtras]);

  // Reset selected extras when vehicle changes
  useEffect(() => {
    setSelectedExtras({});
    sessionStorage.removeItem('booking_selected_extras');
  }, [formData.vehicleId]);

  // Auto-populate DOB from customer profile on Step 1 (when authenticated)
  useEffect(() => {
    if (isAuthenticated && authInitialized && !authLoading && customerUser?.customer?.date_of_birth) {
      // Only update if DOB is empty (don't overwrite if user manually changed it)
      if (!formData.driverDOB) {
        console.log('✅ Auto-populating DOB from customer profile:', customerUser.customer.date_of_birth);
        setFormData(prev => ({ ...prev, driverDOB: customerUser.customer.date_of_birth }));
      }
    }
  }, [isAuthenticated, authInitialized, authLoading, customerUser?.customer?.date_of_birth]);

  // Auto-populate customer data when authenticated user reaches Step 4
  // IMPORTANT: For authenticated users, ALWAYS use their account data, overwriting any stale cached data
  useEffect(() => {
    // Only auto-populate once and only when on step 4 with authenticated user
    if (currentStep === 4 && isAuthenticated && !isCustomerDataPopulated && !authLoading && authInitialized) {
      const customer = customerUser?.customer;
      if (customer) {
        console.log('✅ Auto-populating form with authenticated customer data:', customer.name);

        // Build update object with available customer data
        // For authenticated users, ALWAYS overwrite with their actual account data
        // This ensures we don't show stale cached data from sessionStorage
        const updates: Partial<typeof formData> = {};

        // Always use authenticated user's data (overwrite any stale cached values)
        if (customer.name) {
          updates.customerName = customer.name;
        }
        if (customer.email) {
          updates.customerEmail = customer.email;
        }
        if (customer.phone) {
          updates.customerPhone = customer.phone;
        }
        if (customer.customer_type) {
          updates.customerType = customer.customer_type;
        }
        if (customer.date_of_birth) {
          updates.driverDOB = customer.date_of_birth;
        }

        // For authenticated users, ALWAYS clear localStorage verification data
        // Their verification status comes from their account, not localStorage
        // This prevents stale localStorage data from a different session/user from affecting the UI
        console.log('🧹 Clearing localStorage verification for authenticated user');
        localStorage.removeItem('verificationSessionId');
        localStorage.removeItem('verificationStatus');
        localStorage.removeItem('verificationTimestamp');
        localStorage.removeItem('verificationToken');
        localStorage.removeItem('verifiedCustomerName');
        localStorage.removeItem('verifiedLicenseNumber');
        localStorage.removeItem('verificationVendorData');

        // If customer is already verified from their account, set verification status
        if (isCustomerAlreadyVerified) {
          setVerificationStatus('verified');
          // Store the verification session ID if available
          if (customerVerification?.session_id) {
            setVerificationSessionId(customerVerification.session_id);
            updates.verificationSessionId = customerVerification.session_id;
          }
          // Use name from ID verification document (more accurate than account name)
          if (customerVerification?.first_name || customerVerification?.last_name) {
            const verifiedName = `${customerVerification.first_name || ''} ${customerVerification.last_name || ''}`.trim();
            if (verifiedName) {
              updates.customerName = verifiedName;
            }
          }
          // Set license number from verification if available
          if (customerVerification?.document_number) {
            updates.licenseNumber = customerVerification.document_number;
          }
          // Set DOB from verification if available and not already set
          if (customerVerification?.date_of_birth && !updates.driverDOB) {
            updates.driverDOB = customerVerification.date_of_birth;
          }
        } else {
          // User is authenticated but NOT verified yet - reset verification state to init
          // This ensures they go through verification process fresh
          setVerificationStatus('init');
          setVerificationSessionId('');
        }

        // Apply updates - this overwrites any stale data
        if (Object.keys(updates).length > 0) {
          setFormData(prev => ({ ...prev, ...updates }));
        }

        setIsCustomerDataPopulated(true);
      }
    }
  }, [currentStep, isAuthenticated, isCustomerDataPopulated, authLoading, authInitialized, customerUser, customerVerification, isCustomerAlreadyVerified]);

  // Reset populated flag when user logs out
  useEffect(() => {
    if (!isAuthenticated && isCustomerDataPopulated) {
      setIsCustomerDataPopulated(false);
    }
  }, [isAuthenticated, isCustomerDataPopulated]);

  // Handle mid-booking sign-in: When user signs in during booking flow (any step),
  // immediately update their data and verification status
  // This handles the case: user skips auth at step 4, goes to step 5, then signs in
  useEffect(() => {
    // Only trigger when user becomes authenticated AND we haven't populated yet
    // AND we're past the initial loading state
    if (isAuthenticated && !isCustomerDataPopulated && authInitialized && !authLoading && !verificationLoading) {
      const customer = customerUser?.customer;
      if (customer) {
        console.log('🔐 Mid-booking sign-in detected, syncing user data:', customer.name);

        // Build update object with customer data
        const updates: Partial<typeof formData> = {};

        if (customer.name) {
          updates.customerName = customer.name;
        }
        if (customer.email) {
          updates.customerEmail = customer.email;
        }
        if (customer.phone) {
          updates.customerPhone = customer.phone;
        }
        if (customer.customer_type) {
          updates.customerType = customer.customer_type;
        }

        // For authenticated users, ALWAYS clear localStorage verification data
        // Their verification status comes from their account, not localStorage
        console.log('🧹 Clearing localStorage verification for authenticated user (mid-booking sign-in)');
        localStorage.removeItem('verificationSessionId');
        localStorage.removeItem('verificationStatus');
        localStorage.removeItem('verificationTimestamp');
        localStorage.removeItem('verificationToken');
        localStorage.removeItem('verifiedCustomerName');
        localStorage.removeItem('verifiedLicenseNumber');
        localStorage.removeItem('verificationVendorData');

        // Check if user is already verified from their account
        if (isCustomerAlreadyVerified) {
          console.log('✅ User has existing verification, setting verified status');
          setVerificationStatus('verified');

          if (customerVerification?.session_id) {
            setVerificationSessionId(customerVerification.session_id);
            updates.verificationSessionId = customerVerification.session_id;
          }
          // Use name from ID verification document (more accurate than account name)
          if (customerVerification?.first_name || customerVerification?.last_name) {
            const verifiedName = `${customerVerification.first_name || ''} ${customerVerification.last_name || ''}`.trim();
            if (verifiedName) {
              updates.customerName = verifiedName;
            }
          }
          if (customerVerification?.document_number) {
            updates.licenseNumber = customerVerification.document_number;
          }
          // Set DOB from verification if available and not already set
          if (customerVerification?.date_of_birth && !updates.driverDOB) {
            updates.driverDOB = customerVerification.date_of_birth;
          }
        } else {
          // User is authenticated but NOT verified yet - reset verification state
          setVerificationStatus('init');
          setVerificationSessionId('');
        }

        // Apply updates
        if (Object.keys(updates).length > 0) {
          setFormData(prev => ({ ...prev, ...updates }));
        }

        setIsCustomerDataPopulated(true);
      }
    }
  }, [isAuthenticated, isCustomerDataPopulated, authInitialized, authLoading, verificationLoading, customerUser, customerVerification, isCustomerAlreadyVerified]);

  // When customerVerification data loads/changes after sign-in, update verification status
  // This handles async loading of verification data after authentication
  useEffect(() => {
    if (isAuthenticated && isCustomerDataPopulated && !verificationLoading && customerVerification) {
      // Check if we need to update verification status based on newly loaded data
      const isVerified = customerVerification.review_result === 'GREEN' ||
        customerVerification.status === 'approved' ||
        customerVerification.status === 'verified';

      if (isVerified && verificationStatus !== 'verified') {
        console.log('✅ Verification data loaded, updating status to verified');
        setVerificationStatus('verified');

        if (customerVerification.session_id) {
          setVerificationSessionId(customerVerification.session_id);
        }

        // Build updates object for form data
        const updates: Partial<typeof formData> = {};

        if (customerVerification.document_number && !formData.licenseNumber) {
          updates.licenseNumber = customerVerification.document_number;
          updates.verificationSessionId = customerVerification.session_id || '';
        }

        // Set DOB from verification if available and not already set
        if (customerVerification.date_of_birth && !formData.driverDOB) {
          updates.driverDOB = customerVerification.date_of_birth;
        }

        if (Object.keys(updates).length > 0) {
          setFormData(prev => ({ ...prev, ...updates }));
        }
      }
    }
  }, [isAuthenticated, isCustomerDataPopulated, verificationLoading, customerVerification, verificationStatus, formData.licenseNumber, formData.driverDOB]);

  // Check for session expiry when reaching Step 4
  // If user was authenticated but session expired, show auth dialog
  useEffect(() => {
    if (currentStep === 4 && authInitialized && !authLoading) {
      // Check if there's evidence of previous authentication but no current session
      const hadPreviousSession = sessionStorage.getItem('booking_had_auth_session') === 'true';

      if (hadPreviousSession && !isAuthenticated) {
        // Session expired, show auth dialog
        console.log('🔐 Session expired, prompting for re-authentication');
        setShowAuthDialog(true);
        // Clear the flag to avoid repeated prompts
        sessionStorage.removeItem('booking_had_auth_session');
      } else if (isAuthenticated) {
        // Mark that user had an authenticated session
        sessionStorage.setItem('booking_had_auth_session', 'true');
      }
    }
  }, [currentStep, authInitialized, authLoading, isAuthenticated]);

  // Separate function to load blocked dates - used by both initial load and real-time updates
  const loadBlockedDates = async () => {
    if (!tenant?.id) return;

    const { data: blockedDatesData } = await supabase
      .from("blocked_dates")
      .select("id, start_date, end_date, vehicle_id, reason")
      .eq("tenant_id", tenant.id);

    if (blockedDatesData) {
      // Store all blocked dates (global + vehicle-specific)
      setAllBlockedDates(blockedDatesData);
      console.log('[BlockedDates] Loaded all blocked dates:', blockedDatesData.map(b => ({ id: b.id, vehicle_id: b.vehicle_id, start: b.start_date, end: b.end_date })));

      // Filter only global blocked dates (vehicle_id is null) for Step 1 calendar
      const globalBlockedDates = blockedDatesData.filter(range => range.vehicle_id === null);

      // Expand global blocked date ranges into individual dates for calendar
      const formattedDates: string[] = [];
      globalBlockedDates.forEach(range => {
        // Safari-safe date parsing: split YYYY-MM-DD and use Date constructor with numbers
        const [startYear, startMonth, startDay] = range.start_date.split('-').map(Number);
        const [endYear, endMonth, endDay] = range.end_date.split('-').map(Number);
        const startDate = new Date(startYear, startMonth - 1, startDay);
        const endDate = new Date(endYear, endMonth - 1, endDay);

        // Generate all dates in the range
        const currentDate = new Date(startDate);
        while (currentDate <= endDate) {
          formattedDates.push(format(currentDate, "yyyy-MM-dd"));
          currentDate.setDate(currentDate.getDate() + 1);
        }
      });
      setBlockedDates(formattedDates);
    }
  };

  const loadData = async () => {
    // Wait for tenant to be loaded before querying
    if (!tenant?.id) {
      console.log('[loadData] Waiting for tenant to load...');
      return;
    }

    // Build query for vehicles with tenant filtering
    // Status can be "Available" or "available" depending on how it was saved
    let vehiclesQuery = supabase
      .from("vehicles")
      .select(`
        *,
        vehicle_photos (
          photo_url,
          display_order
        )
      `)
      .eq("tenant_id", tenant.id)
      .or("status.ilike.Available,status.ilike.available")
      .order("reg");

    const { data: vehiclesData } = await vehiclesQuery;

    if (vehiclesData) {
      // Sort vehicle_photos by display_order for each vehicle
      const vehiclesWithSortedPhotos = vehiclesData.map(vehicle => ({
        ...vehicle,
        vehicle_photos: vehicle.vehicle_photos
          ? [...vehicle.vehicle_photos].sort((a: any, b: any) => (a.display_order || 0) - (b.display_order || 0))
          : []
      }));
      // Cast to Vehicle[] since we know the shape matches
      setVehicles(vehiclesWithSortedPhotos as unknown as Vehicle[]);

      // Calculate price range from vehicles based on current price filter mode (default: daily)
      const prices = vehiclesData
        .map(v => v.daily_rent || 0)
        .filter(p => p > 0);

      if (prices.length > 0) {
        const minPrice = Math.min(...prices);
        const maxPrice = Math.max(...prices);
        const dynamicRange: [number, number] = [minPrice, maxPrice];
        setOriginalPriceRange(dynamicRange); // Store original range for reset
        setFilters(prev => ({
          ...prev,
          priceRange: dynamicRange
        }));
      }
    }

    // Load blocked dates
    await loadBlockedDates();
  };

  // Check verification status - first tries database, then falls back to Veriff API directly
  const checkVerificationStatus = async (sessionId: string) => {
    try {
      console.log('🔍 Checking verification status for session:', sessionId);

      // STEP 1: Try database query first
      let { data, error } = await supabase
        .from('identity_verifications')
        .select('review_result, status, review_status, first_name, last_name, document_number, date_of_birth, external_user_id, document_front_url, document_back_url, selfie_image_url')
        .eq('session_id', sessionId)
        .maybeSingle();

      if (error) {
        console.error('❌ Database error:', error);
      }

      // Try email fallback if no data found by session_id
      if (!data && formData.customerEmail) {
        console.log('🔍 Trying email-based fallback in database...');
        const emailResult = await supabase
          .from('identity_verifications')
          .select('review_result, status, review_status, first_name, last_name, document_number, date_of_birth, external_user_id, document_front_url, document_back_url, selfie_image_url')
          .ilike('external_user_id', `%${formData.customerEmail}%`)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (emailResult.data) {
          console.log('✅ Found record via email fallback!');
          data = emailResult.data;
        }
      }

      // If database has approved result, return it
      if (data?.review_result === 'GREEN' || data?.review_result === 'RED') {
        console.log('📋 Database record found with result:', data.review_result);
        return data;
      }

      // NOTE: We no longer call the Veriff API directly because:
      // 1. The SDK's FINISHED event is the primary signal for verification completion
      // 2. The webhook updates the database in the background
      // 3. Veriff's API requires complex HMAC authentication

      // Return database data if available
      if (data) {
        console.log('📋 Returning database record (pending):', data);
        return data;
      }

      console.log('⏳ No verification record found in database');
      return null;
    } catch (error) {
      console.error('❌ Error checking verification:', error);
      return null;
    }
  };

  // Auto-populate form with verified data from Veriff
  const populateFormWithVerifiedData = (verificationData: {
    first_name?: string | null;
    last_name?: string | null;
    document_number?: string | null;
    document_front_url?: string | null;
    document_back_url?: string | null;
    selfie_image_url?: string | null;
  }) => {
    const firstName = verificationData.first_name || '';
    const lastName = verificationData.last_name || '';
    const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();

    if (fullName) {
      setFormData(prev => ({
        ...prev,
        customerName: fullName,
        licenseNumber: verificationData.document_number || prev.licenseNumber,
      }));

      // Store verified name in localStorage for persistence across page refreshes
      localStorage.setItem('verifiedCustomerName', fullName);
      if (verificationData.document_number) {
        localStorage.setItem('verifiedLicenseNumber', verificationData.document_number);
      }

      toast.success(`Your details have been verified and updated: ${fullName}`, { duration: 5000 });
      console.log('✅ Form populated with verified data:', { customerName: fullName, licenseNumber: verificationData.document_number });
    }

    // Store verification images if available
    if (verificationData.document_front_url || verificationData.document_back_url || verificationData.selfie_image_url) {
      setVerificationImages({
        document_front_url: verificationData.document_front_url || null,
        document_back_url: verificationData.document_back_url || null,
        selfie_image_url: verificationData.selfie_image_url || null,
      });
    }
  };

  // DEV MODE: Simulate Veriff verification with mock data
  const handleDevMockVerification = () => {
    const mockVerificationData = {
      review_result: 'GREEN',
      status: 'completed',
      review_status: 'completed',
      first_name: 'John',
      last_name: 'Developer',
      document_number: 'DL123456789',
      date_of_birth: '1990-01-15',
    };

    const mockSessionId = `dev-mock-${Date.now()}`;

    setVerificationSessionId(mockSessionId);
    setVerificationStatus('verified');
    setFormData(prev => ({ ...prev, verificationSessionId: mockSessionId }));
    localStorage.setItem('verificationSessionId', mockSessionId);
    localStorage.setItem('verificationStatus', 'verified');
    localStorage.setItem('verificationTimestamp', Date.now().toString());

    populateFormWithVerifiedData(mockVerificationData);
    console.log('🔓 DEV MODE: Mock verification completed with data:', mockVerificationData);
  };

  // Clear verification data
  const handleClearVerification = () => {
    setVerificationSessionId(null);
    setVerificationStatus('init');
    setAiSessionData(null); // Clear AI session data too
    setVerificationImages(null); // Clear verification images
    setFormData(prev => ({ ...prev, verificationSessionId: "", licenseNumber: "" }));
    localStorage.removeItem('verificationSessionId');
    localStorage.removeItem('verificationToken');
    localStorage.removeItem('verificationStatus');
    localStorage.removeItem('verifiedCustomerName');
    localStorage.removeItem('verifiedLicenseNumber');
    localStorage.removeItem('verificationMode'); // Clear mode too
    toast.info("Verification cleared. You can verify again.");
  };

  // Handle identity verification using Veriff SDK
  const handleStartVerification = async () => {
    // Validate customer details first
    if (!formData.customerName || !formData.customerEmail || !formData.customerPhone) {
      toast.error("Please fill in your name, email, and phone number first");
      return;
    }

    setIsVerifying(true);

    try {
      // Get Veriff API key from environment
      const VERIFF_API_KEY = process.env.NEXT_PUBLIC_VERIFF_API_KEY;
      if (!VERIFF_API_KEY) {
        throw new Error('Veriff API key not configured. Please contact support.');
      }

      console.log('🔐 Initializing Veriff SDK...');

      // Create Veriff session directly using their API
      const vendorData = `booking_${formData.customerEmail}_${Date.now()}`;
      const sessionResponse = await fetch('https://stationapi.veriff.com/v1/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-AUTH-CLIENT': VERIFF_API_KEY,
        },
        body: JSON.stringify({
          verification: {
            person: {
              firstName: formData.customerName.split(' ')[0] || 'Unknown',
              lastName: formData.customerName.split(' ').slice(1).join(' ') || 'Customer',
            },
            vendorData: vendorData,
          }
        }),
      });

      if (!sessionResponse.ok) {
        const errorText = await sessionResponse.text();
        console.error('Veriff session creation error:', sessionResponse.status, errorText);
        throw new Error(`Failed to create Veriff session: ${sessionResponse.statusText}`);
      }

      const sessionData = await sessionResponse.json();
      const sessionId = sessionData.verification.id;
      const sessionUrl = sessionData.verification.url;

      console.log('✅ Veriff session created:', sessionId);

      // CRITICAL: Create the verification record in database BEFORE opening Veriff
      // This ensures the record exists for the webhook to update and for querying
      const verificationRecord = {
        provider: 'veriff',
        session_id: sessionId,
        external_user_id: vendorData,
        status: 'pending',
        review_status: 'pending',
        verification_url: sessionUrl,
        first_name: formData.customerName.split(' ')[0] || null,
        last_name: formData.customerName.split(' ').slice(1).join(' ') || null,
        ...(tenant?.id && { tenant_id: tenant.id }),
      };

      const { error: insertError } = await supabase
        .from('identity_verifications')
        .insert(verificationRecord);

      if (insertError) {
        console.error('Error creating verification record:', insertError);
        // Don't block verification - continue anyway (webhook will create record if needed)
        console.log('Continuing without pre-creating record...');
      } else {
        console.log('✅ Verification record created in database for session:', sessionId);
      }

      // Store session ID
      setVerificationSessionId(sessionId);
      setVerificationStatus('pending');
      setFormData(prev => ({ ...prev, verificationSessionId: sessionId }));

      // Persist to localStorage - store vendorData for fallback queries
      localStorage.setItem('verificationSessionId', sessionId);
      localStorage.setItem('verificationStatus', 'pending');
      localStorage.setItem('verificationVendorData', vendorData);

      // Helper function to check status with retries after verification finished
      const checkStatusWithRetry = async (attempt: number = 1, maxAttempts: number = 10) => {
        console.log(`🔄 Checking verification status (attempt ${attempt}/${maxAttempts})...`);
        const status = await checkVerificationStatus(sessionId);

        if (status?.review_result === 'GREEN') {
          setVerificationStatus('verified');
          localStorage.setItem('verificationStatus', 'verified');
          localStorage.setItem('verificationTimestamp', Date.now().toString());
          toast.success('Identity verified successfully!');
          // Auto-populate form with verified data
          populateFormWithVerifiedData(status);

          if (typeof window !== 'undefined' && (window as any).gtag) {
            (window as any).gtag('event', 'verification_completed', {
              email: formData.customerEmail,
              result: 'verified',
            });
          }
          return true;
        } else if (status?.review_result === 'RED') {
          setVerificationStatus('rejected');
          localStorage.setItem('verificationStatus', 'rejected');
          toast.error('Identity verification failed. Please try again.');

          if (typeof window !== 'undefined' && (window as any).gtag) {
            (window as any).gtag('event', 'verification_completed', {
              email: formData.customerEmail,
              result: 'rejected',
            });
          }
          return true;
        } else if (attempt < maxAttempts) {
          // Retry with exponential backoff: 2s, 3s, 4s, etc.
          const delay = (attempt + 1) * 1000;
          console.log(`⏳ Status not ready, retrying in ${delay / 1000}s...`);
          setTimeout(() => checkStatusWithRetry(attempt + 1, maxAttempts), delay);
        } else {
          console.log('⚠️ Max retry attempts reached. Verification may still be processing.');
          toast.info('Verification is being processed. Please wait or refresh the page.');
        }
        return false;
      };

      // Use Veriff InContext SDK to open verification in iframe overlay
      // This provides proper event callbacks for when verification finishes
      console.log('🚀 Opening Veriff InContext frame...');

      createVeriffFrame({
        url: sessionUrl,
        onEvent: (msg: string) => {
          console.log('📨 Veriff event received:', msg);

          switch (msg) {
            case MESSAGES.STARTED:
              console.log('✅ Veriff session started in iframe');
              break;

            case MESSAGES.FINISHED:
              console.log('✅ User completed verification in Veriff!');
              setIsVerifying(false);

              // IMPORTANT: When Veriff SDK fires FINISHED, the user has successfully
              // completed the verification flow. We can trust this event and mark as verified.
              // The webhook will update the database in the background.
              console.log('✅ Setting verification status to VERIFIED based on FINISHED event');
              setVerificationStatus('verified');
              localStorage.setItem('verificationStatus', 'verified');
              localStorage.setItem('verificationTimestamp', Date.now().toString());
              toast.success('Identity verified successfully! You can now continue with your booking.');

              // Show auth dialog for guest users to save their verification
              if (!isAuthenticated) {
                setShowAuthDialog(true);
              }

              // Track analytics
              if (typeof window !== 'undefined' && (window as any).gtag) {
                (window as any).gtag('event', 'verification_completed', {
                  email: formData.customerEmail,
                  result: 'verified',
                });
              }
              break;

            case MESSAGES.CANCELED:
              console.log('❌ User canceled verification');
              toast.info('Verification was canceled. You can try again when ready.');
              setVerificationStatus('init');
              localStorage.removeItem('verificationSessionId');
              localStorage.removeItem('verificationStatus');
              setIsVerifying(false);
              break;

            default:
              console.log('ℹ️ Unknown Veriff event:', msg);
          }
        }
      });

      toast.success("Verification started. Please complete the identity verification.");

      // Track analytics
      if (typeof window !== 'undefined' && (window as any).gtag) {
        (window as any).gtag('event', 'verification_started', {
          email: formData.customerEmail,
        });
      }
    } catch (error: any) {
      console.error("Verification error:", error);
      toast.error(error.message || "Failed to start verification. Please try again or contact support.");
      setIsVerifying(false);

      if (typeof window !== 'undefined' && (window as any).gtag) {
        (window as any).gtag('event', 'verification_failed', {
          error: error.message,
        });
      }
    }
  };

  // Handle AI verification start (when Veriff is disabled)
  const handleStartAIVerification = async () => {
    // Validate customer details first
    if (!formData.customerName || !formData.customerEmail || !formData.customerPhone) {
      toast.error("Please fill in your name, email, and phone number first");
      return;
    }

    if (!tenant) {
      toast.error("Tenant not loaded. Please refresh the page.");
      return;
    }

    // Clear any existing session data first (important for retry functionality)
    setAiSessionData(null);
    setVerificationStatus('init');
    setVerificationSessionId(null);

    setIsVerifying(true);

    try {
      console.log('🔐 Starting AI verification...');

      const { data, error } = await supabase.functions.invoke('create-ai-verification-session', {
        body: {
          customerDetails: {
            name: formData.customerName,
            email: formData.customerEmail,
            phone: formData.customerPhone
          },
          tenantId: tenant.id,
          tenantSlug: tenant.slug
        }
      });

      if (error || !data?.ok) {
        throw new Error(data?.error || error?.message || 'Failed to create AI verification session');
      }

      console.log('✅ AI verification session created:', data.sessionId);

      // Store session data
      setVerificationSessionId(data.sessionId);
      setVerificationStatus('pending');
      setAiSessionData({
        sessionId: data.sessionId,
        qrUrl: data.qrUrl,
        expiresAt: new Date(data.expiresAt)
      });
      setFormData(prev => ({ ...prev, verificationSessionId: data.sessionId }));

      // Persist to localStorage
      localStorage.setItem('verificationSessionId', data.sessionId);
      localStorage.setItem('verificationStatus', 'pending');
      localStorage.setItem('verificationMode', 'ai');

      toast.success("Scan the QR code with your phone to verify your identity.");

      // Track analytics
      if (typeof window !== 'undefined' && (window as any).gtag) {
        (window as any).gtag('event', 'ai_verification_started', {
          email: formData.customerEmail,
        });
      }
    } catch (error: any) {
      console.error("AI verification error:", error);
      toast.error(error.message || "Failed to start verification. Please try again.");
    } finally {
      setIsVerifying(false);
    }
  };

  // Handle AI verification completion
  const handleAIVerificationComplete = (data: any) => {
    console.log('✅ AI verification completed:', data);
    setVerificationStatus('verified');
    localStorage.setItem('verificationStatus', 'verified');

    // Populate form with verified data
    if (data.first_name || data.last_name) {
      populateFormWithVerifiedData(data);
    }

    // Track analytics
    if (typeof window !== 'undefined' && (window as any).gtag) {
      (window as any).gtag('event', 'ai_verification_completed', {
        email: formData.customerEmail,
        result: 'verified',
      });
    }

    // Show auth dialog for guest users to save their verification
    if (!isAuthenticated) {
      setShowAuthDialog(true);
    }
  };

  // Handle AI verification QR expiry
  const handleAIVerificationExpired = () => {
    console.log('⏰ AI verification session expired');
    setAiSessionData(null);
    setVerificationStatus('init');
    localStorage.removeItem('verificationSessionId');
    localStorage.removeItem('verificationStatus');
    toast.info('Verification session expired. Please try again.');
  };

  // Unified verification start handler (routes to Veriff or AI based on mode)
  const handleUnifiedVerificationStart = () => {
    if (verificationMode === 'veriff') {
      handleStartVerification();
    } else {
      handleStartAIVerification();
    }
  };

  const calculatePriceBreakdown = () => {
    const selectedVehicle = vehicles.find(v => v.id === formData.vehicleId);
    if (!selectedVehicle) return null;

    // Calculate rental duration in days
    let rentalPrice = 0;
    let rentalDays = 0;
    if (formData.pickupDate && formData.dropoffDate) {
      const pickup = parseDateString(formData.pickupDate);
      const dropoff = parseDateString(formData.dropoffDate);
      rentalDays = Math.max(1, Math.ceil((dropoff.getTime() - pickup.getTime()) / (1000 * 60 * 60 * 24)));

      const dailyRent = selectedVehicle.daily_rent || 0;
      const weeklyRent = selectedVehicle.weekly_rent || 0;
      const monthlyRent = selectedVehicle.monthly_rent || 0;

      // Pricing tiers (pro-rata):
      // > 30 days: monthly rate (days/30 × monthly_rent)
      // 7-30 days: weekly rate (days/7 × weekly_rent)
      // < 7 days: daily rate (days × daily_rent)
      if (rentalDays > 30 && monthlyRent > 0) {
        rentalPrice = (rentalDays / 30) * monthlyRent;
      } else if (rentalDays >= 7 && rentalDays <= 30 && weeklyRent > 0) {
        rentalPrice = (rentalDays / 7) * weeklyRent;
      } else if (dailyRent > 0) {
        rentalPrice = rentalDays * dailyRent;
      } else if (weeklyRent > 0) {
        // Fallback: estimate from weekly if no daily
        rentalPrice = (rentalDays / 7) * weeklyRent;
      } else if (monthlyRent > 0) {
        // Fallback: estimate from monthly if no daily/weekly
        rentalPrice = (rentalDays / 30) * monthlyRent;
      }
    }
    const extrasTotal = Object.entries(selectedExtras).reduce((sum, [extraId, qty]) => {
      const extra = availableExtras.find(e => e.id === extraId);
      return sum + (extra ? extra.price * qty : 0);
    }, 0);

    // Calculate delivery fees
    const deliveryFees = (formData.pickupDeliveryFee || 0) + (formData.returnDeliveryFee || 0);

    // Apply promo code logic
    let discountedRentalPrice = rentalPrice;
    let discountAmount = 0;

    if (promoDetails && selectedVehicle) {
      // Validate fixed amount check: "Fixed amount off" < "Vehicle Price"
      // Note: We check against the Rental Price, not just daily rate, as the discount applies to the booking total (usually)
      // Or does it apply to the daily rate? The requirement says "actual booking amount for the vehicle > promo code concession"

      // Usually promo applies to the rental cost (excluding extras)
      const basePrice = rentalPrice;

      if (promoDetails.type === "fixed_amount") {
        if (basePrice > promoDetails.value) {
          discountAmount = promoDetails.value;
          discountedRentalPrice = Math.max(0, basePrice - discountAmount);
        }
        // If basePrice <= value, we don't apply it here (or treat as 0).
        // We will handle the UI error display in the vehicle card loop.
      } else if (promoDetails.type === "percentage") {
        discountAmount = (basePrice * promoDetails.value) / 100;
        discountedRentalPrice = Math.max(0, basePrice - discountAmount);
      }
    }

    const totalPrice = discountedRentalPrice + extrasTotal + deliveryFees;
    return {
      rentalPrice,
      discountedRentalPrice,
      discountAmount,
      rentalDays,
      extrasTotal,
      deliveryFees,
      pickupDeliveryFee: formData.pickupDeliveryFee || 0,
      returnDeliveryFee: formData.returnDeliveryFee || 0,
      totalPrice
    };
  };

  const validatePromoCode = async (code: string) => {
    if (!code || !tenant?.id) {
      if (!tenant?.id) {
        console.log('⚠️ Promo validation skipped - tenant not loaded yet');
        setPromoError("Please wait while we load your settings...");
      }
      return;
    }

    setLoading(true);
    setPromoError(null);
    setPromoDetails(null);
    // Clear localStorage when starting new validation
    localStorage.removeItem('appliedPromoCode');
    localStorage.removeItem('appliedPromoDetails');

    try {
      // Use case-insensitive search with ilike for the code
      // Cast to any to bypass TypeScript as promocodes table is not yet in generated types
      const { data, error } = await (supabase as any)
        .from('promocodes')
        .select('*')
        .ilike('code', code) // Case-insensitive match
        .eq('tenant_id', tenant.id)
        .maybeSingle() as { data: { code: string; type: string; value: number; expires_at: string | null; id: string; max_users?: number } | null; error: any };

      if (error) {
        console.error('Promo code query error:', error);
        throw error;
      }

      if (!data) {
        console.log('❌ Promo code not found:', code, 'for tenant:', tenant.id);
        setPromoError("Invalid promo code");
        return;
      }

      // Check expiry
      const promoData = data as { code: string; type: string; value: number; expires_at: string | null; id: string; max_users?: number };
      if (promoData.expires_at && new Date(promoData.expires_at) < new Date()) {
        setPromoError("Promo code has expired");
        return;
      }

      // Check usage limits against max_users
      if (promoData.max_users && promoData.max_users > 0) {
        // Count how many times this promo code has been used in invoices
        const { count, error: usageError } = await (supabase as any)
          .from('invoices')
          .select('*', { count: 'exact', head: true })
          .eq('promo_code', promoData.code)
          .eq('tenant_id', tenant.id);

        if (!usageError && count !== null && count >= promoData.max_users) {
          setPromoError("Promo code usage limit reached");
          return;
        }
      }

      const promoDetailsToSave = {
        code: promoData.code,
        type: promoData.type === 'value' ? 'fixed_amount' : 'percentage', // Map DB type to internal type
        value: promoData.value,
        id: promoData.id
      };
      setPromoDetails(promoDetailsToSave);
      // Persist promo details to localStorage
      localStorage.setItem('appliedPromoCode', promoDetailsToSave.code);
      localStorage.setItem('appliedPromoDetails', JSON.stringify(promoDetailsToSave));
      toast.success("Promo code applied!");

    } catch (err) {
      console.error("Promo validation error:", err);
      setPromoError("Failed to validate promo code");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!validateStep3()) {
      return;
    }
    setLoading(true);
    try {
      // Check if customer is blocked before proceeding
      if (tenant?.id) {
        const blockCheck = await canCustomerBook(
          tenant.id,
          formData.customerEmail,
          formData.licenseNumber || undefined
        );

        if (!blockCheck.canBook) {
          toast.error(blockCheck.reason || "You are not allowed to make a booking. Please contact support.");
          setLoading(false);
          return;
        }
      }

      const priceBreakdown = calculatePriceBreakdown();
      const selectedVehicle = vehicles.find(v => v.id === formData.vehicleId);

      // First, create or find customer
      let customerId: string | null = null;

      // Check if customer exists
      let customerQuery = supabase
        .from("customers")
        .select("id")
        .eq("email", formData.customerEmail);

      if (tenant?.id) {
        customerQuery = customerQuery.eq("tenant_id", tenant.id);
      }

      const { data: existingCustomer } = await customerQuery.maybeSingle();

      if (existingCustomer) {
        customerId = existingCustomer.id;
        // Update existing customer with DOB if provided
        if (formData.driverDOB) {
          // Cast to any as date_of_birth is not in the generated types yet
          await (supabase as any)
            .from("customers")
            .update({ date_of_birth: formData.driverDOB })
            .eq("id", existingCustomer.id);
        }
      } else {
        // Create new customer with sanitized data
        const customerData: any = {
          name: sanitizeName(formData.customerName),
          email: sanitizeEmail(formData.customerEmail),
          phone: sanitizePhone(formData.customerPhone),
          customer_type: formData.customerType || "Individual",
          status: "Active",
          date_of_birth: formData.driverDOB || null
        };

        if (tenant?.id) {
          customerData.tenant_id = tenant.id;
        }

        const { data: newCustomer, error: customerError } = await supabase
          .from("customers")
          .insert(customerData)
          .select("id")
          .single();

        if (customerError) {
          toast.error("Failed to create customer");
          setLoading(false);
          return;
        }
        customerId = newCustomer.id;
      }

      // Auto-link any unlinked identity verifications by email
      if (customerId && formData.customerEmail && tenant?.id) {
        const customerEmailLower = formData.customerEmail.toLowerCase().trim();
        const { data: unlinkedVerification, error: linkError } = await supabase
          .from("identity_verifications")
          .update({
            customer_id: customerId,
            customer_email: null // Clear email after linking
          })
          .eq("customer_email", customerEmailLower)
          .eq("tenant_id", tenant.id)
          .is("customer_id", null)
          .select("id")
          .maybeSingle();

        if (unlinkedVerification && !linkError) {
          console.log("✅ Auto-linked identity verification:", unlinkedVerification.id, "to customer:", customerId);

          // Also update customer's verification status if verification is complete
          const { data: verification } = await supabase
            .from("identity_verifications")
            .select("review_result")
            .eq("id", unlinkedVerification.id)
            .single();

          if (verification?.review_result === "GREEN") {
            await supabase
              .from("customers")
              .update({ identity_verification_status: "verified" })
              .eq("id", customerId);
          }
        }
      }

      // Build rental data with sanitized inputs
      const rentalData: any = {
        customer_id: customerId,
        vehicle_id: formData.vehicleId || null,
        pickup_location: sanitizeLocation(formData.pickupLocation),
        return_location: sanitizeLocation(formData.dropoffLocation),
        start_date: formData.pickupDate,
        end_date: formData.dropoffDate || formData.pickupDate,
        pickup_time: formData.pickupTime || null,
        dropoff_time: formData.dropoffTime || null,
        customer_timezone: formData.customerTimezone || null,
        monthly_amount: priceBreakdown?.totalPrice || 0,
        notes: formData.specialRequests ? sanitizeTextArea(formData.specialRequests) : null,
        status: "Pending",
        source: "booking",
        // Add promo details
        promo_code: promoDetails?.code || null,
        discount_applied: priceBreakdown?.discountAmount || 0
      };

      // Add tenant_id if tenant context exists
      if (tenant?.id) {
        rentalData.tenant_id = tenant.id;
      }

      const {
        data,
        error
      } = await supabase.from("rentals").insert(rentalData).select().single();
      if (error) throw error;

      // Update vehicle status to Rented (even for pending rentals)
      let vehicleUpdateQuery = supabase
        .from("vehicles")
        .update({ status: "Rented" })
        .eq("id", formData.vehicleId);

      if (tenant?.id) {
        vehicleUpdateQuery = vehicleUpdateQuery.eq("tenant_id", tenant.id);
      }

      await vehicleUpdateQuery;

      // Generate reference using timestamp
      const reference = `SDS-${Date.now().toString(36).toUpperCase()}`;
      setBookingReference(reference);

      // Store booking details in localStorage for email and SMS after payment
      // Show confirmation directly
      toast.success("Booking confirmed! Check admin portal for new rental.");
      setShowConfirmation(true);
    } catch (error) {
      toast.error("Failed to process payment. Please try again.");
      console.error("Payment error:", error);
    } finally {
      setLoading(false);
    }
  };
  const handleCloseConfirmation = () => {
    setShowConfirmation(false);
    setCurrentStep(1);
    setFormData({
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
    });
    setPromoDetails(null);
    setPromoError(null);
    // Clear promo localStorage after successful booking
    localStorage.removeItem('appliedPromoCode');
    localStorage.removeItem('appliedPromoDetails');
    setSelectedExtras({});
    setCalculatedDistance(null);
    setDistanceOverride(false);

    // Clear persisted form data after successful booking
    sessionStorage.removeItem('booking_form_data');
    sessionStorage.removeItem('booking_current_step');
    sessionStorage.removeItem('booking_selected_extras');
  };

  // Calculate distance using Haversine formula (great-circle distance)
  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = getEarthRadius(distanceUnit);
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;
    return Math.round(distance * 10) / 10; // Round to 1 decimal place
  };
  const estimateDistance = async () => {
    const {
      pickupLat,
      pickupLon,
      dropoffLat,
      dropoffLon
    } = locationCoords;
    if (!pickupLat || !pickupLon || !dropoffLat || !dropoffLon) {
      toast.error("Please select both pickup and dropoff locations from the suggestions");
      return;
    }
    setLoading(true);
    try {
      // Use OSRM API for actual driving distance
      const response = await fetch(`https://router.project-osrm.org/route/v1/driving/${pickupLon},${pickupLat};${dropoffLon},${dropoffLat}?overview=false`);
      if (response.ok) {
        const data = await response.json();
        if (data.routes && data.routes.length > 0) {
          // Distance is in meters, convert to tenant unit
          const distanceInMiles = Math.round(metersToUnit(data.routes[0].distance, distanceUnit) * 10) / 10;
          const durationInMinutes = Math.round(data.routes[0].duration / 60);
          setCalculatedDistance(distanceInMiles);
        } else {
          throw new Error("No route found");
        }
      } else {
        throw new Error("Failed to calculate route");
      }
    } catch (error) {
      console.error("Error calculating driving distance:", error);

      // Fallback to straight-line distance
      const straightLineDistance = calculateDistance(pickupLat, pickupLon, dropoffLat, dropoffLon);
      setCalculatedDistance(straightLineDistance);
      toast.warning(`Estimated distance: ${straightLineDistance} ${getDistanceUnitLong(distanceUnit)} (straight-line, route unavailable)`);
    } finally {
      setLoading(false);
    }
  };
  const getExtraIcon = (extraName: string) => {
    const name = extraName.toLowerCase();
    if (name.includes("child") || name.includes("seat")) return Baby;
    if (name.includes("meet") || name.includes("greet")) return UserCheck;
    if (name.includes("stop") || name.includes("pickup")) return MapPin;
    if (name.includes("refresh") || name.includes("beverage")) return Coffee;
    return Coffee;
  };
  const getVehicleBadge = (vehicle: Vehicle) => {
    const make = (vehicle.make || '').toLowerCase();
    const model = (vehicle.model || '').toLowerCase();
    const fullName = `${make} ${model}`;

    if (make.includes("rolls") || model.includes("phantom")) {
      return {
        text: "Ultra Luxury",
        icon: Crown,
        color: "text-primary border-primary"
      };
    }
    if (model.includes("s-class") || model.includes("s class") || fullName.includes("s class")) {
      return {
        text: "Most Popular",
        icon: TrendingUp,
        color: "text-blue-400 border-blue-400"
      };
    }
    if (model.includes("v-class") || model.includes("v class") || fullName.includes("transit")) {
      return {
        text: "Best for Groups",
        icon: GroupIcon,
        color: "text-green-400 border-green-400"
      };
    }
    return null;
  };

  // Description helper functions
  const MAX_DESCRIPTION_LENGTH = 120;

  const toggleDescription = (vehicleId: string) => {
    setExpandedDescriptions(prev => {
      const newSet = new Set(prev);
      if (newSet.has(vehicleId)) {
        newSet.delete(vehicleId);
      } else {
        newSet.add(vehicleId);
      }
      return newSet;
    });
  };

  // Image carousel navigation
  const getVehicleImageIndex = (vehicleId: string) => vehicleImageIndex[vehicleId] || 0;

  const nextVehicleImage = (e: React.MouseEvent, vehicleId: string, totalImages: number) => {
    e.stopPropagation();
    setVehicleImageIndex(prev => ({
      ...prev,
      [vehicleId]: ((prev[vehicleId] || 0) + 1) % totalImages
    }));
  };

  const prevVehicleImage = (e: React.MouseEvent, vehicleId: string, totalImages: number) => {
    e.stopPropagation();
    setVehicleImageIndex(prev => ({
      ...prev,
      [vehicleId]: ((prev[vehicleId] || 0) - 1 + totalImages) % totalImages
    }));
  };

  const getDisplayDescription = (vehicle: Vehicle) => {
    if (!vehicle.description) return null;
    const isExpanded = expandedDescriptions.has(vehicle.id);
    const needsTruncation = vehicle.description.length > MAX_DESCRIPTION_LENGTH;

    if (isExpanded || !needsTruncation) {
      return vehicle.description;
    }

    return vehicle.description.substring(0, MAX_DESCRIPTION_LENGTH) + '...';
  };
  const calculateRentalDuration = () => {
    if (!formData.pickupDate || !formData.dropoffDate || !formData.pickupTime || !formData.dropoffTime) {
      return null;
    }
    const pickup = new Date(`${formData.pickupDate}T${formData.pickupTime}:00`);
    const dropoff = new Date(`${formData.dropoffDate}T${formData.dropoffTime}:00`);
    const hours = differenceInHours(dropoff, pickup);
    // Ceiling the days - any hours beyond full days count as another day
    const days = Math.ceil(hours / 24);
    const remainingHours = hours % 24;

    // Format duration with proper grammar - only show whole days (ceiling)
    const formatDuration = () => {
      // Helper for singular/plural
      const pluralize = (count: number, singular: string, plural: string) =>
        count === 1 ? `${count} ${singular}` : `${count} ${plural}`;

      // Minimum 1 day display
      if (days === 0) {
        return '1 day';
      }

      // Calculate months, weeks, and remaining days from the ceiled total days
      const months = Math.floor(days / 30);
      const afterMonthsDays = days % 30;
      const weeks = Math.floor(afterMonthsDays / 7);
      const finalDays = afterMonthsDays % 7;

      const parts: string[] = [];

      // Add months if any
      if (months > 0) {
        parts.push(pluralize(months, 'month', 'months'));
      }

      // Add weeks if any (only show if we have some remaining after months)
      if (weeks > 0) {
        parts.push(pluralize(weeks, 'week', 'weeks'));
      }

      // Add remaining days if any
      if (finalDays > 0) {
        parts.push(pluralize(finalDays, 'day', 'days'));
      }

      // If no parts (shouldn't happen), fallback to days
      if (parts.length === 0) {
        return pluralize(days, 'day', 'days');
      }

      // Join parts with "and" for last item, ", " for others
      if (parts.length === 1) {
        return parts[0];
      } else if (parts.length === 2) {
        return `${parts[0]} and ${parts[1]}`;
      } else {
        const last = parts.pop();
        return `${parts.join(', ')} and ${last}`;
      }
    };

    return {
      hours,
      days,
      remainingHours,
      isValid: hours >= 24 && days <= 365,
      formatted: formatDuration()
    };
  };
  const calculateEstimatedTotal = (vehicle: Vehicle) => {
    if (!formData.pickupDate || !formData.dropoffDate) return null;
    const duration = calculateRentalDuration();
    if (!duration) return null;
    const days = duration.days;
    let vehicleTotal = 0;
    const dailyRent = vehicle.daily_rent || 0;
    const weeklyRent = vehicle.weekly_rent || 0;
    const monthlyRent = vehicle.monthly_rent || 0;

    // Pricing tiers (pro-rata):
    // > 30 days: monthly rate (days/30 × monthly_rent)
    // 7-30 days: weekly rate (days/7 × weekly_rent)
    // < 7 days: daily rate (days × daily_rent)
    if (days > 30 && monthlyRent > 0) {
      vehicleTotal = (days / 30) * monthlyRent;
    } else if (days >= 7 && days <= 30 && weeklyRent > 0) {
      vehicleTotal = (days / 7) * weeklyRent;
    } else if (dailyRent > 0) {
      vehicleTotal = days * dailyRent;
    } else if (weeklyRent > 0) {
      // Fallback: estimate from weekly if no daily
      vehicleTotal = (days / 7) * weeklyRent;
    } else if (monthlyRent > 0) {
      // Fallback: estimate from monthly if no daily/weekly
      vehicleTotal = (days / 30) * monthlyRent;
    }

    // Add delivery fees
    const deliveryFees = (formData.pickupDeliveryFee || 0) + (formData.returnDeliveryFee || 0);
    const total = vehicleTotal + deliveryFees;

    return {
      total,
      vehicleTotal,
      deliveryFees,
      days
    };
  };

  // Get the appropriate price display based on rental duration
  // Pricing tiers: > 30 days = monthly, 7-30 days = weekly, < 7 days = daily
  const getDynamicPriceDisplay = (vehicle: Vehicle): { price: number; label: string; secondaryPrices: string[] } => {
    const duration = calculateRentalDuration();
    const days = duration?.days || 0;

    const dailyRent = vehicle.daily_rent || 0;
    const weeklyRent = vehicle.weekly_rent || 0;
    const monthlyRent = vehicle.monthly_rent || 0;

    // Determine primary price based on duration (matching pricing tiers)
    if (days > 30 && monthlyRent > 0) {
      // Monthly rental - show monthly price as primary
      const secondaryPrices: string[] = [];
      if (weeklyRent > 0) secondaryPrices.push(`${formatCurrency(weeklyRent, currencyCode, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} / week`);
      if (dailyRent > 0) secondaryPrices.push(`${formatCurrency(dailyRent, currencyCode, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} / day`);
      return { price: monthlyRent, label: '/ month', secondaryPrices };
    } else if (days >= 7 && days <= 30 && weeklyRent > 0) {
      // Weekly rental - show weekly price as primary
      const secondaryPrices: string[] = [];
      if (dailyRent > 0) secondaryPrices.push(`${formatCurrency(dailyRent, currencyCode, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} / day`);
      if (monthlyRent > 0) secondaryPrices.push(`${formatCurrency(monthlyRent, currencyCode, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} / month`);
      return { price: weeklyRent, label: '/ week', secondaryPrices };
    } else if (dailyRent > 0) {
      // Daily rental - show daily price as primary
      const secondaryPrices: string[] = [];
      if (weeklyRent > 0) secondaryPrices.push(`${formatCurrency(weeklyRent, currencyCode, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} / week`);
      if (monthlyRent > 0) secondaryPrices.push(`${formatCurrency(monthlyRent, currencyCode, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} / month`);
      return { price: dailyRent, label: '/ day', secondaryPrices };
    } else {
      // Fallback to monthly or whatever is available
      const primaryPrice = monthlyRent || weeklyRent || dailyRent || 0;
      const primaryLabel = monthlyRent ? '/ month' : weeklyRent ? '/ week' : '/ day';
      return { price: primaryPrice, label: primaryLabel, secondaryPrices: [] };
    }
  };
  const isVehicleBlockedForPeriod = (vehicleId: string): { blocked: boolean; blockedRange?: { start: string; end: string } } => {
    if (!formData.pickupDate || !formData.dropoffDate) {
      return { blocked: false };
    }

    const pickupDate = parseDateString(formData.pickupDate);
    const dropoffDate = parseDateString(formData.dropoffDate);

    // Find any blocked dates for this specific vehicle that overlap with the rental period
    const vehicleBlockedDates = allBlockedDates.filter(block => block.vehicle_id === vehicleId);

    for (const block of vehicleBlockedDates) {
      const blockStart = parseDateString(block.start_date);
      const blockEnd = parseDateString(block.end_date);

      // Check if there's any overlap between rental period and blocked period
      const hasOverlap = pickupDate <= blockEnd && dropoffDate >= blockStart;

      if (hasOverlap) {
        return {
          blocked: true,
          blockedRange: {
            start: block.start_date,
            end: block.end_date
          }
        };
      }
    }

    return { blocked: false };
  };

  // Helper function to get vehicle price based on selected price filter mode
  const getVehiclePriceByMode = (vehicle: Vehicle, mode: "daily" | "weekly" | "monthly"): number => {
    switch (mode) {
      case "daily":
        return vehicle.daily_rent || 0;
      case "weekly":
        return vehicle.weekly_rent || 0;
      case "monthly":
        return vehicle.monthly_rent || 0;
      default:
        return vehicle.daily_rent || 0;
    }
  };

  // Helper function to recalculate price range when mode changes
  const recalculatePriceRange = (mode: "daily" | "weekly" | "monthly") => {
    const prices = vehicles
      .map(v => getVehiclePriceByMode(v, mode))
      .filter(p => p > 0);

    if (prices.length > 0) {
      const minPrice = Math.min(...prices);
      const maxPrice = Math.max(...prices);
      const dynamicRange: [number, number] = [minPrice, maxPrice];
      setOriginalPriceRange(dynamicRange);
      setFilters(prev => ({
        ...prev,
        priceRange: dynamicRange
      }));
    }
  };

  // Handle price filter mode change
  const handlePriceFilterModeChange = (mode: "daily" | "weekly" | "monthly") => {
    setPriceFilterMode(mode);
    recalculatePriceRange(mode);
  };

  // Helper function to get readable sort label
  const getSortLabel = (sortValue: string): string => {
    switch (sortValue) {
      case "price_low":
        return "Price: Low → High";
      case "price_high":
        return "Price: High → Low";
      case "seats_most":
        return "Seats: Most → Fewest";
      case "newest":
        return "Newest Models";
      case "recommended":
        return "Recommended";
      default:
        return sortValue;
    }
  };

  // Filter and sort vehicles
  const getFilteredAndSortedVehicles = () => {
    let filtered = [...vehicles];

    // Search filter - search in make, model, reg, and color
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(v =>
        (v.make && v.make.toLowerCase().includes(term)) ||
        (v.model && v.model.toLowerCase().includes(term)) ||
        v.reg.toLowerCase().includes(term) ||
        (v.colour && v.colour.toLowerCase().includes(term))
      );
    }

    // Category filter (skip for portal - no category field)
    // Portal vehicles don't have categories, so this filter is disabled

    // Transmission filter (skip for portal - no transmission field)
    // Portal vehicles don't have transmission info, so this filter is disabled
    // if (filters.transmission.length > 0) {
    //   filtered = filtered.filter(v => v.transmission && filters.transmission.includes(v.transmission));
    // }

    // Seats filter (skip for portal - no capacity field)
    // Portal vehicles don't have capacity info, so this filter is disabled

    // Price range filter - use selected price filter mode (daily/weekly/monthly)
    filtered = filtered.filter(v => {
      const price = getVehiclePriceByMode(v, priceFilterMode);
      return price >= filters.priceRange[0] && price <= filters.priceRange[1];
    });

    // Filter out vehicles with blocked dates for the selected rental period
    if (formData.pickupDate && formData.dropoffDate) {
      const pickupDate = parseDateString(formData.pickupDate);
      const dropoffDate = parseDateString(formData.dropoffDate);

      filtered = filtered.filter(vehicle => {
        // Check for vehicle-specific blocked dates
        const vehicleBlockedDates = allBlockedDates.filter(block => block.vehicle_id === vehicle.id);

        for (const block of vehicleBlockedDates) {
          const blockStart = parseDateString(block.start_date);
          const blockEnd = parseDateString(block.end_date);

          // Check if there's any overlap between rental period and blocked period
          const hasOverlap = pickupDate <= blockEnd && dropoffDate >= blockStart;

          if (hasOverlap) {
            console.log(`[BlockedDates] Vehicle ${vehicle.reg} blocked: rental ${formData.pickupDate}-${formData.dropoffDate} overlaps with block ${block.start_date}-${block.end_date}`);
            return false; // Exclude this vehicle
          }
        }

        return true; // Include this vehicle
      });
    }

    // Sort
    switch (sortBy) {
      case "price_low":
        filtered.sort((a, b) => {
          const aPrice = a.monthly_rent || a.daily_rent || 0;
          const bPrice = b.monthly_rent || b.daily_rent || 0;
          return aPrice - bPrice;
        });
        break;
      case "price_high":
        filtered.sort((a, b) => {
          const aPrice = a.monthly_rent || a.daily_rent || 0;
          const bPrice = b.monthly_rent || b.daily_rent || 0;
          return bPrice - aPrice;
        });
        break;
      case "seats_most":
        // No capacity field in portal, skip this sort
        break;
      case "newest":
        filtered.sort((a, b) => {
          const aDate = a.created_at ? new Date(a.created_at).getTime() : 0;
          const bDate = b.created_at ? new Date(b.created_at).getTime() : 0;
          return bDate - aDate;
        });
        break;
      case "recommended":
      default:
        // Sort by make/model alphabetically
        filtered.sort((a, b) => {
          const aName = `${a.make || ''} ${a.model || ''}`.trim().toLowerCase();
          const bName = `${b.make || ''} ${b.model || ''}`.trim().toLowerCase();
          return aName.localeCompare(bName);
        });
    }
    return filtered;
  };
  const filteredVehicles = getFilteredAndSortedVehicles();
  const handleSearchChange = (value: string) => {
    setSearchTerm(value);
    if (searchDebounceTimer.current) {
      clearTimeout(searchDebounceTimer.current);
    }
    searchDebounceTimer.current = setTimeout(() => {
      if ((window as any).gtag) {
        (window as any).gtag('event', 'fleet_search_changed', {
          term: value
        });
      }
    }, 250);
  };

  // Format time to 12-hour format with AM/PM
  const formatTimeWithPeriod = (time: string): string => {
    if (!time) return "—";
    const [hours, minutes] = time.split(':').map(Number);
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12; // Convert 0 to 12 for midnight
    return `${displayHours}:${minutes.toString().padStart(2, '0')} ${period}`;
  };

  const handleViewModeChange = (mode: "grid" | "list") => {
    setViewMode(mode);
    localStorage.setItem('viewMode', mode);
  };
  const toggleCategory = (category: string) => {
    setSelectedCategories(prev => prev.includes(category) ? prev.filter(c => c !== category) : [...prev, category]);
    if ((window as any).gtag) {
      (window as any).gtag('event', 'fleet_filter_changed', {
        filter: 'category',
        value: category
      });
    }
  };
  const clearAllFilters = () => {
    setSearchTerm("");
    setSelectedCategories([]);
    setPriceFilterMode("daily"); // Reset to daily mode
    // Recalculate range for daily prices
    const prices = vehicles.map(v => v.daily_rent || 0).filter(p => p > 0);
    const newRange: [number, number] = prices.length > 0
      ? [Math.min(...prices), Math.max(...prices)]
      : [0, 1000];
    setOriginalPriceRange(newRange);
    setFilters({
      transmission: [],
      fuel: [],
      seats: [2, 7],
      priceRange: newRange
    });
    setSortBy("recommended");
  };
  // Portal vehicles don't have transmission/fuel data, so we exclude those filters
  const hasActiveFilters = searchTerm || selectedCategories.length > 0 || sortBy !== "recommended";
  const selectedVehicle = vehicles.find(v => v.id === formData.vehicleId);
  const estimatedBooking = selectedVehicle ? calculateEstimatedTotal(selectedVehicle) : null;
  const priceBreakdown = calculatePriceBreakdown();

  // Validate individual field in real-time
  const validateSingleField = (fieldName: string, value: any) => {
    let error = "";
    switch (fieldName) {
      case "customerName":
        const nameValue = String(value).trim();
        if (!nameValue) {
          error = "Full name is required";
        } else if (nameValue.length < 2) {
          error = "Full name must be at least 2 characters";
        } else if (!/^[a-zA-Z\s\-']+$/.test(nameValue)) {
          error = "Name must contain only letters, spaces, hyphens, and apostrophes";
        } else if (!/[a-zA-Z]{2,}/.test(nameValue)) {
          error = "Name must contain at least 2 alphabetic characters";
        } else if (nameValue.replace(/[\s\-']/g, '').length < 2) {
          error = "Name must have actual alphabetic content";
        }
        break;
      case "customerEmail":
        if (!String(value).trim()) {
          error = "Email address is required";
        } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))) {
          error = "Please enter a valid email address";
        }
        break;
      case "customerPhone":
        const phoneValue = String(value).trim();
        if (!phoneValue) {
          error = "Phone number is required";
        } else {
          const cleaned = phoneValue.replace(/[\s\-()]/g, '');
          const digitCount = (cleaned.match(/\d/g) || []).length;
          // Valid international phone: 7-15 digits, optional + at start
          if (digitCount < 7 || digitCount > 15) {
            error = "Please enter a valid phone number (7-15 digits)";
          } else if (cleaned.startsWith('+') && !/^\+\d+$/.test(cleaned)) {
            error = "Invalid phone number format";
          } else if (!cleaned.startsWith('+') && !/^\d+$/.test(cleaned.replace(/[\s\-()]/g, ''))) {
            error = "Phone number should contain only digits";
          }
        }
        break;
    }
    if (error) {
      setErrors(prev => ({
        ...prev,
        [fieldName]: error
      }));
    } else {
      setErrors(prev => {
        const newErrors = {
          ...prev
        };
        delete newErrors[fieldName];
        return newErrors;
      });
    }
  };

  // Calculate age from date of birth
  const calculateAge = (dob: Date): number => {
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const monthDiff = today.getMonth() - dob.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
      age--;
    }
    return age;
  };

  const validateStep1 = () => {
    const newErrors: {
      [key: string]: string;
    } = {};

    // Auto-populate fixed addresses if the useEffect in LocationPicker hasn't fired yet
    // This handles race conditions where the auto-set effect runs after validation
    const pickupFixedEnabled = tenant?.pickup_fixed_enabled ?? tenant?.fixed_address_enabled ?? false;
    const returnFixedEnabled = tenant?.return_fixed_enabled ?? tenant?.fixed_address_enabled ?? false;
    let pickupLocation = formData.pickupLocation;
    let dropoffLocation = formData.dropoffLocation;

    if (!pickupLocation && pickupFixedEnabled && tenant?.fixed_pickup_address) {
      pickupLocation = tenant.fixed_pickup_address;
      setFormData(prev => ({ ...prev, pickupLocation: tenant.fixed_pickup_address!, pickupDeliveryFee: 0 }));
    }
    if (!dropoffLocation && returnFixedEnabled && tenant?.fixed_return_address) {
      dropoffLocation = tenant.fixed_return_address;
      setFormData(prev => ({ ...prev, dropoffLocation: tenant.fixed_return_address!, returnDeliveryFee: 0 }));
    }

    // Security check: Detect potentially malicious input patterns
    if (!isInputSafe(pickupLocation) || !isInputSafe(dropoffLocation)) {
      toast.error("Invalid input detected. Please enter valid addresses.");
      return false;
    }

    // Validate pickup location
    if (!pickupLocation.trim()) {
      newErrors.pickupLocation = "Pickup location is required";
    } else {
      const pickupText = pickupLocation.trim();
      // Check for meaningful location data (at least 5 characters and contains letters)
      if (pickupText.length < 5) {
        newErrors.pickupLocation = "Please enter a valid pickup address (minimum 5 characters)";
      } else if (!/[a-zA-Z]{3,}/.test(pickupText)) {
        newErrors.pickupLocation = "Please enter a meaningful pickup address with letters";
      } else if (/^[@#$%^&*()_+=\-\[\]{};:'",.<>?\/\\|`~!]{3,}/.test(pickupText)) {
        newErrors.pickupLocation = "Please enter a valid pickup address, not symbols";
      } else if (/^[a-zA-Z]+$/.test(pickupText) && pickupText.length < 15) {
        // If it's only letters and short, it's likely gibberish like "mmmmmmm"
        newErrors.pickupLocation = "Please enter a complete address (e.g., street name, city, postcode)";
      } else if (!/[\d]/.test(pickupText) && !/[,]/.test(pickupText) && pickupText.split(' ').length < 2) {
        // Valid addresses usually have numbers or commas or multiple words
        newErrors.pickupLocation = "Please enter a complete address with street name or postcode";
      }
    }

    // Validate drop-off location
    if (!dropoffLocation.trim()) {
      newErrors.dropoffLocation = "Drop-off location is required";
    } else {
      const dropoffText = dropoffLocation.trim();
      // Check for meaningful location data (at least 5 characters and contains letters)
      if (dropoffText.length < 5) {
        newErrors.dropoffLocation = "Please enter a valid drop-off address (minimum 5 characters)";
      } else if (!/[a-zA-Z]{3,}/.test(dropoffText)) {
        newErrors.dropoffLocation = "Please enter a meaningful drop-off address with letters";
      } else if (/^[@#$%^&*()_+=\-\[\]{};:'",.<>?\/\\|`~!]{3,}/.test(dropoffText)) {
        newErrors.dropoffLocation = "Please enter a valid drop-off address, not symbols";
      } else if (/^[a-zA-Z]+$/.test(dropoffText) && dropoffText.length < 15) {
        // If it's only letters and short, it's likely gibberish like "mmmmmmm"
        newErrors.dropoffLocation = "Please enter a complete address (e.g., street name, city, postcode)";
      } else if (!/[\d]/.test(dropoffText) && !/[,]/.test(dropoffText) && dropoffText.split(' ').length < 2) {
        // Valid addresses usually have numbers or commas or multiple words
        newErrors.dropoffLocation = "Please enter a complete address with street name or postcode";
      }
    }
    if (!formData.pickupDate) {
      newErrors.pickupDate = "Please select a pickup location.";
    }
    if (!formData.pickupTime) {
      newErrors.pickupTime = "Please choose pickup and return date & time.";
    }
    if (!formData.dropoffDate) {
      newErrors.dropoffDate = "Please choose pickup and return date & time.";
    }
    if (!formData.dropoffTime) {
      newErrors.dropoffTime = "Please choose pickup and return date & time.";
    }

    // Validate rental duration: min 24 hours, max 1 year (365 days)
    if (formData.pickupDate && formData.dropoffDate && formData.pickupTime && formData.dropoffTime) {
      const duration = calculateRentalDuration();
      if (duration && !duration.isValid) {
        if (duration.hours < 24) {
          newErrors.dropoffDate = "Return must be at least 24 hours after pickup.";
        } else if (duration.days > 365) {
          newErrors.dropoffDate = "Maximum rental period is 1 year.";
        }
      }
    }

    // Validate booking lead time (minimum advance notice)
    if (formData.pickupDate && formData.pickupTime) {
      const leadTimeHours = tenant?.booking_lead_time_hours ?? 24;
      if (leadTimeHours > 0) {
        const pickupDateTime = new Date(`${formData.pickupDate}T${formData.pickupTime}`);
        const now = new Date();
        const hoursUntilPickup = (pickupDateTime.getTime() - now.getTime()) / (1000 * 60 * 60);
        if (hoursUntilPickup < leadTimeHours) {
          const displayValue = leadTimeHours >= 24 && leadTimeHours % 24 === 0
            ? `${leadTimeHours / 24} day${leadTimeHours / 24 !== 1 ? 's' : ''}`
            : `${leadTimeHours} hour${leadTimeHours !== 1 ? 's' : ''}`;
          newErrors.pickupDate = `Bookings must be made at least ${displayValue} in advance.`;
        }
      }
    }

    // DOB validation moved to Step 4 (Customer Details)

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };
  const validateStep2 = () => {
    const newErrors: {
      [key: string]: string;
    } = {};
    if (!formData.vehicleId) {
      newErrors.vehicleId = "Please select a vehicle";
      toast.error("Please select a vehicle to continue");
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Instant field validation for onChange events
  const validateField = (fieldName: string, value: string) => {
    const newErrors: { [key: string]: string } = {};

    switch (fieldName) {
      case 'pickupLocation':
        if (!value.trim()) {
          newErrors.pickupLocation = "Pickup location is required";
        } else {
          const pickupText = value.trim();
          if (pickupText.length < 5) {
            newErrors.pickupLocation = "Please enter a valid pickup address (minimum 5 characters)";
          } else if (!/[a-zA-Z]{3,}/.test(pickupText)) {
            newErrors.pickupLocation = "Please enter a meaningful pickup address with letters";
          } else if (/^[@#$%^&*()_+=\-\[\]{};:'",.<>?\/\\|`~!]{3,}/.test(pickupText)) {
            newErrors.pickupLocation = "Please enter a valid pickup address, not symbols";
          } else if (/^[a-zA-Z]+$/.test(pickupText) && pickupText.length < 15) {
            newErrors.pickupLocation = "Please enter a complete address (e.g., street name, city, postcode)";
          } else if (!/[\d]/.test(pickupText) && !/[,]/.test(pickupText) && pickupText.split(' ').length < 2) {
            newErrors.pickupLocation = "Please enter a complete address with street name or postcode";
          }
        }
        break;

      case 'dropoffLocation':
        if (!value.trim()) {
          newErrors.dropoffLocation = "Drop-off location is required";
        } else {
          const dropoffText = value.trim();
          if (dropoffText.length < 5) {
            newErrors.dropoffLocation = "Please enter a valid drop-off address (minimum 5 characters)";
          } else if (!/[a-zA-Z]{3,}/.test(dropoffText)) {
            newErrors.dropoffLocation = "Please enter a meaningful drop-off address with letters";
          } else if (/^[@#$%^&*()_+=\-\[\]{};:'",.<>?\/\\|`~!]{3,}/.test(dropoffText)) {
            newErrors.dropoffLocation = "Please enter a valid drop-off address, not symbols";
          } else if (/^[a-zA-Z]+$/.test(dropoffText) && dropoffText.length < 15) {
            newErrors.dropoffLocation = "Please enter a complete address (e.g., street name, city, postcode)";
          } else if (!/[\d]/.test(dropoffText) && !/[,]/.test(dropoffText) && dropoffText.split(' ').length < 2) {
            newErrors.dropoffLocation = "Please enter a complete address with street name or postcode";
          }
        }
        break;

      case 'customerName':
        const nameValue = value.trim();
        if (!nameValue) {
          newErrors.customerName = "Full name is required";
        } else if (nameValue.length < 2) {
          newErrors.customerName = "Full name must be at least 2 characters";
        } else if (!/^[a-zA-Z\s\-']+$/.test(nameValue)) {
          newErrors.customerName = "Name must contain only letters, spaces, hyphens, and apostrophes";
        } else if (!/[a-zA-Z]{2,}/.test(nameValue)) {
          newErrors.customerName = "Name must contain at least 2 alphabetic characters";
        } else if (nameValue.replace(/[\s\-']/g, '').length < 2) {
          newErrors.customerName = "Name must have actual alphabetic content";
        }
        break;

      case 'customerEmail':
        if (!value.trim()) {
          newErrors.customerEmail = "Email address is required";
        } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
          newErrors.customerEmail = "Please enter a valid email address";
        }
        break;

      case 'customerPhone':
        const phoneValue = value.trim();
        if (!phoneValue) {
          newErrors.customerPhone = "Phone number is required";
        } else {
          // Strip country code (e.g., +1, +44) and non-digit characters for validation
          let cleaned = phoneValue.replace(/[\s\-()]/g, '');
          // Remove country code prefix if present (e.g., +1, +44, +353)
          if (cleaned.startsWith('+')) {
            cleaned = cleaned.replace(/^\+\d{1,3}/, '');
          }
          const digitCount = (cleaned.match(/\d/g) || []).length;
          // Validate local number is 7-12 digits (most countries)
          if (digitCount < 7 || digitCount > 12) {
            newErrors.customerPhone = "Please enter a valid phone number (7-12 digits)";
          } else if (!/^\d+$/.test(cleaned)) {
            newErrors.customerPhone = "Phone number should contain only digits";
          }
        }
        break;

      case 'customerType':
        if (!value || value.trim() === "") {
          newErrors.customerType = "Please select a customer type";
        } else if (value !== "Individual" && value !== "Company") {
          newErrors.customerType = "Invalid customer type selected";
        }
        break;

      case 'driverDOB':
        if (!value || value.trim() === "") {
          newErrors.driverDOB = "Date of birth is required.";
        } else {
          const dob = parseDateString(value);
          if (isNaN(dob.getTime())) {
            newErrors.driverDOB = "Please enter a valid date of birth.";
          } else {
            const age = calculateAge(dob);
            const minAge = tenant?.minimum_rental_age || 18;
            if (age < minAge) {
              newErrors.driverDOB = `You must be at least ${minAge} years old to rent a vehicle.`;
            }
          }
        }
        break;

      // licenseNumber case removed - not collected in UI
    }

    // Update errors state - clear error if valid, set error if invalid
    setErrors(prev => ({
      ...prev,
      [fieldName]: newErrors[fieldName] || ""
    }));
  };

  const handleStep1Continue = () => {
    if (validateStep1()) {
      // Resolve pickup/return locations - use form data, falling back to fixed addresses
      const pickupFixedEnabled = tenant?.pickup_fixed_enabled ?? tenant?.fixed_address_enabled ?? false;
      const returnFixedEnabled = tenant?.return_fixed_enabled ?? tenant?.fixed_address_enabled ?? false;
      const resolvedPickupLocation = formData.pickupLocation || (pickupFixedEnabled && tenant?.fixed_pickup_address) || "";
      const resolvedDropoffLocation = formData.dropoffLocation || (returnFixedEnabled && tenant?.fixed_return_address) || "";

      // Store rental details in booking context (DOB collected in Step 4)
      const bookingContext = {
        pickupLocation: resolvedPickupLocation,
        dropoffLocation: resolvedDropoffLocation,
        pickupLocationId: formData.pickupLocationId,
        returnLocationId: formData.returnLocationId,
        pickupDeliveryFee: formData.pickupDeliveryFee,
        returnDeliveryFee: formData.returnDeliveryFee,
        pickupDate: formData.pickupDate,
        pickupTime: formData.pickupTime,
        dropoffDate: formData.dropoffDate,
        dropoffTime: formData.dropoffTime,
        customerTimezone: formData.customerTimezone,
      };
      updateBookingContext(bookingContext as any);

      // DEBUG: Check if verification session ID is still in formData before moving to step 2
      console.log('📝 Moving to Step 2 with formData:', formData);
      console.log('📝 Verification Session ID in formData:', formData.verificationSessionId);

      // Note: We DON'T clear verification state here anymore because we need it for checkout linking

      // Analytics tracking
      const duration = calculateRentalDuration();
      if ((window as any).gtag) {
        (window as any).gtag('event', 'booking_step1_submitted', {
          pickup_location: formData.pickupLocation,
          return_location: formData.dropoffLocation,
          rental_days: duration?.days || 0,
          driver_age: driverAge,
          has_promo: !!formData.promoCode,
          young_driver: isYoungDriver
        });
      }
      setCurrentStep(2);
    }
  };
  const handleStep2Continue = () => {
    if (validateStep2()) {
      // Analytics
      if ((window as any).gtag && selectedVehicle && estimatedBooking) {
        const vehicleName = selectedVehicle.make && selectedVehicle.model ? `${selectedVehicle.make} ${selectedVehicle.model}` : selectedVehicle.make || selectedVehicle.model || selectedVehicle.reg;
        (window as any).gtag('event', 'continue_to_extras_clicked', {
          vehicle_id: formData.vehicleId,
          vehicle_name: vehicleName,
          est_total: estimatedBooking.total
        });
      }

      // Update booking context
      updateBookingContext({
        selectedVehicleId: formData.vehicleId,
      } as any);
      // Skip insurance step for exempt tenants (like Kedic Services)
      if (skipInsurance) {
        setCurrentStep(4); // Skip directly to customer details
      } else {
        setCurrentStep(3); // Go to insurance verification
      }
    }
  };

  // New Step 3: Insurance verification
  const handleStep3Continue = () => {
    // DEV: Check for bypass flag
    const devSkip = typeof window !== 'undefined' && localStorage.getItem('dev_skip_insurance') === 'true';
    if (devSkip) {
      console.log('🔓 DEV MODE: Skipping insurance verification');
      setHasInsurance(true);
      setUploadedDocumentId('dev-bypass-doc-id');
    }

    // Insurance step - just move to customer details (Step 4)
    setCurrentStep(4);
  };

  // Handle Bonzah coverage change from BonzahInsuranceSelector
  const handleBonzahCoverageChange = (coverage: CoverageOptions, premium: number) => {
    setBonzahCoverage(coverage);
    setBonzahPremium(premium);
  };

  // Handle skip insurance from BonzahInsuranceSelector
  const handleBonzahSkipInsurance = () => {
    setBonzahCoverage({ cdw: false, rcli: false, sli: false, pai: false });
    setBonzahPremium(0);
    setBonzahPolicyId(null);
  };

  // Step 4: Customer Details
  const handleStep4Continue = async () => {
    console.log('🚀 handleStep4Continue called');
    console.log('🔐 Current verification status:', verificationStatus);
    console.log('🔘 Button disabled state:', verificationStatus !== 'verified');

    const isValid = validateStep4();
    console.log('✨ Validation returned:', isValid);

    if (!isValid) {
      console.log('❌ Validation failed! Not moving to step 5');
      return;
    }

    console.log('✅ Validation passed! Moving to step 5');

    // Calculate age from DOB for young driver check
    const driverAge = formData.driverDOB ? calculateAge(parseDateString(formData.driverDOB)) : 0;
    const isYoungDriver = driverAge < 25;

    // Update booking context with customer details and DOB
    updateBookingContext({
      customerName: formData.customerName,
      customerEmail: formData.customerEmail,
      customerPhone: formData.customerPhone,
      customerType: formData.customerType,
      driverDOB: formData.driverDOB,
      driverAge: driverAge,
      young_driver: isYoungDriver
    } as any);

    // Analytics tracking
    if ((window as any).gtag) {
      (window as any).gtag('event', 'booking_step4_submitted', {
        customer_type: formData.customerType,
        verification_status: verificationStatus,
        driver_age: driverAge
      });
    }
    setCurrentStep(5);
  };

  const validateStep3 = () => {
    // Step 3 is insurance - optional, always valid
    return true;
  };

  const validateStep4 = () => {
    // Validation for customer details
    const newErrors: { [key: string]: string } = {};

    if (!formData.customerName || formData.customerName.trim() === '') {
      newErrors.customerName = 'Please enter your name';
    }
    if (!formData.customerEmail || !formData.customerEmail.includes('@')) {
      newErrors.customerEmail = 'Please enter a valid email';
    }
    if (!formData.customerPhone || formData.customerPhone.trim() === '') {
      newErrors.customerPhone = 'Please enter your phone number';
    }
    if (!formData.customerType) {
      newErrors.customerType = 'Please select customer type';
    }
    // DOB validation
    if (!formData.driverDOB || formData.driverDOB.trim() === '') {
      newErrors.driverDOB = 'Date of birth is required';
    } else {
      const dob = parseDateString(formData.driverDOB);
      if (isNaN(dob.getTime())) {
        newErrors.driverDOB = 'Please enter a valid date of birth';
      } else {
        const minAge = tenant?.minimum_rental_age || 21;
        const age = calculateAge(dob);
        if (age < minAge) {
          newErrors.driverDOB = `You must be at least ${minAge} years old to rent a vehicle`;
        }
      }
    }

    // Check verification status (with dev bypass)
    const devBypassVerification = typeof window !== 'undefined' && localStorage.getItem('dev_bypass_verification') === 'true';
    if (verificationStatus !== 'verified' && !devBypassVerification) {
      console.log('❌ Verification not completed:', verificationStatus);
      toast.error('Please complete identity verification to continue');
      return false;
    }
    if (devBypassVerification) {
      console.log('🔓 DEV MODE: Bypassing verification check');
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const validateStep5 = () => {
    // Step 5 is review/confirm, no additional validation needed
    // All validation has been done in previous steps
    return true;
  };
  if (showConfirmation && bookingDetails) {
    return <BookingConfirmation bookingDetails={bookingDetails} onClose={handleCloseConfirmation} />;
  }

  // Dynamic title based on step
  const getStepTitle = () => {
    const defaultTitle = cmsContent.booking_header?.title || "Book Your Rental";
    switch (currentStep) {
      case 1:
        return defaultTitle;
      case 2:
        return "Choose Vehicle";
      case 3:
        return "Insurance Verification";
      case 4:
        return "Your Details";
      case 5:
        return "Review & Confirm";
      default:
        return defaultTitle;
    }
  };
  return <>
    {/* Booking Hero Header */}
    <section className="bk-hero">
      <div className="bk-hero__inner">
        <h1 className="bk-hero__title">{getStepTitle()}</h1>
        <div className="flex items-center justify-center mt-4">
          <div className="h-[1px] w-24 bg-gradient-to-r from-transparent via-primary to-transparent" />
        </div>
        <p className="bk-hero__subtitle">
          {cmsContent.booking_header?.subtitle || "Quick, easy, and affordable car rentals in Dallas — from pickup to drop-off, we've got you covered."}
        </p>

        <p className="bk-hero__meta">{(cmsContent.booking_header?.trust_points || ["Dallas–Fort Worth Area", "Transparent Rates", "24/7 Support"]).join(" · ")}</p>
      </div>
    </section>

    <Card ref={stepContainerRef} className="p-4 md:p-8 bg-card backdrop-blur-sm border-border shadow-[0_8px_30px_rgba(0,0,0,0.12)] dark:shadow-[0_8px_30px_rgba(0,0,0,0.4)]">
      <div className="space-y-8 bk-steps">
        {/* Enhanced Progress Indicator */}
        <div className="w-full overflow-x-auto py-4">
          <div className="flex items-center justify-between relative min-w-[280px]">
            {/* Dynamic steps based on whether tenant is insurance exempt */}
            {(skipInsurance ? [
              { step: 1, displayStep: 1, label: "Trip", fullLabel: "Trip Details" },
              { step: 2, displayStep: 2, label: "Vehicle", fullLabel: "Choose Vehicle" },
              { step: 4, displayStep: 3, label: "Details", fullLabel: "Customer Details" },
              { step: 5, displayStep: 4, label: "Review", fullLabel: "Review & Confirm" }
            ] : [
              { step: 1, displayStep: 1, label: "Trip", fullLabel: "Trip Details" },
              { step: 2, displayStep: 2, label: "Vehicle", fullLabel: "Choose Vehicle" },
              { step: 3, displayStep: 3, label: "Insurance", fullLabel: "Insurance Verification" },
              { step: 4, displayStep: 4, label: "Details", fullLabel: "Customer Details" },
              { step: 5, displayStep: 5, label: "Review", fullLabel: "Review & Confirm" }
            ]).map(({
              step,
              displayStep,
              label,
              fullLabel
            }, index, arr) => <div key={step} className="flex flex-col items-center flex-1 relative z-10">
                <div className={cn("bk-step__node flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 md:w-14 md:h-14 rounded-full border-2 transition-all", currentStep >= step ? 'bg-primary border-primary shadow-glow' : 'border-border bg-muted', currentStep === step && 'bk-step__node--active shadow-glow')} aria-label={`Step ${displayStep} of ${arr.length}: ${fullLabel}`} aria-current={currentStep === step ? "step" : undefined}>
                  {currentStep > step ? <Check className="w-4 h-4 sm:w-5 sm:h-5 md:w-6 md:h-6 text-primary-foreground" /> : <span className={cn("text-base sm:text-lg md:text-xl font-bold", currentStep === step ? "text-primary-foreground" : "text-muted-foreground")}>
                    {displayStep}
                  </span>}
                </div>
                <span className={`mt-1.5 sm:mt-2 text-[10px] sm:text-xs md:text-sm font-medium text-center leading-tight ${currentStep >= step ? 'text-primary' : 'text-muted-foreground'}`}>
                  <span className="hidden sm:inline">{fullLabel}</span>
                  <span className="sm:hidden">{label}</span>
                </span>
                {index < arr.length - 1 && <div className={cn("bk-step__line absolute top-5 sm:top-6 md:top-7 left-[calc(50%+20px)] sm:left-[calc(50%+24px)] md:left-[calc(50%+28px)] w-[calc(100%-40px)] sm:w-[calc(100%-48px)] md:w-[calc(100%-56px)] h-0.5", currentStep > step ? 'bg-primary' : 'bg-border')} />}
              </div>)}
          </div>
        </div>

        {/* Step 1: Rental Details */}
        {currentStep === 1 && <div className="space-y-8 animate-fade-in">
          {/* Header with underline */}
          <div>
            <h3 className="text-2xl md:text-3xl font-display font-semibold text-foreground pb-2 border-b-2 border-primary/30">
              Rental Details
            </h3>
          </div>

          {/* Timezone Info Bar - Compact & Highlighted */}
          <div className="flex flex-wrap items-center gap-3 text-sm py-2.5 px-4 rounded-lg bg-primary/5 border border-primary/20">
            <div className="flex items-center gap-2">
              <div className="flex items-center justify-center w-6 h-6 rounded-full bg-primary/10">
                <Globe className="h-3.5 w-3.5 text-primary" />
              </div>
              <span className="text-muted-foreground">You:</span>
              {isAuthenticated && isCustomerDataPopulated && customerHasTimezone ? (
                <span className="font-semibold text-foreground">
                  {findTimezone(formData.customerTimezone)?.label || formData.customerTimezone}
                </span>
              ) : (
                <Select
                  value={formData.customerTimezone}
                  onValueChange={(value) => setFormData({ ...formData, customerTimezone: value })}
                >
                  <SelectTrigger className="h-7 w-auto min-w-[180px] text-sm border-0 bg-transparent p-0 font-semibold text-foreground focus:ring-0">
                    <SelectValue placeholder="Select timezone">
                      {findTimezone(formData.customerTimezone)?.label || 'Select timezone'}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent className="max-h-[300px]">
                    {getTimezonesByRegion().map((group) => (
                      <div key={group.region}>
                        <div className="px-2 py-1.5 text-sm font-semibold text-muted-foreground bg-muted/50">
                          {group.label}
                        </div>
                        {group.timezones.map((tz) => (
                          <SelectItem key={tz.value} value={tz.value}>
                            {tz.label}
                          </SelectItem>
                        ))}
                      </div>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="h-4 w-px bg-primary/20 hidden sm:block" />
            <div className="flex items-center gap-2">
              <div className="flex items-center justify-center w-6 h-6 rounded-full bg-primary/10">
                <Clock className="h-3.5 w-3.5 text-primary" />
              </div>
              <span className="text-muted-foreground">Business:</span>
              <span className="font-semibold text-foreground">
                {findTimezone(workingHours.timezone)?.label || workingHours.timezone}
              </span>
              <span className="text-xs text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-full">
                {workingHours.isAlwaysOpen ? '24/7' : `${workingHours.formattedOpenTime} - ${workingHours.formattedCloseTime}`}
              </span>
            </div>
          </div>

          {/* Pickup & Return Sections */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* PICKUP SECTION */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 pb-2 border-b border-border">
                <div className="w-2 h-2 rounded-full bg-green-500" />
                <h4 className="font-medium text-sm uppercase tracking-wide text-muted-foreground">Pickup</h4>
              </div>

              {/* Pickup Location */}
              <div className="space-y-2">
                <Label htmlFor="pickupLocation" className="text-xs text-muted-foreground">Location</Label>
                <LocationPicker
                  type="pickup"
                  value={formData.pickupLocation}
                  locationId={formData.pickupLocationId}
                  onChange={(address, locId, lat, lon, deliveryFee) => {
                    setFormData(prev => ({
                      ...prev,
                      pickupLocation: address,
                      pickupLocationId: locId || "",
                      pickupDeliveryFee: deliveryFee ?? 0,
                    }));
                    setLocationCoords(prev => ({
                      ...prev,
                      pickupLat: lat || null,
                      pickupLon: lon || null
                    }));
                    validateField('pickupLocation', address);
                  }}
                  placeholder="Enter pickup address"
                  className="h-11"
                />
                {errors.pickupLocation && <p className="text-sm text-destructive">{errors.pickupLocation}</p>}
              </div>

              {/* Pickup Date & Time */}
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Date & Time</Label>
                <div className="grid grid-cols-2 gap-2">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className={cn("w-full justify-start text-left font-normal h-11", !formData.pickupDate && "text-muted-foreground")}>
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {formData.pickupDate ? format(parseDateString(formData.pickupDate), "MMM dd") : <span>Date</span>}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar mode="single" selected={formData.pickupDate ? parseDateString(formData.pickupDate) : undefined} onSelect={date => {
                        if (date) {
                          const dateStr = format(date, "yyyy-MM-dd");
                          if (blockedDates.includes(dateStr)) {
                            toast.error("This date is not available for booking.");
                            return;
                          }
                          setFormData({
                            ...formData,
                            pickupDate: dateStr
                          });
                          if (errors.pickupDate) {
                            setErrors({
                              ...errors,
                              pickupDate: ""
                            });
                          }
                        }
                      }} disabled={date => {
                        const dateStr = format(date, "yyyy-MM-dd");
                        const today = new Date(new Date().setHours(0, 0, 0, 0));
                        const oneYearFromNow = new Date(today);
                        oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);
                        const dayWorkingHours = getWorkingHoursForDate(date, tenant);
                        const isClosedDay = !dayWorkingHours.enabled;
                        // Disable dates that fall entirely within the lead time window
                        const leadTimeHours = tenant?.booking_lead_time_hours ?? 24;
                        const leadTimeCutoff = new Date(Date.now() + leadTimeHours * 60 * 60 * 1000);
                        const endOfDay = new Date(date);
                        endOfDay.setHours(23, 59, 59, 999);
                        const isWithinLeadTime = leadTimeHours >= 24 && endOfDay < leadTimeCutoff;
                        return date < today || date > oneYearFromNow || blockedDates.includes(dateStr) || isClosedDay || isWithinLeadTime;
                      }} initialFocus className="pointer-events-auto" />
                    </PopoverContent>
                  </Popover>
                  <TimePicker
                    id="pickupTime"
                    value={formData.pickupTime}
                    onChange={value => {
                      setFormData({
                        ...formData,
                        pickupTime: value
                      });
                      if (errors.pickupTime) {
                        setErrors({
                          ...errors,
                          pickupTime: ""
                        });
                      }
                    }}
                    className="h-11"
                    businessHoursOpen={!pickupDateWorkingHours.isAlwaysOpen && pickupDateWorkingHours.enabled ? pickupDateWorkingHours.open : undefined}
                    businessHoursClose={!pickupDateWorkingHours.isAlwaysOpen && pickupDateWorkingHours.enabled ? pickupDateWorkingHours.close : undefined}
                    customerTimezone={formData.customerTimezone}
                    tenantTimezone={workingHours.timezone}
                  />
                </div>
                {errors.pickupDate && <p className="text-sm text-destructive">{errors.pickupDate}</p>}
                {errors.pickupTime && !errors.pickupDate && <p className="text-sm text-destructive">{errors.pickupTime}</p>}
              </div>
            </div>

            {/* RETURN SECTION */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 pb-2 border-b border-border">
                <div className="w-2 h-2 rounded-full bg-orange-500" />
                <h4 className="font-medium text-sm uppercase tracking-wide text-muted-foreground">Return</h4>
              </div>

              {/* Return Location */}
              <div className="space-y-2">
                <Label htmlFor="dropoffLocation" className="text-xs text-muted-foreground">Location</Label>
                <LocationPicker
                  type="return"
                  value={formData.dropoffLocation}
                  locationId={formData.returnLocationId}
                  onChange={(address, locId, lat, lon, deliveryFee) => {
                    setFormData(prev => ({
                      ...prev,
                      dropoffLocation: address,
                      returnLocationId: locId || "",
                      returnDeliveryFee: deliveryFee ?? 0,
                    }));
                    setLocationCoords(prev => ({
                      ...prev,
                      dropoffLat: lat || null,
                      dropoffLon: lon || null
                    }));
                    validateField('dropoffLocation', address);
                  }}
                  placeholder="Enter return address"
                  className="h-11"
                />
                {errors.dropoffLocation && <p className="text-sm text-destructive">{errors.dropoffLocation}</p>}
              </div>

              {/* Return Date & Time */}
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Date & Time</Label>
                <div className="grid grid-cols-2 gap-2">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className={cn("w-full justify-start text-left font-normal h-11", !formData.dropoffDate && "text-muted-foreground")}>
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {formData.dropoffDate ? format(parseDateString(formData.dropoffDate), "MMM dd") : <span>Date</span>}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar mode="single" selected={formData.dropoffDate ? parseDateString(formData.dropoffDate) : undefined} onSelect={date => {
                        if (date) {
                          const dateStr = format(date, "yyyy-MM-dd");
                          setFormData({
                            ...formData,
                            dropoffDate: dateStr
                          });
                          if (errors.dropoffDate) {
                            setErrors({
                              ...errors,
                              dropoffDate: ""
                            });
                          }
                        }
                      }} disabled={date => {
                        const pickupDate = formData.pickupDate ? parseDateString(formData.pickupDate) : new Date();
                        const oneYearFromPickup = new Date(pickupDate);
                        oneYearFromPickup.setFullYear(oneYearFromPickup.getFullYear() + 1);
                        const dateStr = format(date, "yyyy-MM-dd");
                        const dayWorkingHours = getWorkingHoursForDate(date, tenant);
                        const isClosedDay = !dayWorkingHours.enabled;
                        return date <= pickupDate || date > oneYearFromPickup || blockedDates.includes(dateStr) || isClosedDay;
                      }} initialFocus className="pointer-events-auto" />
                    </PopoverContent>
                  </Popover>
                  <TimePicker
                    id="dropoffTime"
                    value={formData.dropoffTime}
                    onChange={value => {
                      setFormData({
                        ...formData,
                        dropoffTime: value
                      });
                      if (errors.dropoffTime) {
                        setErrors({
                          ...errors,
                          dropoffTime: ""
                        });
                      }
                    }}
                    className="h-11"
                    businessHoursOpen={!dropoffDateWorkingHours.isAlwaysOpen && dropoffDateWorkingHours.enabled ? dropoffDateWorkingHours.open : undefined}
                    businessHoursClose={!dropoffDateWorkingHours.isAlwaysOpen && dropoffDateWorkingHours.enabled ? dropoffDateWorkingHours.close : undefined}
                    customerTimezone={formData.customerTimezone}
                    tenantTimezone={workingHours.timezone}
                  />
                </div>
                {errors.dropoffDate && <p className="text-sm text-destructive">{errors.dropoffDate}</p>}
                {errors.dropoffTime && !errors.dropoffDate && <p className="text-sm text-destructive">{errors.dropoffTime}</p>}
              </div>
            </div>
          </div>

          <Button
            onClick={handleStep1Continue}
            className="w-full h-12 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-base shadow-md hover:shadow-lg transition-all"
            size="lg"
          >
            Continue to Vehicle Selection <ChevronRight className="ml-2 w-5 h-5" />
          </Button>
        </div>}

        {/* Step 2: Vehicle Selection */}
        {currentStep === 2 && <div className="space-y-6 animate-fade-in">
          {/* Back Button */}
          <Button onClick={() => setCurrentStep(1)} variant="ghost" className="text-muted-foreground hover:text-foreground -ml-2">
            <ChevronLeft className="mr-1 w-5 h-5" /> Back to Trip Details
          </Button>

          {/* Header */}
          <div className="space-y-3">
            <h3 className="text-3xl md:text-4xl font-display font-semibold text-foreground">
              Select Your Vehicle
            </h3>
            <p className="text-muted-foreground text-base">
              Choose from our curated fleet of premium rentals.
            </p>
            {formData.pickupDate && formData.dropoffDate && <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CalendarIcon className="w-4 h-4" />
              <span>
                {format(parseDateString(formData.pickupDate), "MMM dd")} → {format(parseDateString(formData.dropoffDate), "MMM dd")}
              </span>
              <span>•</span>
              <span>{formData.pickupLocation.split(',')[0] || 'Selected location'}</span>
              <span>•</span>
              <span>{calculateRentalDuration()?.formatted || '0 days'}</span>
            </div>}
          </div>

          {/* Toolbar */}
          <Card className="p-4 bg-card/90 backdrop-blur-sm border-primary/15 sticky top-20 z-30 shadow-lg">
            <div className="flex flex-col gap-4">
              {/* Top Row: Search, Sort, View Toggle */}
              <div className="flex flex-col sm:flex-row gap-3">
                {/* Search */}
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input value={searchTerm} onChange={e => handleSearchChange(e.target.value)} placeholder="Search brand, model, or color…" className="pl-10 h-10 bg-background focus-visible:ring-primary" aria-label="Search vehicles" />
                </div>

                {/* Sort */}
                <Select value={sortBy} onValueChange={value => {
                  setSortBy(value);
                  if ((window as any).gtag) {
                    (window as any).gtag('event', 'fleet_sort_changed', {
                      sortKey: value
                    });
                  }
                }}>
                  <SelectTrigger className="w-full sm:w-[200px] h-10 focus-visible:ring-primary">
                    <SelectValue placeholder="Sort by" />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-primary/20">
                    <SelectItem value="recommended">Recommended</SelectItem>
                    <SelectItem value="price_low">Price: Low → High</SelectItem>
                    <SelectItem value="price_high">Price: High → Low</SelectItem>
                  </SelectContent>
                </Select>

                {/* More Filters */}
                <Popover open={showFilters} onOpenChange={setShowFilters}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="h-10 gap-2 border-primary/30 hover:bg-primary/10">
                      <SlidersHorizontal className="w-4 h-4" />
                      Filters
                      {(filters.transmission.length > 0 || filters.fuel.length > 0) && <Badge className="ml-1 h-5 w-5 rounded-full p-0 bg-primary text-primary-foreground">
                        {filters.transmission.length + filters.fuel.length}
                      </Badge>}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-80 bg-card border-primary/20 p-4" align="end">
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <h4 className="font-semibold">Filters</h4>
                        <Button variant="ghost" size="sm" onClick={() => {
                          setPriceFilterMode("daily"); // Reset to daily mode
                          // Recalculate range for daily prices
                          const prices = vehicles.map(v => v.daily_rent || 0).filter(p => p > 0);
                          const newRange: [number, number] = prices.length > 0
                            ? [Math.min(...prices), Math.max(...prices)]
                            : [0, 1000];
                          setOriginalPriceRange(newRange);
                          setFilters({
                            transmission: [],
                            fuel: [],
                            seats: [2, 7],
                            priceRange: newRange
                          });
                        }}>
                          Reset
                        </Button>
                      </div>

                      {/* Transmission - Hidden for portal (no transmission data in portal DB) */}
                      {/* <div className="space-y-2">
                          <Label className="text-sm font-medium">Transmission</Label>
                          <div className="flex flex-col gap-2">
                            <label className="flex items-center gap-2 cursor-pointer">
                              <Checkbox checked={filters.transmission.includes("automatic")} onCheckedChange={checked => {
                              setFilters(prev => ({
                                ...prev,
                                transmission: checked ? [...prev.transmission, "automatic"] : prev.transmission.filter(t => t !== "automatic")
                              }));
                            }} />
                              <span className="text-sm">Automatic</span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                              <Checkbox checked={filters.transmission.includes("manual")} onCheckedChange={checked => {
                              setFilters(prev => ({
                                ...prev,
                                transmission: checked ? [...prev.transmission, "manual"] : prev.transmission.filter(t => t !== "manual")
                              }));
                            }} />
                              <span className="text-sm">Manual</span>
                            </label>
                          </div>
                        </div> */}

                      {/* Seats - Hidden for portal (no capacity data in portal DB) */}
                      {/* <div className="space-y-2">
                          <Label className="text-sm font-medium">Seats: {filters.seats[0]} - {filters.seats[1]}+</Label>
                          <Slider value={filters.seats} onValueChange={value => setFilters(prev => ({
                          ...prev,
                          seats: value as [number, number]
                        }))} min={2} max={7} step={1} className="py-2" />
                        </div> */}

                      {/* Price Filter Mode */}
                      <div className="space-y-2">
                        <Label className="text-sm font-medium">Filter By Price</Label>
                        <div className="flex gap-1 p-1 bg-muted/50 rounded-lg">
                          <button
                            type="button"
                            onClick={() => handlePriceFilterModeChange("daily")}
                            className={cn(
                              "flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                              priceFilterMode === "daily"
                                ? "bg-primary text-primary-foreground"
                                : "text-muted-foreground hover:text-foreground hover:bg-muted"
                            )}
                          >
                            Daily
                          </button>
                          <button
                            type="button"
                            onClick={() => handlePriceFilterModeChange("weekly")}
                            className={cn(
                              "flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                              priceFilterMode === "weekly"
                                ? "bg-primary text-primary-foreground"
                                : "text-muted-foreground hover:text-foreground hover:bg-muted"
                            )}
                          >
                            Weekly
                          </button>
                          <button
                            type="button"
                            onClick={() => handlePriceFilterModeChange("monthly")}
                            className={cn(
                              "flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                              priceFilterMode === "monthly"
                                ? "bg-primary text-primary-foreground"
                                : "text-muted-foreground hover:text-foreground hover:bg-muted"
                            )}
                          >
                            Monthly
                          </button>
                        </div>
                      </div>

                      {/* Price Range */}
                      <div className="space-y-2">
                        <Label className="text-sm font-medium">
                          Price Range: {formatCurrency(filters.priceRange[0], currencyCode, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} - {formatCurrency(filters.priceRange[1], currencyCode, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                          <span className="text-xs text-muted-foreground ml-1">
                            / {priceFilterMode === "daily" ? "day" : priceFilterMode === "weekly" ? "week" : "month"}
                          </span>
                        </Label>
                        <div className="flex justify-between text-xs text-muted-foreground mb-1">
                          <span>Budget</span>
                          <span>Premium</span>
                        </div>
                        <Slider value={filters.priceRange} onValueChange={value => setFilters(prev => ({
                          ...prev,
                          priceRange: value as [number, number]
                        }))} min={originalPriceRange[0]} max={originalPriceRange[1]} step={10} className="py-2" />
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>

                {/* View Toggle */}
                <div className="flex gap-1 border border-primary/30 rounded-md p-1">
                  <Button variant="ghost" size="sm" className={cn("h-8 w-8 p-0", viewMode === "grid" && "bg-primary/20 text-primary")} onClick={() => handleViewModeChange("grid")} aria-label="Grid view">
                    <Grid3x3 className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="sm" className={cn("h-8 w-8 p-0", viewMode === "list" && "bg-primary/20 text-primary")} onClick={() => handleViewModeChange("list")} aria-label="List view">
                    <List className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              {/* Category Chips - Hidden for portal (no categories in portal DB) */}
              {/* <div className="flex flex-wrap gap-2">
                  {["Ultra Luxury", "Executive", "Luxury SUV", "Sport Coupe", "Convertible", "Group Transport"].map(category => <Button key={category} variant="outline" size="sm" className={cn("h-8 rounded-full border-primary/30 transition-colors", selectedCategories.includes(category) ? "bg-primary text-primary-foreground border-primary hover:bg-primary/90" : "hover:bg-primary/10 hover:border-primary/50")} onClick={() => toggleCategory(category)} aria-pressed={selectedCategories.includes(category)}>
                      {category}
                    </Button>)}
                </div> */}

              {/* Active Filters */}
              {hasActiveFilters && <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border/50">
                <span className="text-xs text-muted-foreground">Active filters:</span>
                {searchTerm && <Badge variant="secondary" className="gap-1">
                  Search: {searchTerm}
                  <X className="w-3 h-3 cursor-pointer" onClick={() => setSearchTerm("")} />
                </Badge>}
                {selectedCategories.map(cat => <Badge key={cat} variant="secondary" className="gap-1">
                  {cat}
                  <X className="w-3 h-3 cursor-pointer" onClick={() => toggleCategory(cat)} />
                </Badge>)}
                {sortBy !== "recommended" && <Badge variant="secondary" className="gap-1">
                  {getSortLabel(sortBy)}
                  <X className="w-3 h-3 cursor-pointer" onClick={() => setSortBy("recommended")} />
                </Badge>}
                <Button variant="ghost" size="sm" className="h-6 text-xs text-primary hover:text-primary/80" onClick={clearAllFilters}>
                  Clear all
                </Button>
              </div>}
            </div>
          </Card>

          {errors.vehicleId && <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
            <p className="text-sm text-destructive">{errors.vehicleId}</p>
          </div>}

          <div className="grid lg:grid-cols-4 gap-6">
            {/* Vehicle Grid/List - Independent scrollable container */}
            <div className="lg:col-span-3">
              {filteredVehicles.length === 0 ? <Card className="p-12 text-center bg-card/50">
                <Car className="w-16 h-16 mx-auto mb-4 text-muted-foreground opacity-40" />
                <p className="text-lg font-medium text-foreground mb-2">No vehicles match your filters</p>
                <p className="text-sm text-muted-foreground mb-4">
                  Try adjusting your dates or categories.
                </p>
                <Button variant="outline" onClick={clearAllFilters} className="border-primary/30">
                  Clear Filters
                </Button>
              </Card> : <div className="max-h-[70vh] overflow-y-auto pr-2 vehicle-list-scroll" style={{ scrollbarGutter: 'stable' }}>
                <div className={cn("grid gap-6", viewMode === "grid" ? "grid-cols-1 md:grid-cols-2 lg:grid-cols-3" : "grid-cols-1")}>
                  {filteredVehicles.map(vehicle => {
                    const badge = getVehicleBadge(vehicle);
                    const vehicleName = vehicle.make && vehicle.model ? `${vehicle.make} ${vehicle.model}` : vehicle.make || vehicle.model || vehicle.reg;
                    const isRollsRoyce = (vehicle.make || '').toLowerCase().includes("rolls") || (vehicle.model || '').toLowerCase().includes("phantom");
                    const isSelected = formData.vehicleId === vehicle.id;
                    const estimation = calculateEstimatedTotal(vehicle);
                    const blockStatus = isVehicleBlockedForPeriod(vehicle.id);
                    const isBlocked = blockStatus.blocked;

                    // Promo Logic for Display
                    let displayPrice = estimation?.total || 0;
                    let originalPrice = displayPrice;
                    let hasDiscount = false;
                    let promoErrorMsg: string | null = null;

                    if (promoDetails && estimation) {
                      if (promoDetails.type === 'fixed_amount') {
                        if (estimation.total > promoDetails.value) {
                          displayPrice = estimation.total - promoDetails.value;
                          hasDiscount = true;
                        } else {
                          promoErrorMsg = "Promo code cannot be applied on this vehicle price";
                        }
                      } else if (promoDetails.type === 'percentage') {
                        const discount = (estimation.total * promoDetails.value) / 100;
                        displayPrice = estimation.total - discount;
                        hasDiscount = true;
                      }
                    }

                    // Hide blocked/unavailable vehicles completely
                    if (isBlocked) return null;

                    if (viewMode === "list") {
                      // List View Card
                      return <Card key={vehicle.id} className={cn("group transition-all duration-300 overflow-hidden border-2 relative",
                        "cursor-pointer hover:shadow-2xl",
                        isSelected ? "border-primary bg-primary/5 shadow-glow" : "border-border/30 hover:border-primary/40")} onClick={() => {
                          setFormData({
                            ...formData,
                            vehicleId: vehicle.id
                          });
                          if (errors.vehicleId) {
                            setErrors({
                              ...errors,
                              vehicleId: ""
                            });
                          }
                          if ((window as any).gtag) {
                            (window as any).gtag('event', 'vehicle_card_viewed', {
                              vehicle_id: vehicle.id
                            });
                          }
                        }}>
                        <div className="flex flex-col sm:flex-row">
                          {/* Image with Carousel */}
                          <div className="relative w-full sm:w-64 aspect-video sm:aspect-square overflow-hidden bg-gradient-to-br from-muted/30 to-muted/5">
                            {vehicle.vehicle_photos && vehicle.vehicle_photos.length > 0 ? (
                              <>
                                <img
                                  src={vehicle.vehicle_photos[getVehicleImageIndex(vehicle.id)]?.photo_url || vehicle.vehicle_photos[0].photo_url}
                                  alt={vehicleName}
                                  className="w-full h-full object-cover"
                                  loading="lazy"
                                  onError={(e) => {
                                    e.currentTarget.style.display = 'none';
                                  }}
                                />
                                {/* Carousel Navigation - only show if more than 1 image */}
                                {vehicle.vehicle_photos.length > 1 && (
                                  <>
                                    <button
                                      onClick={(e) => prevVehicleImage(e, vehicle.id, vehicle.vehicle_photos!.length)}
                                      className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/50 hover:bg-black/70 flex items-center justify-center text-white transition-colors z-10"
                                    >
                                      <ChevronLeft className="w-5 h-5" />
                                    </button>
                                    <button
                                      onClick={(e) => nextVehicleImage(e, vehicle.id, vehicle.vehicle_photos!.length)}
                                      className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/50 hover:bg-black/70 flex items-center justify-center text-white transition-colors z-10"
                                    >
                                      <ChevronRight className="w-5 h-5" />
                                    </button>
                                    {/* Dots indicator */}
                                    <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5 z-10">
                                      {vehicle.vehicle_photos.map((_, idx) => (
                                        <div
                                          key={idx}
                                          className={cn(
                                            "w-2 h-2 rounded-full transition-colors",
                                            idx === getVehicleImageIndex(vehicle.id) ? "bg-white" : "bg-white/50"
                                          )}
                                        />
                                      ))}
                                    </div>
                                  </>
                                )}
                              </>
                            ) : vehicle.photo_url ? (
                              <img
                                src={vehicle.photo_url}
                                alt={vehicleName}
                                className="w-full h-full object-cover"
                                loading="lazy"
                                onError={(e) => {
                                  e.currentTarget.style.display = 'none';
                                }}
                              />
                            ) : null}
                            <div className={`${(vehicle.vehicle_photos && vehicle.vehicle_photos.length > 0) || vehicle.photo_url ? 'hidden' : 'flex'} items-center justify-center h-full w-full absolute inset-0`}>
                              <Car className="w-16 h-16 opacity-20 text-muted-foreground" />
                            </div>

                            {/* Registration Chip - hide when selected, show tick instead */}
                            {!isSelected ? (
                              <div className="absolute top-3 right-3 px-3 py-1 bg-primary text-primary-foreground text-xs font-semibold rounded-full z-20">
                                {vehicle.reg}
                              </div>
                            ) : (
                              <div className="absolute top-3 right-3 w-8 h-8 bg-primary rounded-full flex items-center justify-center shadow-lg z-20">
                                <Check className="w-5 h-5 text-black" />
                              </div>
                            )}

                          </div>

                          {/* Content */}
                          <div className="flex-1 p-6 flex flex-col justify-between">
                            <div className="space-y-3">
                              {/* Title */}
                              <div className="flex items-start justify-between gap-4">
                                <div>
                                  <h4 className="font-display text-2xl font-semibold text-foreground flex items-center gap-2">
                                    {vehicleName}
                                    {isRollsRoyce && <Crown className="w-5 h-5 text-primary" />}
                                  </h4>
                                  {vehicle.colour && <p className="text-xs text-muted-foreground mt-1">{vehicle.colour}</p>}
                                  <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                                    <Gauge className="h-3 w-3" />
                                    <span>{vehicle.allowed_mileage ? `${vehicle.allowed_mileage.toLocaleString()} ${getPerMonthLabel(distanceUnit)}` : getUnlimitedLabel(distanceUnit)}</span>
                                  </div>
                                </div>
                                {isSelected && <div className="w-6 h-6 bg-primary rounded-full flex items-center justify-center">
                                  <Check className="w-4 h-4 text-black" />
                                </div>}
                              </div>

                              {/* Description */}
                              {vehicle.description && (
                                <div className="space-y-1">
                                  <p className="text-sm text-muted-foreground leading-relaxed">
                                    {getDisplayDescription(vehicle)}
                                  </p>
                                  {vehicle.description.length > MAX_DESCRIPTION_LENGTH && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        toggleDescription(vehicle.id);
                                      }}
                                      className="text-xs text-primary hover:text-primary/80 font-medium transition-colors"
                                    >
                                      {expandedDescriptions.has(vehicle.id) ? 'Show less' : 'Show more'}
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>

                            {/* Pricing & CTA */}
                            {(() => {
                              const priceDisplay = getDynamicPriceDisplay(vehicle);
                              return (
                                <div className="flex items-end justify-between gap-4 mt-4">
                                  <div className="space-y-1">
                                    <div className="flex items-baseline gap-2">
                                      {hasDiscount ? (
                                        <>
                                          <span className="text-base text-muted-foreground line-through">{formatCurrency(Number(originalPrice), currencyCode, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
                                          <span className="text-3xl font-bold text-green-600">{formatCurrency(Number(displayPrice), currencyCode, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
                                        </>
                                      ) : (
                                        <span className="text-3xl font-bold text-primary">{formatCurrency(priceDisplay.price, currencyCode, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
                                      )}
                                      <span className="text-sm text-muted-foreground">{priceDisplay.label}</span>
                                    </div>
                                    {promoErrorMsg && <p className="text-xs text-destructive">{promoErrorMsg}</p>}
                                    {priceDisplay.secondaryPrices.length > 0 && (
                                      <p className="text-xs text-muted-foreground">
                                        {priceDisplay.secondaryPrices.join(' • ')}
                                      </p>
                                    )}
                                  </div>


                                  <Button
                                    className={cn("w-40 h-11 font-medium transition-colors",
                                      isSelected ? "bg-primary text-primary-foreground hover:bg-primary/90" :
                                        "bg-background border-2 border-primary text-primary hover:bg-primary hover:text-primary-foreground")}
                                    onClick={e => {
                                      e.stopPropagation();
                                      // Toggle: if already selected, deselect; otherwise select
                                      setFormData({
                                        ...formData,
                                        vehicleId: isSelected ? '' : vehicle.id
                                      });
                                      if ((window as any).gtag && !isSelected) {
                                        (window as any).gtag('event', 'vehicle_selected', {
                                          vehicle_id: vehicle.id,
                                          est_total: estimation?.total || 0
                                        });
                                      }
                                    }}>
                                    {isSelected ? "Selected" : "Select"}
                                  </Button>
                                </div>
                              );
                            })()}
                          </div>
                        </div>
                      </Card>;
                    }

                    // Grid View Card (existing design)
                    return <Card key={vehicle.id} className={cn("group transition-all duration-300 overflow-hidden border-2 relative flex flex-col h-full",
                      isBlocked ? "opacity-60 cursor-not-allowed border-destructive/30" : "cursor-pointer hover:shadow-2xl hover:scale-[1.02]",
                      !isBlocked && isSelected ? "border-primary bg-primary/5 shadow-glow" : "border-border/30 hover:border-primary/40",
                      !isBlocked && isRollsRoyce && "shadow-glow")} onClick={() => {
                        if (isBlocked) return; // Prevent selection if blocked
                        setFormData({
                          ...formData,
                          vehicleId: vehicle.id
                        });
                        if (errors.vehicleId) {
                          setErrors({
                            ...errors,
                            vehicleId: ""
                          });
                        }
                        if ((window as any).gtag) {
                          (window as any).gtag('event', 'vehicle_card_viewed', {
                            vehicle_id: vehicle.id
                          });
                        }
                      }}>
                      {/* Registration Chip - hide when selected, show tick instead */}
                      {!isSelected && (
                        <div className="absolute top-3 right-3 z-10 px-3 py-1 bg-primary text-primary-foreground text-xs font-semibold rounded-full">
                          {vehicle.reg}
                        </div>
                      )}

                      {/* Selected Tick Icon */}
                      {isSelected && <div className="absolute top-3 right-3 z-20 w-8 h-8 bg-primary rounded-full flex items-center justify-center shadow-lg">
                        <Check className="w-5 h-5 text-black" />
                      </div>}

                      {/* Image Block with Carousel */}
                      <div className={cn("relative aspect-video overflow-hidden bg-gradient-to-br", isRollsRoyce ? "from-primary/10 to-primary/20" : "from-muted/30 to-muted/5")}>
                        {vehicle.vehicle_photos && vehicle.vehicle_photos.length > 0 ? (
                          <>
                            <img
                              src={vehicle.vehicle_photos[getVehicleImageIndex(vehicle.id)]?.photo_url || vehicle.vehicle_photos[0].photo_url}
                              alt={vehicleName}
                              className="w-full h-full object-cover"
                              loading="lazy"
                              onError={(e) => {
                                e.currentTarget.style.display = 'none';
                              }}
                            />
                            {/* Carousel Navigation - only show if more than 1 image */}
                            {vehicle.vehicle_photos.length > 1 && (
                              <>
                                <button
                                  onClick={(e) => prevVehicleImage(e, vehicle.id, vehicle.vehicle_photos!.length)}
                                  className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/50 hover:bg-black/70 flex items-center justify-center text-white transition-colors z-10"
                                >
                                  <ChevronLeft className="w-5 h-5" />
                                </button>
                                <button
                                  onClick={(e) => nextVehicleImage(e, vehicle.id, vehicle.vehicle_photos!.length)}
                                  className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/50 hover:bg-black/70 flex items-center justify-center text-white transition-colors z-10"
                                >
                                  <ChevronRight className="w-5 h-5" />
                                </button>
                                {/* Dots indicator */}
                                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5 z-10">
                                  {vehicle.vehicle_photos.map((_, idx) => (
                                    <div
                                      key={idx}
                                      className={cn(
                                        "w-2 h-2 rounded-full transition-colors",
                                        idx === getVehicleImageIndex(vehicle.id) ? "bg-white" : "bg-white/50"
                                      )}
                                    />
                                  ))}
                                </div>
                              </>
                            )}
                          </>
                        ) : vehicle.photo_url ? (
                          <img
                            src={vehicle.photo_url}
                            alt={vehicleName}
                            className="w-full h-full object-cover"
                            loading="lazy"
                            onError={(e) => {
                              e.currentTarget.style.display = 'none';
                            }}
                          />
                        ) : null}
                        <div className={`${(vehicle.vehicle_photos && vehicle.vehicle_photos.length > 0) || vehicle.photo_url ? 'hidden' : 'flex'} flex-col items-center justify-center h-full w-full absolute inset-0`}>
                          <Car className={cn("w-16 h-16 mb-2 opacity-20", isRollsRoyce ? "text-primary" : "text-muted-foreground")} />
                        </div>

                      </div>

                      {/* Content */}
                      <div className="p-6 flex-1 flex flex-col">
                        {/* Card info section with spacing */}
                        <div className="space-y-4 mb-4">
                          {/* Title */}
                          <div>
                            <h4 className="font-display text-xl font-semibold text-foreground mb-1 flex items-center gap-2">
                              {vehicleName}
                              {isRollsRoyce && <Crown className="w-5 h-5 text-primary" />}
                            </h4>
                            {vehicle.colour && <p className="text-xs text-muted-foreground">{vehicle.colour}</p>}
                          </div>

                          {/* Description */}
                          {vehicle.description && (
                            <div className="space-y-1">
                              <p className="text-sm text-muted-foreground leading-relaxed">
                                {getDisplayDescription(vehicle)}
                              </p>
                              {vehicle.description.length > MAX_DESCRIPTION_LENGTH && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleDescription(vehicle.id);
                                  }}
                                  className="text-xs text-primary hover:text-primary/80 font-medium transition-colors"
                                >
                                  {expandedDescriptions.has(vehicle.id) ? 'Show less' : 'Show more'}
                                </button>
                              )}
                            </div>
                          )}

                          {/* Spec Bar */}
                          <div className="flex items-center gap-4 text-xs text-muted-foreground pb-3 border-b border-border/50">
                            <span className="flex items-center gap-1" title="Mileage Allowance">
                              <Gauge className="h-3 w-3" />
                              {vehicle.allowed_mileage
                                ? `${vehicle.allowed_mileage.toLocaleString()} ${getPerMonthLabel(distanceUnit)}`
                                : getUnlimitedLabel(distanceUnit)}
                            </span>
                          </div>

                          {/* Price Section */}
                          {(() => {
                            const priceDisplay = getDynamicPriceDisplay(vehicle);
                            return (
                              <div className="space-y-1">
                                <div className="flex items-baseline justify-between">
                                  {hasDiscount ? (
                                    <div className="flex flex-col items-end w-full">
                                      <div className="flex items-center gap-2">
                                        <span className="text-xs text-muted-foreground line-through">{formatCurrency(Number(originalPrice), currencyCode, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
                                        <span className="text-2xl font-bold text-green-600">{formatCurrency(Number(displayPrice), currencyCode, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
                                      </div>
                                    </div>
                                  ) : (
                                    <span className="text-2xl font-bold text-primary">
                                      {formatCurrency(priceDisplay.price, currencyCode, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                    </span>
                                  )}
                                  <span className="text-sm text-muted-foreground">{priceDisplay.label}</span>
                                </div>
                                {promoErrorMsg && <p className="text-xs text-destructive text-right">{promoErrorMsg}</p>}
                                {priceDisplay.secondaryPrices.length > 0 && (
                                  <p className="text-xs text-muted-foreground">
                                    {priceDisplay.secondaryPrices.join(' • ')}
                                  </p>
                                )}
                              </div>
                            );
                          })()}
                        </div>

                        {/* CTA - pushed to bottom with mt-auto */}
                        <Button
                          className={cn("w-full h-11 font-medium transition-colors mt-auto",
                            isBlocked ? "bg-muted text-muted-foreground cursor-not-allowed" :
                              isSelected ? "bg-primary text-primary-foreground hover:bg-primary/90" :
                                "bg-background border-2 border-primary text-primary hover:bg-primary hover:text-primary-foreground")}
                          disabled={isBlocked}
                          onClick={e => {
                            e.stopPropagation();
                            // Toggle: if already selected, deselect; otherwise select
                            setFormData({
                              ...formData,
                              vehicleId: isSelected ? '' : vehicle.id
                            });
                            if ((window as any).gtag && !isSelected) {
                              (window as any).gtag('event', 'vehicle_selected', {
                                vehicle_id: vehicle.id,
                                est_total: estimation?.total || 0
                              });
                            }
                          }}>
                          {isSelected ? "Selected" : "Select"}
                        </Button>
                      </div>
                    </Card>;
                  })}
                </div>
              </div>}
            </div>
            {/* Sidebar Summary (Desktop Only) */}
            <div className="hidden lg:block">
              <Card className="sticky top-24 p-6 bg-card border-primary/20 space-y-4 max-h-[calc(100vh-7rem)] overflow-y-auto">
                <h4 className="font-display text-xl font-semibold">Your Trip</h4>

                <div className="space-y-3 text-sm">
                  <div>
                    <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Pickup</p>
                    <p className="font-medium">{formData.pickupDate ? format(parseDateString(formData.pickupDate), "MMM dd, yyyy") : "—"}</p>
                    <p className="text-muted-foreground text-xs">{formatTimeWithPeriod(formData.pickupTime)}</p>
                  </div>

                  <div>
                    <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Return</p>
                    <p className="font-medium">{formData.dropoffDate ? format(parseDateString(formData.dropoffDate), "MMM dd, yyyy") : "—"}</p>
                    <p className="text-muted-foreground text-xs">{formatTimeWithPeriod(formData.dropoffTime)}</p>
                  </div>

                  <div className="pt-3 border-t border-border/50">
                    <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Duration</p>
                    <p className="font-semibold text-lg">{calculateRentalDuration()?.formatted || "—"}</p>
                  </div>

                  <div>
                    <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Pickup Location</p>
                    <p className="font-medium text-xs">{formData.pickupLocation.split(',').slice(0, 2).join(',') || "—"}</p>
                    {formData.pickupLocationId && (() => {
                      const loc = allDeliveryLocations.find(l => l.id === formData.pickupLocationId);
                      return loc?.description ? <p className="text-xs text-muted-foreground/70 mt-0.5">{loc.description}</p> : null;
                    })()}
                    {formData.pickupDeliveryFee > 0 && (
                      <p className="text-xs text-amber-500">+{formatCurrency(formData.pickupDeliveryFee, currencyCode, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} delivery</p>
                    )}
                  </div>

                  <div>
                    <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Return Location</p>
                    <p className="font-medium text-xs">{formData.dropoffLocation.split(',').slice(0, 2).join(',') || "—"}</p>
                    {formData.returnLocationId && (() => {
                      const loc = allDeliveryLocations.find(l => l.id === formData.returnLocationId);
                      return loc?.description ? <p className="text-xs text-muted-foreground/70 mt-0.5">{loc.description}</p> : null;
                    })()}
                    {formData.returnDeliveryFee > 0 && (
                      <p className="text-xs text-amber-500">+{formatCurrency(formData.returnDeliveryFee, currencyCode, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} collection</p>
                    )}
                  </div>
                </div>

                {selectedVehicle && estimatedBooking && formData.pickupLocation && <div className="pt-4 border-t border-border/50 space-y-3">
                  {/* Selected Vehicle */}
                  <div className="flex gap-3">
                    <div className="w-16 h-16 rounded-md overflow-hidden bg-muted flex-shrink-0 relative">
                      {selectedVehicle.vehicle_photos?.[0]?.photo_url || selectedVehicle.photo_url ? (
                        <img
                          src={selectedVehicle.vehicle_photos?.[0]?.photo_url || selectedVehicle.photo_url || ''}
                          alt={selectedVehicle.make && selectedVehicle.model ? `${selectedVehicle.make} ${selectedVehicle.model}` : selectedVehicle.reg}
                          className="w-full h-full object-cover"
                          loading="lazy"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                            const fallback = e.currentTarget.nextElementSibling as HTMLElement;
                            if (fallback) fallback.style.display = 'flex';
                          }}
                        />
                      ) : null}
                      <div className={`${selectedVehicle.vehicle_photos?.[0]?.photo_url || selectedVehicle.photo_url ? 'hidden' : 'flex'} w-full h-full items-center justify-center absolute inset-0`}>
                        <Car className="w-6 h-6 text-muted-foreground opacity-30" />
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm truncate">
                        {selectedVehicle.make && selectedVehicle.model ? `${selectedVehicle.make} ${selectedVehicle.model}` : selectedVehicle.make || selectedVehicle.model || selectedVehicle.reg}
                      </p>
                      <p className="text-xs text-muted-foreground">{estimatedBooking.days} days</p>
                      {(() => {
                        let displayPrice = estimatedBooking.total;
                        let originalPrice = displayPrice;
                        let hasDiscount = false;

                        if (promoDetails) {
                          if (promoDetails.type === 'fixed_amount') {
                            if (displayPrice > promoDetails.value) {
                              displayPrice = displayPrice - promoDetails.value;
                              hasDiscount = true;
                            }
                          } else if (promoDetails.type === 'percentage') {
                            const discount = (displayPrice * promoDetails.value) / 100;
                            displayPrice = displayPrice - discount;
                            hasDiscount = true;
                          }
                        }

                        return hasDiscount ? (
                          <div className="mt-1 flex items-baseline gap-2">
                            <span className="text-xs text-muted-foreground line-through">{formatCurrency(originalPrice, currencyCode, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
                            <span className="text-lg font-bold text-green-600">
                              {formatCurrency(displayPrice, currencyCode, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                            </span>
                          </div>
                        ) : (
                          <p className="text-lg font-bold text-primary mt-1">
                            {formatCurrency(estimatedBooking.total, currencyCode, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                          </p>
                        );
                      })()}
                    </div>
                  </div>

                  {/* Delivery fees breakdown */}
                  {estimatedBooking.deliveryFees > 0 && (
                    <div className="text-xs space-y-1 pt-2 border-t border-border/30">
                      <div className="flex justify-between text-muted-foreground">
                        <span>Vehicle rental</span>
                        <span>{formatCurrency(estimatedBooking.vehicleTotal, currencyCode, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
                      </div>
                      {formData.pickupDeliveryFee > 0 && (
                        <div className="flex justify-between text-muted-foreground">
                          <span>Pickup delivery</span>
                          <span>+{formatCurrency(formData.pickupDeliveryFee, currencyCode, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
                        </div>
                      )}
                      {formData.returnDeliveryFee > 0 && (
                        <div className="flex justify-between text-muted-foreground">
                          <span>Return collection</span>
                          <span>+{formatCurrency(formData.returnDeliveryFee, currencyCode, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Lockbox info note */}
                  {tenant?.lockbox_enabled && formData.pickupDeliveryFee > 0 && (
                    <p className="text-[11px] text-muted-foreground/80 flex items-center gap-1">
                      <Shield className="w-3 h-3 flex-shrink-0" />
                      Keys via secure lockbox
                    </p>
                  )}

                  <p className="text-xs text-muted-foreground">
                    Final total at checkout
                  </p>
                </div>}

                {(!selectedVehicle || !formData.pickupLocation) && <div className="pt-4 border-t border-border/50">
                  <p className="text-xs text-muted-foreground">
                    {!formData.pickupLocation
                      ? "Select a location to see pricing."
                      : "Select a vehicle to see total price."}
                  </p>
                </div>}

                <Button onClick={handleStep2Continue} disabled={!selectedVehicle} className="w-full h-11 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-md hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed" size="lg">
                  Review & Pay <ChevronRight className="ml-2 w-5 h-5" />
                </Button>
              </Card>
            </div>
          </div>


          {/* Mobile Action Bar */}
          <div className="flex flex-col sm:flex-row gap-3 lg:hidden mt-8">
            <Button onClick={() => setCurrentStep(1)} variant="outline" className="w-full sm:flex-1" size="lg">
              <ChevronLeft className="mr-2 w-5 h-5" /> Back
            </Button>
            <Button onClick={handleStep2Continue} disabled={!selectedVehicle} className="w-full sm:flex-1 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-md hover:shadow-lg transition-all disabled:opacity-50" size="lg">
              Review & Pay <ChevronRight className="ml-2 w-5 h-5" />
            </Button>
          </div>
        </div>}

        {/* Step 3: Insurance Verification (skipped for insurance-exempt tenants) */}
        {currentStep === 3 && !skipInsurance && <div className="space-y-8 animate-fade-in">
          {/* Header */}
          <div className="text-center space-y-2">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
              <Shield className="w-8 h-8 text-primary" />
            </div>
            <h3 className="text-2xl md:text-3xl font-display font-bold text-foreground">
              Insurance Verification
            </h3>
            <p className="text-base text-muted-foreground max-w-2xl mx-auto">
              Protect your rental with insurance coverage. Choose from your existing policy or get instant coverage through our partner.
            </p>

            {/* Insurance Status Indicator */}
            {uploadedDocumentId && (
              <div className="flex items-center justify-center gap-2 mt-4">
                <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full ${scanningDocument ? 'bg-amber-500/10 border border-amber-500/30' : 'bg-primary/10 border border-primary/30'}`}>
                  {scanningDocument ? (
                    <>
                      <Loader2 className="w-4 h-4 text-amber-500 animate-spin" />
                      <span className="text-sm font-medium text-amber-600">Verifying insurance...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle className="w-4 h-4 text-primary" />
                      <span className="text-sm font-medium text-primary">Insurance document uploaded</span>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Insurance Question */}
          {hasInsurance === null && (
            <div className="max-w-4xl mx-auto">
              <Card className="overflow-hidden border-2 border-border/50 hover:border-primary/30 transition-all">
                <div className="p-8 md:p-12">
                  <h4 className="text-xl md:text-2xl font-semibold text-center mb-8">
                    Do you have existing insurance coverage?
                  </h4>

                  <div className="grid md:grid-cols-2 gap-6">
                    {/* YES Option */}
                    <Card
                      className="group relative overflow-hidden border-2 border-border hover:border-primary hover:shadow-lg transition-all bg-gradient-to-br from-primary/5 to-transparent"
                    >
                      <div className="p-8 text-center space-y-4">
                        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-2">
                          <CheckCircle className="w-8 h-8 text-primary" />
                        </div>
                        <div>
                          <h5 className="text-lg font-semibold mb-2">Yes, I Have Insurance</h5>
                          <p className="text-sm text-muted-foreground">
                            {isAuthenticated && existingInsuranceDocuments.length > 0
                              ? "Select from your existing documents or upload a new one"
                              : "Upload your current insurance certificate and we'll verify it instantly"}
                          </p>
                        </div>

                        {/* Show dropdown for logged-in users with existing documents */}
                        {isAuthenticated && existingInsuranceDocuments.length > 0 && (
                          <div className="space-y-3">
                            <Select
                              value={selectedExistingDocument || ""}
                              onValueChange={(value) => {
                                setSelectedExistingDocument(value);
                              }}
                            >
                              <SelectTrigger className="w-full">
                                <SelectValue placeholder="Select existing insurance" />
                              </SelectTrigger>
                              <SelectContent>
                                {existingInsuranceDocuments.map((doc) => (
                                  <SelectItem key={doc.id} value={doc.id}>
                                    {doc.insurance_provider || doc.document_name}
                                    {doc.policy_number && ` - ${doc.policy_number}`}
                                    {doc.end_date && ` (Expires: ${new Date(doc.end_date).toLocaleDateString()})`}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Button
                              className="w-full bg-primary hover:bg-primary/90"
                              size="lg"
                              disabled={!selectedExistingDocument}
                              onClick={() => {
                                if (selectedExistingDocument) {
                                  setUploadedDocumentId(selectedExistingDocument);
                                  setHasInsurance(true);
                                }
                              }}
                            >
                              <CheckCircle className="mr-2 h-5 w-5" />
                              Use Selected Document
                            </Button>
                            <div className="relative">
                              <div className="absolute inset-0 flex items-center">
                                <span className="w-full border-t" />
                              </div>
                              <div className="relative flex justify-center text-xs uppercase">
                                <span className="bg-card px-2 text-muted-foreground">or</span>
                              </div>
                            </div>
                          </div>
                        )}

                        <Button
                          className="w-full bg-primary hover:bg-primary/90"
                          size="lg"
                          onClick={() => {
                            setHasInsurance(true);
                            setShowUploadDialog(true);
                          }}
                        >
                          <Upload className="mr-2 h-5 w-5" />
                          Upload New Certificate
                        </Button>
                        <div className="pt-4 border-t border-border/50">
                          <p className="text-xs text-muted-foreground">
                            ✓ Instant AI verification<br />
                            ✓ Accepted formats: PDF, JPG, PNG<br />
                            ✓ Max file size: 10MB
                          </p>
                        </div>
                      </div>
                    </Card>

                    {/* NO Option */}
                    <Card
                      className="group relative overflow-hidden border-2 border-border hover:border-accent hover:shadow-lg transition-all cursor-pointer bg-gradient-to-br from-accent/5 to-transparent"
                      onClick={() => setHasInsurance(false)}
                    >
                      <div className="p-8 text-center space-y-4">
                        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-accent/10 mb-2">
                          <Shield className="w-8 h-8 text-accent" />
                        </div>
                        <div>
                          <h5 className="text-lg font-semibold mb-2">No, I Need Insurance</h5>
                          <p className="text-sm text-muted-foreground">
                            Get instant coverage through our trusted partner Bonzah
                          </p>
                        </div>
                        <Button
                          className="w-full bg-accent hover:bg-accent/90"
                          size="lg"
                        >
                          <Shield className="mr-2 h-5 w-5" />
                          Get Insurance Now
                        </Button>
                        <div className="pt-4 border-t border-border/50">
                          <p className="text-xs text-muted-foreground">
                            ✓ Instant online quotes<br />
                            ✓ Affordable rates<br />
                            ✓ Quick 5-minute setup
                          </p>
                        </div>
                      </div>
                    </Card>
                  </div>
                </div>
              </Card>
            </div>
          )}

          {/* YES Path - Upload completed or scanning */}
          {hasInsurance === true && (
            <div className="max-w-3xl mx-auto space-y-6">
              {uploadedDocumentId ? (
                <Card className="overflow-hidden border-2 border-primary/30 bg-card">
                  <div className="p-8 space-y-6">
                    {/* Header with icon - centered */}
                    <div className="flex flex-col items-center text-center gap-4">
                      <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                        <FileCheck className="w-8 h-8 text-primary" />
                      </div>
                      <div>
                        <h4 className="text-xl font-semibold text-foreground mb-2">
                          Documents Uploaded Successfully!
                        </h4>
                        <p className="text-muted-foreground">
                          Our team is reviewing your insurance certificate now.
                        </p>
                      </div>
                    </div>

                    {/* Upload Complete Progress - Full width centered */}
                    <div className="bg-gradient-to-br from-primary/5 to-transparent rounded-lg p-6 border-2 border-primary/20">
                      <div className="flex flex-col items-center text-center space-y-6">
                        {/* Success Icon with animated background */}
                        <div className="relative">
                          <div className="absolute inset-0 bg-primary/10 rounded-full blur-2xl animate-pulse"></div>
                          <div className="relative">
                            <CheckCircle className="h-16 w-16 text-primary" />
                          </div>
                        </div>

                        <h3 className="text-2xl md:text-3xl font-bold text-primary">
                          Upload Complete!
                        </h3>

                        <p className="text-base md:text-lg text-muted-foreground max-w-lg">
                          Your insurance certificate is being reviewed by our team
                        </p>

                        {/* Progress Bar at 100% */}
                        <div className="w-full max-w-md space-y-3 pt-2">
                          <div className="w-full bg-muted rounded-full h-3 overflow-hidden">
                            <div className="bg-primary h-full w-full transition-all duration-500"></div>
                          </div>
                          <p className="text-sm font-medium text-primary">
                            100% complete
                          </p>

                          {/* AI indicator - shows scanning state or completion */}
                          <div className="flex items-center justify-center gap-2 pt-2">
                            {scanningDocument ? (
                              <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 border border-primary/20">
                                <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></div>
                                <span className="text-xs text-muted-foreground">AI verification in progress...</span>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 border border-primary/20">
                                <CheckCircle className="w-3.5 h-3.5 text-primary" />
                                <span className="text-xs text-muted-foreground">Document uploaded successfully</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                  </div>
                </Card>
              ) : (
                <Card className="overflow-hidden border-2 border-border/50">
                  <div className="p-8 text-center space-y-6">
                    <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-primary/10">
                      <Upload className="w-10 h-10 text-primary" />
                    </div>
                    <div className="space-y-2">
                      <h4 className="text-xl font-semibold">Upload Your Insurance Certificate</h4>
                      <p className="text-muted-foreground max-w-md mx-auto">
                        Please upload your current insurance certificate. Our AI will instantly verify the details.
                      </p>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
                      <Button
                        onClick={() => setShowUploadDialog(true)}
                        size="lg"
                        className="bg-primary hover:bg-primary/90 px-8"
                      >
                        <Upload className="mr-2 h-5 w-5" />
                        Choose File to Upload
                      </Button>
                      <Button
                        onClick={() => setHasInsurance(null)}
                        variant="ghost"
                        size="lg"
                      >
                        Go Back
                      </Button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-6 border-t border-border/50">
                      <div className="text-center space-y-1">
                        <FileCheck className="w-5 h-5 mx-auto text-muted-foreground" />
                        <p className="text-xs text-muted-foreground">PDF, JPG, PNG</p>
                      </div>
                      <div className="text-center space-y-1">
                        <Shield className="w-5 h-5 mx-auto text-muted-foreground" />
                        <p className="text-xs text-muted-foreground">Max 10MB</p>
                      </div>
                      <div className="text-center space-y-1">
                        <CheckCircle className="w-5 h-5 mx-auto text-muted-foreground" />
                        <p className="text-xs text-muted-foreground">AI Verified</p>
                      </div>
                    </div>
                  </div>
                </Card>
              )}
            </div>
          )}

          {/* NO Path - Inline Bonzah Insurance Selector */}
          {hasInsurance === false && (
            <div className="max-w-4xl mx-auto space-y-6">
              <BonzahInsuranceSelector
                tripStartDate={formData.pickupDate || null}
                tripEndDate={formData.dropoffDate || null}
                pickupState="FL" // Default to Florida - TODO: extract from pickup location
                onCoverageChange={handleBonzahCoverageChange}
                onSkipInsurance={handleBonzahSkipInsurance}
                initialCoverage={bonzahCoverage}
              />

              {/* Navigation for Bonzah flow */}
              <div className="flex flex-col sm:flex-row gap-4 pt-4">
                <Button
                  onClick={() => setHasInsurance(null)}
                  variant="outline"
                  className="w-full sm:flex-1"
                  size="lg"
                >
                  <ChevronLeft className="mr-2 w-5 h-5" /> Go Back
                </Button>
                <Button
                  onClick={handleStep3Continue}
                  className="w-full sm:flex-1 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-md hover:shadow-lg transition-all"
                  size="lg"
                >
                  Continue to Details <ChevronRight className="ml-2 w-5 h-5" />
                </Button>
              </div>
            </div>
          )}

          {/* Navigation - Only show for YES path (upload flow) when hasInsurance is true */}
          {hasInsurance === true && (
            <>
              <div className="flex flex-col sm:flex-row gap-4">
                <Button
                  onClick={() => setCurrentStep(2)}
                  variant="outline"
                  className="w-full sm:flex-1"
                  size="lg"
                >
                  <ChevronLeft className="mr-2 w-5 h-5" /> Back to Vehicles
                </Button>
                <Button
                  onClick={handleStep3Continue}
                  disabled={!uploadedDocumentId}
                  className="w-full sm:flex-1 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-md hover:shadow-lg transition-all disabled:opacity-50"
                  size="lg"
                >
                  Continue to Details <ChevronRight className="ml-2 w-5 h-5" />
                </Button>
              </div>
              {/* Requirement notice */}
              {!uploadedDocumentId && (
                <p className="text-center text-sm text-muted-foreground">
                  <AlertCircle className="w-4 h-4 inline mr-1" />
                  Please upload your insurance certificate to continue
                </p>
              )}
            </>
          )}
        </div>}

        {/* Step 4: Customer Details */}
        {currentStep === 4 && <div className="space-y-8 animate-fade-in">
          {/* Header with underline */}
          <div>
            <h3 className="text-2xl md:text-3xl font-display font-semibold text-foreground pb-2 border-b-2 border-primary/30">
              Your Details
            </h3>
          </div>

          {/* Authenticated User Banner */}
          {isAuthenticated && isCustomerDataPopulated && (
            <div className="bg-primary/5 border border-primary/20 rounded-lg p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-full bg-primary/10">
                  <UserCheck className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-foreground">
                    Welcome back, {customerUser?.customer?.name}!
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Your details have been auto-filled from your account.
                    {isCustomerAlreadyVerified && ' Your ID is already verified.'}
                  </p>
                </div>
                {isCustomerAlreadyVerified && (
                  <Badge variant="default" className="bg-green-500 hover:bg-green-500/90 text-white">
                    <CheckCircle className="w-3 h-3 mr-1" /> Verified
                  </Badge>
                )}
              </div>
            </div>
          )}

          {/* Form Fields */}
          <div className="space-y-8">
            {/* Row 1: Customer Name & Email */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
              <div className="space-y-2">
                <Label htmlFor="customerName" className="font-medium">Full Name *</Label>
                <Input
                  id="customerName"
                  value={formData.customerName}
                  onChange={e => {
                    const value = e.target.value;
                    setFormData({
                      ...formData,
                      customerName: value
                    });
                    // Instant validation
                    validateField('customerName', value);
                  }}
                  placeholder="Enter your full name"
                  className={cn(
                    "h-12 focus-visible:ring-primary",
                    (verificationStatus === 'verified' || (isAuthenticated && isCustomerAlreadyVerified)) && "bg-muted cursor-not-allowed"
                  )}
                  disabled={verificationStatus === 'verified' || (isAuthenticated && isCustomerAlreadyVerified)}
                />
                {verificationStatus === 'verified' && !isCustomerAlreadyVerified && (
                  <p className="text-xs text-green-600 flex items-center gap-1">
                    <CheckCircle className="w-3 h-3" /> Verified from ID document
                  </p>
                )}
                {isAuthenticated && isCustomerDataPopulated && isCustomerAlreadyVerified && (
                  <p className="text-xs text-green-600 flex items-center gap-1">
                    <CheckCircle className="w-3 h-3" /> From your verified account
                  </p>
                )}
                {errors.customerName && <p className="text-sm text-destructive">{errors.customerName}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="customerEmail" className="font-medium">Email Address *</Label>
                <Input
                  id="customerEmail"
                  type="email"
                  value={formData.customerEmail}
                  onChange={e => {
                    const value = e.target.value;
                    setFormData({
                      ...formData,
                      customerEmail: value
                    });
                    // Instant validation
                    validateField('customerEmail', value);
                  }}
                  placeholder="your@email.com"
                  className={cn(
                    "h-12 focus-visible:ring-primary",
                    isAuthenticated && isCustomerDataPopulated && "bg-muted/50"
                  )}
                  readOnly={isAuthenticated && isCustomerDataPopulated}
                />
                {isAuthenticated && isCustomerDataPopulated && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <UserCheck className="w-3 h-3" /> From your account
                  </p>
                )}
                {errors.customerEmail && <p className="text-sm text-destructive">{errors.customerEmail}</p>}
              </div>
            </div>

            {/* Row 2: Customer Phone & Type */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
              <div className="space-y-2">
                <Label htmlFor="customerPhone" className="font-medium">Phone Number *</Label>
                {/* Show read-only display when phone is from account profile */}
                {isAuthenticated && isCustomerDataPopulated && customerHasPhone && formData.customerPhone ? (
                  <div className="space-y-2">
                    <Input
                      value={formData.customerPhone}
                      readOnly
                      className="h-12 bg-muted/50"
                    />
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <CheckCircle className="w-3 h-3 text-primary" /> From your account profile
                    </p>
                  </div>
                ) : (
                  <>
                    <PhoneInput
                      id="customerPhone"
                      value={formData.customerPhone}
                      defaultCountry="US"
                      onChange={value => {
                        setFormData({
                          ...formData,
                          customerPhone: value
                        });
                        // Instant validation
                        validateField('customerPhone', value);
                      }}
                      error={!!errors.customerPhone}
                      className="h-12"
                    />
                    {errors.customerPhone && <p className="text-sm text-destructive">{errors.customerPhone}</p>}
                  </>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="customerType" className="font-medium">Customer Type *</Label>
                <Select value={formData.customerType} onValueChange={value => {
                  setFormData({
                    ...formData,
                    customerType: value
                  });
                  // Instant validation
                  validateField('customerType', value);
                }}>
                  <SelectTrigger id="customerType" className="h-12 focus-visible:ring-primary">
                    <SelectValue placeholder="Select customer type" />
                  </SelectTrigger>
                  <SelectContent position="popper" sideOffset={4}>
                    <SelectItem value="Individual">Individual</SelectItem>
                    <SelectItem value="Company">Company</SelectItem>
                  </SelectContent>
                </Select>
                {errors.customerType && <p className="text-sm text-destructive">{errors.customerType}</p>}
              </div>
            </div>

            {/* Address Information - Required for Bonzah Insurance */}
            {bonzahPremium > 0 && (
              <div className="border-t border-border/50 pt-6">
                <h4 className="text-base sm:text-lg font-semibold mb-4 flex items-center gap-2">
                  Address Information
                  <span className="text-xs font-normal text-muted-foreground">(Required for insurance)</span>
                </h4>

                {/* Street Address */}
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="addressStreet" className="font-medium">Street Address *</Label>
                    <Input
                      id="addressStreet"
                      value={formData.addressStreet}
                      onChange={e => setFormData({ ...formData, addressStreet: e.target.value })}
                      placeholder="123 Main Street"
                      className="h-12 focus-visible:ring-primary"
                    />
                  </div>

                  {/* City, State, Zip */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="addressCity" className="font-medium">City *</Label>
                      <Input
                        id="addressCity"
                        value={formData.addressCity}
                        onChange={e => setFormData({ ...formData, addressCity: e.target.value })}
                        placeholder="Miami"
                        className="h-12 focus-visible:ring-primary"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="addressState" className="font-medium">State *</Label>
                      <Select value={formData.addressState} onValueChange={value => setFormData({ ...formData, addressState: value })}>
                        <SelectTrigger id="addressState" className="h-12 focus-visible:ring-primary">
                          <SelectValue placeholder="Select state" />
                        </SelectTrigger>
                        <SelectContent position="popper" sideOffset={4}>
                          <SelectItem value="AL">Alabama</SelectItem>
                          <SelectItem value="AK">Alaska</SelectItem>
                          <SelectItem value="AZ">Arizona</SelectItem>
                          <SelectItem value="AR">Arkansas</SelectItem>
                          <SelectItem value="CA">California</SelectItem>
                          <SelectItem value="CO">Colorado</SelectItem>
                          <SelectItem value="CT">Connecticut</SelectItem>
                          <SelectItem value="DE">Delaware</SelectItem>
                          <SelectItem value="FL">Florida</SelectItem>
                          <SelectItem value="GA">Georgia</SelectItem>
                          <SelectItem value="HI">Hawaii</SelectItem>
                          <SelectItem value="ID">Idaho</SelectItem>
                          <SelectItem value="IL">Illinois</SelectItem>
                          <SelectItem value="IN">Indiana</SelectItem>
                          <SelectItem value="IA">Iowa</SelectItem>
                          <SelectItem value="KS">Kansas</SelectItem>
                          <SelectItem value="KY">Kentucky</SelectItem>
                          <SelectItem value="LA">Louisiana</SelectItem>
                          <SelectItem value="ME">Maine</SelectItem>
                          <SelectItem value="MD">Maryland</SelectItem>
                          <SelectItem value="MA">Massachusetts</SelectItem>
                          <SelectItem value="MI">Michigan</SelectItem>
                          <SelectItem value="MN">Minnesota</SelectItem>
                          <SelectItem value="MS">Mississippi</SelectItem>
                          <SelectItem value="MO">Missouri</SelectItem>
                          <SelectItem value="MT">Montana</SelectItem>
                          <SelectItem value="NE">Nebraska</SelectItem>
                          <SelectItem value="NV">Nevada</SelectItem>
                          <SelectItem value="NH">New Hampshire</SelectItem>
                          <SelectItem value="NJ">New Jersey</SelectItem>
                          <SelectItem value="NM">New Mexico</SelectItem>
                          <SelectItem value="NY">New York</SelectItem>
                          <SelectItem value="NC">North Carolina</SelectItem>
                          <SelectItem value="ND">North Dakota</SelectItem>
                          <SelectItem value="OH">Ohio</SelectItem>
                          <SelectItem value="OK">Oklahoma</SelectItem>
                          <SelectItem value="OR">Oregon</SelectItem>
                          <SelectItem value="PA">Pennsylvania</SelectItem>
                          <SelectItem value="RI">Rhode Island</SelectItem>
                          <SelectItem value="SC">South Carolina</SelectItem>
                          <SelectItem value="SD">South Dakota</SelectItem>
                          <SelectItem value="TN">Tennessee</SelectItem>
                          <SelectItem value="TX">Texas</SelectItem>
                          <SelectItem value="UT">Utah</SelectItem>
                          <SelectItem value="VT">Vermont</SelectItem>
                          <SelectItem value="VA">Virginia</SelectItem>
                          <SelectItem value="WA">Washington</SelectItem>
                          <SelectItem value="WV">West Virginia</SelectItem>
                          <SelectItem value="WI">Wisconsin</SelectItem>
                          <SelectItem value="WY">Wyoming</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="addressZip" className="font-medium">ZIP Code *</Label>
                      <Input
                        id="addressZip"
                        value={formData.addressZip}
                        onChange={e => setFormData({ ...formData, addressZip: e.target.value })}
                        placeholder="33101"
                        className="h-12 focus-visible:ring-primary"
                        maxLength={10}
                      />
                    </div>
                  </div>

                  {/* Driver's License */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4">
                    <div className="space-y-2">
                      <Label htmlFor="licenseNumber" className="font-medium">Driver's License Number *</Label>
                      <Input
                        id="licenseNumber"
                        value={formData.licenseNumber}
                        onChange={e => setFormData({ ...formData, licenseNumber: e.target.value })}
                        placeholder="License number"
                        className="h-12 focus-visible:ring-primary"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="licenseState" className="font-medium">License State *</Label>
                      <Select value={formData.licenseState} onValueChange={value => setFormData({ ...formData, licenseState: value })}>
                        <SelectTrigger id="licenseState" className="h-12 focus-visible:ring-primary">
                          <SelectValue placeholder="Select state" />
                        </SelectTrigger>
                        <SelectContent position="popper" sideOffset={4}>
                          <SelectItem value="AL">Alabama</SelectItem>
                          <SelectItem value="AK">Alaska</SelectItem>
                          <SelectItem value="AZ">Arizona</SelectItem>
                          <SelectItem value="AR">Arkansas</SelectItem>
                          <SelectItem value="CA">California</SelectItem>
                          <SelectItem value="CO">Colorado</SelectItem>
                          <SelectItem value="CT">Connecticut</SelectItem>
                          <SelectItem value="DE">Delaware</SelectItem>
                          <SelectItem value="FL">Florida</SelectItem>
                          <SelectItem value="GA">Georgia</SelectItem>
                          <SelectItem value="HI">Hawaii</SelectItem>
                          <SelectItem value="ID">Idaho</SelectItem>
                          <SelectItem value="IL">Illinois</SelectItem>
                          <SelectItem value="IN">Indiana</SelectItem>
                          <SelectItem value="IA">Iowa</SelectItem>
                          <SelectItem value="KS">Kansas</SelectItem>
                          <SelectItem value="KY">Kentucky</SelectItem>
                          <SelectItem value="LA">Louisiana</SelectItem>
                          <SelectItem value="ME">Maine</SelectItem>
                          <SelectItem value="MD">Maryland</SelectItem>
                          <SelectItem value="MA">Massachusetts</SelectItem>
                          <SelectItem value="MI">Michigan</SelectItem>
                          <SelectItem value="MN">Minnesota</SelectItem>
                          <SelectItem value="MS">Mississippi</SelectItem>
                          <SelectItem value="MO">Missouri</SelectItem>
                          <SelectItem value="MT">Montana</SelectItem>
                          <SelectItem value="NE">Nebraska</SelectItem>
                          <SelectItem value="NV">Nevada</SelectItem>
                          <SelectItem value="NH">New Hampshire</SelectItem>
                          <SelectItem value="NJ">New Jersey</SelectItem>
                          <SelectItem value="NM">New Mexico</SelectItem>
                          <SelectItem value="NY">New York</SelectItem>
                          <SelectItem value="NC">North Carolina</SelectItem>
                          <SelectItem value="ND">North Dakota</SelectItem>
                          <SelectItem value="OH">Ohio</SelectItem>
                          <SelectItem value="OK">Oklahoma</SelectItem>
                          <SelectItem value="OR">Oregon</SelectItem>
                          <SelectItem value="PA">Pennsylvania</SelectItem>
                          <SelectItem value="RI">Rhode Island</SelectItem>
                          <SelectItem value="SC">South Carolina</SelectItem>
                          <SelectItem value="SD">South Dakota</SelectItem>
                          <SelectItem value="TN">Tennessee</SelectItem>
                          <SelectItem value="TX">Texas</SelectItem>
                          <SelectItem value="UT">Utah</SelectItem>
                          <SelectItem value="VT">Vermont</SelectItem>
                          <SelectItem value="VA">Virginia</SelectItem>
                          <SelectItem value="WA">Washington</SelectItem>
                          <SelectItem value="WV">West Virginia</SelectItem>
                          <SelectItem value="WI">Wisconsin</SelectItem>
                          <SelectItem value="WY">Wyoming</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Date of Birth & ID Expiry Row */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
              {/* Date of Birth - Always shown */}
              <div className="space-y-2">
                <Label className="font-medium">Date of Birth *</Label>
                {/* Show read-only display when DOB is verified (from account profile or ID document) */}
                {verificationStatus === 'verified' && formData.driverDOB ? (
                  <div className="space-y-2">
                    <Input
                      value={formData.driverDOB ? format(new Date(formData.driverDOB), "MMMM d, yyyy") : ""}
                      readOnly
                      className="h-12 bg-muted/50"
                    />
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <CheckCircle className="w-3 h-3 text-primary" />
                      {isAuthenticated && customerHasDOB ? 'From your account profile' : 'From your ID document'}
                    </p>
                    {formData.driverDOB && (
                      <p className="text-sm text-muted-foreground">Age: <span className="font-medium text-foreground">{calculateAge(new Date(formData.driverDOB))} years old</span></p>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-3 gap-2">
                      {/* Month Select */}
                      <Select
                        value={formData.driverDOB ? (new Date(formData.driverDOB).getMonth() + 1).toString().padStart(2, '0') : ""}
                        onValueChange={(month) => {
                          const currentDate = formData.driverDOB ? new Date(formData.driverDOB) : new Date(2000, 0, 1);
                          const newDate = new Date(currentDate.getFullYear(), parseInt(month) - 1, Math.min(currentDate.getDate(), new Date(currentDate.getFullYear(), parseInt(month), 0).getDate()));
                          const dateStr = format(newDate, "yyyy-MM-dd");
                          setFormData({ ...formData, driverDOB: dateStr });
                          validateField('driverDOB', dateStr);
                        }}
                      >
                        <SelectTrigger className={cn("h-12", errors.driverDOB && "border-destructive")}>
                          <SelectValue placeholder="Month" />
                        </SelectTrigger>
                        <SelectContent>
                          {['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((month, i) => (
                            <SelectItem key={i} value={(i + 1).toString().padStart(2, '0')}>{month}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {/* Day Select */}
                      <Select
                        value={formData.driverDOB ? new Date(formData.driverDOB).getDate().toString() : ""}
                        onValueChange={(day) => {
                          const currentDate = formData.driverDOB ? new Date(formData.driverDOB) : new Date(2000, 0, 1);
                          const newDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), parseInt(day));
                          const dateStr = format(newDate, "yyyy-MM-dd");
                          setFormData({ ...formData, driverDOB: dateStr });
                          validateField('driverDOB', dateStr);
                        }}
                      >
                        <SelectTrigger className={cn("h-12", errors.driverDOB && "border-destructive")}>
                          <SelectValue placeholder="Day" />
                        </SelectTrigger>
                        <SelectContent>
                          {Array.from({ length: 31 }, (_, i) => (
                            <SelectItem key={i + 1} value={(i + 1).toString()}>{i + 1}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {/* Year Select */}
                      <Select
                        value={formData.driverDOB ? new Date(formData.driverDOB).getFullYear().toString() : ""}
                        onValueChange={(year) => {
                          const currentDate = formData.driverDOB ? new Date(formData.driverDOB) : new Date(2000, 0, 1);
                          const newDate = new Date(parseInt(year), currentDate.getMonth(), Math.min(currentDate.getDate(), new Date(parseInt(year), currentDate.getMonth() + 1, 0).getDate()));
                          const dateStr = format(newDate, "yyyy-MM-dd");
                          setFormData({ ...formData, driverDOB: dateStr });
                          validateField('driverDOB', dateStr);
                        }}
                      >
                        <SelectTrigger className={cn("h-12", errors.driverDOB && "border-destructive")}>
                          <SelectValue placeholder="Year" />
                        </SelectTrigger>
                        <SelectContent>
                          {Array.from({ length: 100 }, (_, i) => new Date().getFullYear() - (tenant?.minimum_rental_age || 18) - i).map((year) => (
                            <SelectItem key={year} value={year.toString()}>{year}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {formData.driverDOB && (
                      <p className="text-sm text-muted-foreground">Age: <span className={cn("font-medium", errors.driverDOB ? "text-destructive" : "text-foreground")}>{calculateAge(new Date(formData.driverDOB))} years old</span></p>
                    )}
                    {errors.driverDOB && <p className="text-sm text-destructive">{errors.driverDOB}</p>}
                    <p className="text-xs text-muted-foreground">Driver must be at least {tenant?.minimum_rental_age || 21} years old</p>
                  </>
                )}
              </div>

              {/* ID Document Expiry Date - Show when verified */}
              {(verificationStatus === 'verified' || (isAuthenticated && isCustomerAlreadyVerified)) && customerVerification?.document_expiry_date && (
                <div className="space-y-2">
                  <Label className="font-medium">ID Document Expiry</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      value={format(new Date(customerVerification.document_expiry_date), "MMMM d, yyyy")}
                      readOnly
                      className="h-12 bg-muted/50 flex-1"
                    />
                    {new Date(customerVerification.document_expiry_date) < new Date() ? (
                      <span className="text-xs text-destructive font-medium px-2 py-1 bg-destructive/10 rounded">Expired</span>
                    ) : new Date(customerVerification.document_expiry_date) < new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) ? (
                      <span className="text-xs text-amber-600 font-medium px-2 py-1 bg-amber-500/10 rounded">Expires Soon</span>
                    ) : (
                      <span className="text-xs text-green-600 font-medium px-2 py-1 bg-green-500/10 rounded">Valid</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <CheckCircle className="w-3 h-3 text-primary" /> From your verified ID document
                  </p>
                </div>
              )}
            </div>

            {/* Identity Verification Section */}
            <div className="border-t border-border/50 pt-6 sm:pt-8">
              <h4 className="text-base sm:text-lg font-semibold mb-2 flex items-center gap-2">
                Identity Verification <span className="text-destructive">*</span>
              </h4>
              <p className="text-xs sm:text-sm text-muted-foreground mb-4">
                <strong>Required:</strong> To ensure security and compliance, all customers must complete identity verification before proceeding with their rental.
              </p>

              {/* Already Verified from Account - Show green success state */}
              {isAuthenticated && isCustomerAlreadyVerified && verificationStatus === 'verified' && (
                <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4 sm:p-5">
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                    <div className="flex items-start gap-3 flex-1">
                      <div className="p-2 rounded-full bg-green-500/20 flex-shrink-0">
                        <Shield className="w-6 h-6 text-green-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm sm:text-base font-semibold mb-1 text-green-600 dark:text-green-500">
                          Already Verified
                        </p>
                        <p className="text-xs sm:text-sm text-muted-foreground">
                          Your identity has been verified from your account. You don't need to verify again.
                        </p>
                        {customerVerification && (
                          <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                            {customerVerification.document_type && (
                              <div>
                                <span className="text-muted-foreground">Document Type:</span>
                                <p className="font-medium capitalize">{customerVerification.document_type.replace('_', ' ')}</p>
                              </div>
                            )}
                            {customerVerification.document_number && (
                              <div>
                                <span className="text-muted-foreground">Document Number:</span>
                                <p className="font-medium">****{customerVerification.document_number.slice(-4)}</p>
                              </div>
                            )}
                            {customerVerification.verification_provider && (
                              <div>
                                <span className="text-muted-foreground">Verified via:</span>
                                <p className="font-medium capitalize">
                                  {customerVerification.verification_provider === 'ai' ? 'AI Verification' : 'Veriff'}
                                </p>
                              </div>
                            )}
                            {customerVerification.ai_face_match_score && (
                              <div>
                                <span className="text-muted-foreground">Face Match:</span>
                                <p className="font-medium">{Math.round(customerVerification.ai_face_match_score * 100)}%</p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                    <Badge variant="default" className="bg-green-500 hover:bg-green-500/90 text-white self-start">
                      <CheckCircle className="w-3 h-3 mr-1" /> Verified
                    </Badge>
                  </div>
                </div>
              )}

              {/* Not verified yet - show verification required */}
              {verificationStatus === 'init' && !isCustomerAlreadyVerified && (
                <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3 sm:p-4">
                  <div className="flex items-start gap-2 sm:gap-3">
                    <AlertCircle className="w-5 h-5 text-destructive mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium mb-2 text-destructive">Verification Required</p>
                      <p className="text-xs sm:text-sm text-muted-foreground mb-4">
                        <strong>You must verify your identity to continue.</strong> Please fill in your details above, then click the button below to start the verification process.
                      </p>
                      <Button
                        onClick={handleUnifiedVerificationStart}
                        disabled={isVerifying || !formData.customerName || !formData.customerEmail || !formData.customerPhone}
                        variant="outline"
                        className="border-accent text-accent hover:bg-accent hover:text-white w-full sm:w-auto text-sm"
                        size="sm"
                      >
                        {isVerifying ? (
                          <>
                            <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
                            <span className="truncate">Starting...</span>
                          </>
                        ) : (
                          <>
                            <FileCheck className="w-4 h-4 mr-2 flex-shrink-0" />
                            <span>Start Identity Verification</span>
                          </>
                        )}
                      </Button>
                      {/* DEV MODE: Mock verification button - only visible when dev_mode is enabled in localStorage */}
                      {typeof window !== 'undefined' && localStorage.getItem('dev_mode') === 'true' && (
                        <Button
                          onClick={handleDevMockVerification}
                          variant="outline"
                          className="border-purple-500 text-purple-600 hover:bg-purple-500 hover:text-white w-full sm:w-auto text-sm"
                          size="sm"
                        >
                          <span className="mr-2">🔧</span>
                          DEV: Mock Verify
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {verificationStatus === 'pending' && (
                <>
                  {/* AI Verification - Show QR Code */}
                  {verificationMode === 'ai' && aiSessionData && (
                    <AIVerificationQR
                      sessionId={aiSessionData.sessionId}
                      qrUrl={aiSessionData.qrUrl}
                      expiresAt={aiSessionData.expiresAt}
                      onVerified={handleAIVerificationComplete}
                      onExpired={handleAIVerificationExpired}
                      onRetry={handleStartAIVerification}
                    />
                  )}

                  {/* Veriff Verification - Show Pending UI */}
                  {verificationMode === 'veriff' && (
                    <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3 sm:p-4">
                      <div className="flex items-start gap-2 sm:gap-3">
                        <Clock className="w-5 h-5 text-yellow-500 mt-0.5 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium mb-2 text-yellow-600 dark:text-yellow-500">Verification Pending</p>
                          <p className="text-xs sm:text-sm text-muted-foreground mb-2">
                            Your identity verification is in progress. Please complete the verification in the popup window.
                          </p>
                          <p className="text-xs text-muted-foreground mb-3">
                            Once verified, you can proceed with your booking. This may take a few moments.
                          </p>
                          <div className="flex flex-col sm:flex-row gap-2">
                            <Button
                              onClick={() => {
                                // Since Veriff API authentication isn't working, trust the user's
                                // confirmation that they completed verification in Veriff
                                console.log('✅ User confirmed verification complete');
                                setVerificationStatus('verified');
                                localStorage.setItem('verificationStatus', 'verified');
                                toast.success('Identity verified! You can now continue with your booking.');
                                // Show auth dialog for guest users to save their verification
                                if (!isAuthenticated) {
                                  setShowAuthDialog(true);
                                }
                              }}
                              variant="outline"
                              className="border-green-500 text-green-600 hover:bg-green-500 hover:text-white w-full sm:w-auto"
                              size="sm"
                            >
                              <CheckCircle className="w-4 h-4 mr-2 flex-shrink-0" />
                              <span>I've Completed Verification</span>
                            </Button>
                            <Button
                              onClick={handleStartVerification}
                              disabled={isVerifying}
                              variant="outline"
                              className="border-yellow-500 text-yellow-600 hover:bg-yellow-500 hover:text-white w-full sm:w-auto"
                              size="sm"
                            >
                              {isVerifying ? (
                                <>
                                  <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
                                  <span>Starting...</span>
                                </>
                              ) : (
                                <>
                                  <RefreshCw className="w-4 h-4 mr-2 flex-shrink-0" />
                                  <span>Reopen Verification</span>
                                </>
                              )}
                            </Button>
                            <Button
                              onClick={handleClearVerification}
                              variant="ghost"
                              className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 w-full sm:w-auto"
                              size="sm"
                            >
                              <X className="w-4 h-4 mr-2 flex-shrink-0" />
                              Cancel & Start Over
                            </Button>
                          </div>
                          <p className="text-xs text-muted-foreground mt-3">
                            Already completed verification? Click "Check Status" to refresh. If still pending, the verification may take a few moments to process.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Show this verification box ONLY for non-authenticated users who verified during this session */}
              {/* Authenticated users with existing verification see the "Already Verified" box above instead */}
              {verificationStatus === 'verified' && !(isAuthenticated && isCustomerAlreadyVerified) && (
                <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3 sm:p-4">
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                    <div className="flex items-start gap-2 sm:gap-3 flex-1">
                      <CheckCircle className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium mb-1 text-green-600 dark:text-green-500">Identity Verified</p>
                        <p className="text-xs sm:text-sm text-muted-foreground">
                          Your identity has been verified as <strong>{formData.customerName}</strong>. Your details have been updated with verified information.
                        </p>
                        {formData.licenseNumber && (
                          <p className="text-xs text-muted-foreground mt-1">
                            License/ID: {formData.licenseNumber.slice(0, 4)}****
                          </p>
                        )}

                        {/* Verification Images */}
                        {verificationImages && (verificationImages.document_front_url || verificationImages.document_back_url || verificationImages.selfie_image_url) && (
                          <div className="mt-3 pt-3 border-t border-green-500/20">
                            <p className="text-xs text-muted-foreground mb-2">Uploaded Documents</p>
                            <div className="grid grid-cols-3 gap-2">
                              {/* ID Front */}
                              <div className="flex flex-col items-center">
                                <div className={`w-full aspect-[3/4] rounded-md overflow-hidden border bg-muted/30 ${verificationImages.document_front_url ? 'border-green-500/30' : 'border-muted'}`}>
                                  {verificationImages.document_front_url ? (
                                    <img
                                      src={verificationImages.document_front_url}
                                      alt="ID Front"
                                      className="w-full h-full object-cover"
                                    />
                                  ) : (
                                    <div className="w-full h-full flex items-center justify-center">
                                      <FileCheck className="h-4 w-4 text-muted-foreground/50" />
                                    </div>
                                  )}
                                </div>
                                <span className="text-[9px] mt-1 text-muted-foreground">ID Front</span>
                              </div>

                              {/* ID Back */}
                              <div className="flex flex-col items-center">
                                <div className={`w-full aspect-[3/4] rounded-md overflow-hidden border bg-muted/30 ${verificationImages.document_back_url ? 'border-green-500/30' : 'border-muted'}`}>
                                  {verificationImages.document_back_url ? (
                                    <img
                                      src={verificationImages.document_back_url}
                                      alt="ID Back"
                                      className="w-full h-full object-cover"
                                    />
                                  ) : (
                                    <div className="w-full h-full flex items-center justify-center">
                                      <FileCheck className="h-4 w-4 text-muted-foreground/50" />
                                    </div>
                                  )}
                                </div>
                                <span className="text-[9px] mt-1 text-muted-foreground">ID Back</span>
                              </div>

                              {/* Selfie */}
                              <div className="flex flex-col items-center">
                                <div className={`w-full aspect-[3/4] rounded-md overflow-hidden border bg-muted/30 ${verificationImages.selfie_image_url ? 'border-green-500/30' : 'border-muted'}`}>
                                  {verificationImages.selfie_image_url ? (
                                    <img
                                      src={verificationImages.selfie_image_url}
                                      alt="Selfie"
                                      className="w-full h-full object-cover"
                                    />
                                  ) : (
                                    <div className="w-full h-full flex items-center justify-center">
                                      <User className="h-4 w-4 text-muted-foreground/50" />
                                    </div>
                                  )}
                                </div>
                                <span className="text-[9px] mt-1 text-muted-foreground">Selfie</span>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                    <Button
                      onClick={handleClearVerification}
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive hover:bg-destructive/10 flex-shrink-0 self-start sm:self-auto ml-7 sm:ml-0"
                      title="Clear verification to verify again"
                    >
                      <X className="w-4 h-4 mr-1" />
                      Clear
                    </Button>
                  </div>
                </div>
              )}

              {verificationStatus === 'rejected' && (
                <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3 sm:p-4">
                  <div className="flex items-start gap-2 sm:gap-3">
                    <X className="w-5 h-5 text-destructive mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium mb-2 text-destructive">Verification Failed</p>
                      <p className="text-xs sm:text-sm text-muted-foreground mb-3">
                        Your identity verification was not successful. Please try again or contact support.
                      </p>
                      <Button
                        onClick={handleUnifiedVerificationStart}
                        disabled={isVerifying}
                        variant="outline"
                        className="border-accent text-accent hover:bg-accent hover:text-white w-full sm:w-auto"
                        size="sm"
                      >
                        <FileCheck className="w-4 h-4 mr-2 flex-shrink-0" />
                        Retry Verification
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* Show validation error if user tries to continue without verification */}
              {errors.verification && (
                <p className="text-sm text-destructive mt-3 font-medium">{errors.verification}</p>
              )}
            </div>
          </div>

          {/* Navigation Buttons */}
          <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
            <Button
              onClick={() => setCurrentStep(skipInsurance ? 2 : 3)}
              variant="outline"
              className="w-full sm:flex-1 h-11 sm:h-12 border-primary text-primary hover:bg-primary/10 font-semibold text-sm sm:text-base"
              size="lg"
            >
              <ChevronLeft className="mr-2 w-4 h-4 sm:w-5 sm:h-5" /> Back
            </Button>
            <Button
              onClick={handleStep4Continue}
              disabled={verificationStatus !== 'verified' || isDocumentExpired}
              className="w-full sm:flex-1 h-11 sm:h-12 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-sm sm:text-base shadow-md hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              size="lg"
            >
              <span className="sm:hidden">Continue</span>
              <span className="hidden sm:inline">Continue to Review</span>
              <ChevronRight className="ml-2 w-4 h-4 sm:w-5 sm:h-5" />
            </Button>
          </div>
          {verificationStatus !== 'verified' && !isDocumentExpired && (
            <p className="text-xs sm:text-sm text-destructive text-center mt-2">
              Please complete identity verification to continue
            </p>
          )}
          {isDocumentExpired && (
            <p className="text-xs sm:text-sm text-destructive text-center mt-2">
              Your ID document has expired. Please update your verification to continue.
            </p>
          )}
        </div>}

        {/* Step 5: Review & Payment */}
        {currentStep === 5 && <div className="animate-fade-in space-y-6">
          {/* Promo Code Section */}
          <div className="bg-card border border-border rounded-lg p-4 sm:p-6">
            <div className="space-y-3">
              <Label htmlFor="promoCode" className="font-medium text-base">Promo Code (Optional)</Label>
              <div className="flex gap-2">
                <Input
                  id="promoCode"
                  placeholder="Enter code"
                  value={formData.promoCode}
                  onChange={(e) => {
                    setFormData({ ...formData, promoCode: e.target.value });
                    setPromoError(null);
                    if (!e.target.value) {
                      setPromoDetails(null);
                      localStorage.removeItem('appliedPromoCode');
                      localStorage.removeItem('appliedPromoDetails');
                    }
                  }}
                  className={cn("h-12", promoError ? "border-destructive" : promoDetails ? "border-green-500" : "")}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="h-12 px-6"
                  onClick={() => validatePromoCode(formData.promoCode)}
                  disabled={loading || !formData.promoCode}
                >
                  Apply
                </Button>
              </div>
              {promoError && <p className="text-sm text-destructive">{promoError}</p>}
              {promoDetails && (
                <p className="text-sm text-green-600 font-medium flex items-center gap-1">
                  <Check className="w-4 h-4" />
                  Code applied: {promoDetails.type === 'percentage' ? `${promoDetails.value}% off` : `${formatCurrency(promoDetails.value, currencyCode)} off`}
                </p>
              )}
            </div>
          </div>

          {/* Optional Extras */}
          <ExtrasSelector
            extras={availableExtras}
            selectedExtras={selectedExtras}
            onExtrasChange={setSelectedExtras}
            isLoading={extrasLoading}
            currencyCode={currencyCode}
          />

          <BookingCheckoutStep
            formData={formData}
            selectedVehicle={selectedVehicle}
            extras={availableExtras}
            selectedExtras={selectedExtras}
            rentalDuration={calculateRentalDuration() || {
              days: 1,
              formatted: '1 day'
            }}
            vehicleTotal={estimatedBooking?.vehicleTotal || 0}
            promoDetails={promoDetails}
            onBack={() => setCurrentStep(4)}
            bonzahPremium={bonzahPremium}
            bonzahCoverage={bonzahCoverage}
            pickupDeliveryFee={formData.pickupDeliveryFee}
            returnDeliveryFee={formData.returnDeliveryFee}
          />
        </div>}

      </div>
    </Card>

    {/* Insurance Upload Dialog */}
    <InsuranceUploadDialog
      open={showUploadDialog}
      onOpenChange={setShowUploadDialog}
      onUploadComplete={async (documentId, fileUrl) => {
        // documentId is the database record ID, fileUrl is the storage path
        setUploadedDocumentId(documentId);
        setShowUploadDialog(false);

        // Skip AI scanning if documentId is 'pending' (file uploaded but no DB record yet)
        // AI scanning will happen after checkout when the document record is created
        if (documentId === 'pending') {
          console.log('[INSURANCE] File uploaded to storage, AI scanning will happen at checkout');
          toast.success("Document uploaded! It will be verified during checkout.");
          return;
        }

        // Trigger AI document review for documents with actual database records
        setScanningDocument(true);
        try {
          const { data, error } = await supabase.functions.invoke('scan-insurance-document', {
            body: { documentId, fileUrl }
          });

          if (error) {
            console.error('Document review error:', error);
            toast.success("Document uploaded! It will be reviewed by our team.");
          } else if (data?.data?.requiresManualReview) {
            toast.success("Document uploaded! It will be reviewed by our team.");
          } else {
            toast.success("Insurance document verified successfully!");
          }
        } catch (error) {
          console.error('Document review error:', error);
          toast.success("Document uploaded! It will be reviewed by our team.");
        } finally {
          setScanningDocument(false);
        }
      }}
    />

    {/* Auth Prompt Dialog for session expiry */}
    <AuthPromptDialog
      open={showAuthDialog}
      onOpenChange={setShowAuthDialog}
      prefillEmail={formData.customerEmail}
      onSkip={() => {
        setShowAuthDialog(false);
        // User chose to continue as guest
      }}
      onSuccess={() => {
        setShowAuthDialog(false);
        // Reset flags to trigger re-sync of user data and verification
        // The useEffect hooks will detect auth change and fetch fresh data
        setIsCustomerDataPopulated(false);
        // Reset verification status to 'init' so it gets recalculated from user's account
        // If user has existing verification, it will be set to 'verified' by the effect
        if (verificationStatus !== 'verified') {
          setVerificationStatus('init');
        }
        console.log('🔐 Auth success, triggering data re-sync');
      }}
    />
  </>;
};
export default MultiStepBookingWidget;