import { useState, useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TimePicker } from "@/components/ui/time-picker";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { toast } from "sonner";
import { ChevronRight, ChevronLeft, Check, Baby, Coffee, MapPin, UserCheck, Car, Crown, TrendingUp, Users as GroupIcon, Calculator, Shield, CheckCircle, CalendarIcon, Clock, Search, Grid3x3, List, SlidersHorizontal, X, AlertCircle, FileCheck, RefreshCw, Upload } from "lucide-react";
import { format, differenceInHours } from "date-fns";
import { cn } from "@/lib/utils";
import BookingConfirmation from "./BookingConfirmation";
import LocationAutocomplete from "./LocationAutocomplete";
import BookingCheckoutStep from "./BookingCheckoutStep";
import InsuranceUploadDialog from "./insurance-upload-dialog";
import AIScanProgress from "./ai-scan-progress";
import { stripePromise } from "@/config/stripe";
import { usePageContent, defaultHomeContent, mergeWithDefaults } from "@/hooks/usePageContent";
import { canCustomerBook } from "@/lib/tenantQueries";
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
  status: string;
  created_at: string;
  // Rental rates from portal (note: API uses _rent not _rate)
  monthly_rent?: number;
  daily_rent?: number;
  weekly_rent?: number;
  vehicle_photos?: VehiclePhoto[];
  description?: string | null;
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
  const { tenant } = useTenant();
  const [currentStep, setCurrentStep] = useState(1);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [extras, setExtras] = useState<PricingExtra[]>([]);
  const [selectedExtras, setSelectedExtras] = useState<string[]>([]);
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
  const [sameAsPickup, setSameAsPickup] = useState(true);

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
  const [filters, setFilters] = useState({
    transmission: [] as string[],
    fuel: [] as string[],
    seats: [2, 7] as [number, number],
    priceRange: [0, 1000] as [number, number]
  });
  const searchDebounceTimer = useRef<NodeJS.Timeout>();
  const [expandedDescriptions, setExpandedDescriptions] = useState<Set<string>>(new Set());
  const [formData, setFormData] = useState({
    pickupLocation: "",
    dropoffLocation: "",
    pickupDate: "",
    dropoffDate: "",
    pickupTime: "",
    dropoffTime: "",
    specialRequests: "",
    vehicleId: "",
    driverAge: "",
    promoCode: "",
    customerName: "",
    customerEmail: "",
    customerPhone: "",
    customerType: "",
    licenseNumber: "",
    verificationSessionId: "",
  });

  // Insurance state
  const [hasInsurance, setHasInsurance] = useState<boolean | null>(null);
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [uploadedDocumentId, setUploadedDocumentId] = useState<string | null>(null);
  const [scanningDocument, setScanningDocument] = useState(false);

  // Identity verification state
  const [verificationSessionId, setVerificationSessionId] = useState<string | null>(null);
  const [verificationStatus, setVerificationStatus] = useState<'init' | 'pending' | 'verified' | 'rejected'>('init');
  const [isVerifying, setIsVerifying] = useState(false);
  const [locationCoords, setLocationCoords] = useState({
    pickupLat: null as number | null,
    pickupLon: null as number | null,
    dropoffLat: null as number | null,
    dropoffLon: null as number | null
  });
  useEffect(() => {
    loadData();

    // Load view mode from localStorage
    const savedViewMode = localStorage.getItem('viewMode');
    if (savedViewMode === 'grid' || savedViewMode === 'list') {
      setViewMode(savedViewMode);
    }

    // Load verification data from localStorage (persist across refreshes)
    const savedVerificationSessionId = localStorage.getItem('verificationSessionId');
    const savedVerificationStatus = localStorage.getItem('verificationStatus') as 'init' | 'pending' | 'verified' | 'rejected' | null;
    const savedVerificationToken = localStorage.getItem('verificationToken');
    const savedVerifiedName = localStorage.getItem('verifiedCustomerName');
    const savedLicenseNumber = localStorage.getItem('verifiedLicenseNumber');

    if (savedVerificationSessionId && savedVerificationStatus) {
      setVerificationSessionId(savedVerificationSessionId);
      setVerificationStatus(savedVerificationStatus);
      setFormData(prev => ({
        ...prev,
        verificationSessionId: savedVerificationSessionId,
        // Restore verified data if available
        ...(savedVerifiedName && { customerName: savedVerifiedName }),
        ...(savedLicenseNumber && { licenseNumber: savedLicenseNumber }),
      }));
      console.log('✅ Loaded verification from localStorage:', savedVerificationSessionId, savedVerificationStatus, savedVerifiedName);
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

  // Note: Verification no longer resets when customer details change
  // Users can freely edit their details after verification
  // The verification session ID remains valid

  // Sync return location when "Same as Pickup" is enabled
  useEffect(() => {
    if (sameAsPickup && formData.pickupLocation) {
      setFormData(prev => ({
        ...prev,
        dropoffLocation: prev.pickupLocation
      }));
      if (locationCoords.pickupLat && locationCoords.pickupLon) {
        setLocationCoords(prev => ({
          ...prev,
          dropoffLat: prev.pickupLat,
          dropoffLon: prev.pickupLon
        }));
      }
    }
  }, [sameAsPickup, formData.pickupLocation, locationCoords.pickupLat, locationCoords.pickupLon]);


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
  }, []);
  const loadData = async () => {
    // Build query for vehicles with tenant filtering
    let vehiclesQuery = supabase
      .from("vehicles")
      .select(`
        *,
        vehicle_photos (
          photo_url
        )
      `)
      .ilike("status", "Available")
      .order("reg");

    if (tenant?.id) {
      vehiclesQuery = vehiclesQuery.eq("tenant_id", tenant.id);
    }

    const { data: vehiclesData } = await vehiclesQuery;

    // Build query for pricing extras with tenant filtering
    let extrasQuery = supabase.from("pricing_extras").select("*");

    if (tenant?.id) {
      extrasQuery = extrasQuery.eq("tenant_id", tenant.id);
    }

    const { data: extrasData } = await extrasQuery;

    // Build query for blocked dates with tenant filtering
    let blockedDatesQuery = supabase
      .from("blocked_dates")
      .select("id, start_date, end_date, vehicle_id, reason");

    if (tenant?.id) {
      blockedDatesQuery = blockedDatesQuery.eq("tenant_id", tenant.id);
    }

    const { data: blockedDatesData } = await blockedDatesQuery;

    if (vehiclesData) {
      setVehicles(vehiclesData);

      // Calculate price range from vehicles (use monthly_rent if available)
      const prices = vehiclesData
        .map(v => v.monthly_rent || v.daily_rent || 0)
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
    if (extrasData) setExtras(extrasData);
    if (blockedDatesData) {
      // Store all blocked dates (global + vehicle-specific)
      setAllBlockedDates(blockedDatesData);

      // Filter only global blocked dates (vehicle_id is null) for Step 1 calendar
      const globalBlockedDates = blockedDatesData.filter(range => range.vehicle_id === null);

      // Expand global blocked date ranges into individual dates for calendar
      const formattedDates: string[] = [];
      globalBlockedDates.forEach(range => {
        const startDate = new Date(range.start_date);
        const endDate = new Date(range.end_date);

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

  // Check verification status - returns full verified data for auto-population
  const checkVerificationStatus = async (sessionId: string) => {
    try {
      const { data, error } = await supabase
        .from('identity_verifications')
        .select('review_result, status, review_status, first_name, last_name, document_number, date_of_birth')
        .eq('session_id', sessionId)
        .maybeSingle(); // Use maybeSingle() instead of single() to avoid 406 errors when record doesn't exist yet

      if (error) {
        console.error('Error checking verification status:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('Error checking verification:', error);
      return null;
    }
  };

  // Auto-populate form with verified data from Veriff
  const populateFormWithVerifiedData = (verificationData: { first_name?: string | null; last_name?: string | null; document_number?: string | null }) => {
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

    populateFormWithVerifiedData(mockVerificationData);
    console.log('🔓 DEV MODE: Mock verification completed with data:', mockVerificationData);
  };

  // Clear verification data
  const handleClearVerification = () => {
    setVerificationSessionId(null);
    setVerificationStatus('init');
    setFormData(prev => ({ ...prev, verificationSessionId: "", licenseNumber: "" }));
    localStorage.removeItem('verificationSessionId');
    localStorage.removeItem('verificationToken');
    localStorage.removeItem('verificationStatus');
    localStorage.removeItem('verifiedCustomerName');
    localStorage.removeItem('verifiedLicenseNumber');
    toast.info("Verification cleared. You can verify again.");
  };

  // Handle identity verification
  const handleStartVerification = async () => {
    // Validate customer details first
    if (!formData.customerName || !formData.customerEmail || !formData.customerPhone) {
      toast.error("Please fill in your name, email, and phone number first");
      return;
    }

    setIsVerifying(true);

    // Open window BEFORE async call to avoid Safari popup blocker
    const veriffWindow = window.open('about:blank', '_blank', 'width=800,height=600');

    try {
      const { data, error } = await supabase.functions.invoke('create-veriff-session', {
        body: {
          customerDetails: {
            name: formData.customerName,
            email: formData.customerEmail,
            phone: formData.customerPhone,
          }
        },
      });

      if (error) throw error;

      if (data?.ok && data?.sessionUrl) {
        setVerificationSessionId(data.verificationId);
        setVerificationStatus('pending');

        // Store verification session ID in formData to link after customer creation
        setFormData(prev => ({
          ...prev,
          verificationSessionId: data.verificationId
        }));

        // DEBUG: Confirm session ID is stored
        console.log('✅ Stored verification session ID in formData:', data.verificationId);

        // Store verification session in localStorage for later use
        localStorage.setItem('verificationSessionId', data.verificationId);
        localStorage.setItem('verificationToken', data.sessionToken);
        localStorage.setItem('verificationStatus', 'pending');

        // Navigate the already-opened window to Veriff URL
        if (veriffWindow) {
          veriffWindow.location.href = data.sessionUrl;
        }

        toast.success("Verification window opened. Please complete the identity verification.");

        // Start polling for verification status
        // More frequent checks initially (3s) to catch quick verifications before Safari throttles
        const pollInterval = setInterval(async () => {
          const status = await checkVerificationStatus(data.verificationId);
          if (status) {
            if (status.review_result === 'GREEN') {
              setVerificationStatus('verified');
              localStorage.setItem('verificationStatus', 'verified');
              clearInterval(pollInterval);

              // Auto-populate form with verified data
              populateFormWithVerifiedData(status);

              if (typeof window !== 'undefined' && (window as any).gtag) {
                (window as any).gtag('event', 'verification_completed', {
                  email: formData.customerEmail,
                  result: 'verified',
                });
              }
            } else if (status.review_result === 'RED') {
              setVerificationStatus('rejected');
              localStorage.setItem('verificationStatus', 'rejected');
              toast.error("Identity verification failed. Please try again.");
              clearInterval(pollInterval);

              if (typeof window !== 'undefined' && (window as any).gtag) {
                (window as any).gtag('event', 'verification_completed', {
                  email: formData.customerEmail,
                  result: 'rejected',
                });
              }
            }
          }
        }, 3000); // Check every 3 seconds (faster for iOS Safari compatibility)

        // Stop polling after 5 minutes
        setTimeout(() => clearInterval(pollInterval), 5 * 60 * 1000);

        // Track analytics
        if (typeof window !== 'undefined' && (window as any).gtag) {
          (window as any).gtag('event', 'verification_started', {
            email: formData.customerEmail,
          });
        }
      } else {
        throw new Error(data?.error || 'Failed to create verification session');
      }
    } catch (error: any) {
      console.error("Verification error:", error);
      toast.error(error.message || "Failed to start verification");

      // Close the blank window if API call failed
      if (veriffWindow) {
        veriffWindow.close();
      }

      if (typeof window !== 'undefined' && (window as any).gtag) {
        (window as any).gtag('event', 'verification_failed', {
          error: error.message,
        });
      }
    } finally {
      setIsVerifying(false);
    }
  };

  const calculatePriceBreakdown = () => {
    const selectedVehicle = vehicles.find(v => v.id === formData.vehicleId);
    if (!selectedVehicle) return null;

    // Calculate rental duration in days
    let rentalPrice = 0;
    let rentalDays = 0;
    if (formData.pickupDate && formData.dropoffDate) {
      const pickup = new Date(formData.pickupDate);
      const dropoff = new Date(formData.dropoffDate);
      rentalDays = Math.max(1, Math.ceil((dropoff.getTime() - pickup.getTime()) / (1000 * 60 * 60 * 24)));

      // Calculate based on rental period
      if (rentalDays >= 30) {
        // Monthly rent
        const months = Math.floor(rentalDays / 30);
        const remainingDays = rentalDays % 30;
        rentalPrice = months * (selectedVehicle.monthly_rent || 0) + remainingDays * (selectedVehicle.daily_rent || 0);
      } else if (rentalDays >= 7) {
        // Weekly rent
        const weeks = Math.floor(rentalDays / 7);
        const remainingDays = rentalDays % 7;
        rentalPrice = weeks * (selectedVehicle.weekly_rent || 0) + remainingDays * (selectedVehicle.daily_rent || 0);
      } else {
        // Daily rent
        rentalPrice = rentalDays * (selectedVehicle.daily_rent || 0);
      }
    }
    const extrasTotal = selectedExtras.reduce((sum, extraId) => {
      const extra = extras.find(e => e.id === extraId);
      return sum + (extra?.price || 0);
    }, 0);
    const totalPrice = rentalPrice + extrasTotal;
    return {
      rentalPrice,
      rentalDays,
      extrasTotal,
      totalPrice
    };
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
      } else {
        // Create new customer
        const customerData: any = {
          name: formData.customerName,
          email: formData.customerEmail,
          phone: formData.customerPhone,
          customer_type: formData.customerType || "Individual",
          status: "Active"
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

      // Build rental data
      const rentalData: any = {
        customer_id: customerId,
        vehicle_id: formData.vehicleId || null,
        pickup_location: formData.pickupLocation,
        return_location: formData.dropoffLocation,
        start_date: formData.pickupDate,
        end_date: formData.dropoffDate || formData.pickupDate,
        monthly_amount: priceBreakdown?.totalPrice || 0,
        notes: formData.specialRequests || null,
        status: "Pending"
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
      pickupDate: "",
      dropoffDate: "",
      pickupTime: "",
      dropoffTime: "",
      specialRequests: "",
      vehicleId: "",
      driverAge: "",
      promoCode: "",
      customerName: "",
      customerEmail: "",
      customerPhone: "",
      customerType: "",
      licenseNumber: ""
    });
    setSelectedExtras([]);
    setCalculatedDistance(null);
    setDistanceOverride(false);
  };

  // Calculate distance using Haversine formula (great-circle distance)
  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 3958.8; // Earth's radius in miles
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
          // Distance is in meters, convert to miles
          const distanceInMiles = Math.round(data.routes[0].distance / 1609.34 * 10) / 10;
          const durationInMinutes = Math.round(data.routes[0].duration / 60);
          setCalculatedDistance(distanceInMiles);
          toast.success(`Driving distance: ${distanceInMiles} miles (approx. ${durationInMinutes} min)`);
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
      toast.warning(`Estimated distance: ${straightLineDistance} miles (straight-line, route unavailable)`);
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
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return {
      hours,
      days,
      remainingHours,
      isValid: hours >= 24 && days <= 365,
      formatted: remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days} day${days !== 1 ? 's' : ''}`
    };
  };
  const calculateEstimatedTotal = (vehicle: Vehicle) => {
    if (!formData.pickupDate || !formData.dropoffDate) return null;
    const duration = calculateRentalDuration();
    if (!duration) return null;
    const days = duration.days;
    let total = 0;
    const dailyRent = vehicle.daily_rent || 0;
    const weeklyRent = vehicle.weekly_rent || 0;
    const monthlyRent = vehicle.monthly_rent || 0;

    if (days >= 28 && monthlyRent > 0) {
      const months = Math.floor(days / 30);
      const remainingDays = days % 30;
      total = months * monthlyRent + (dailyRent > 0 ? remainingDays * dailyRent : 0);
    } else if (days >= 7 && weeklyRent > 0) {
      const weeks = Math.floor(days / 7);
      const remainingDays = days % 7;
      total = weeks * weeklyRent + (dailyRent > 0 ? remainingDays * dailyRent : 0);
    } else if (dailyRent > 0) {
      total = days * dailyRent;
    } else if (monthlyRent > 0) {
      // Fallback: estimate daily from monthly
      total = (monthlyRent / 30) * days;
    }
    return {
      total,
      days
    };
  };

  // Check if a vehicle is blocked during the selected rental period
  const isVehicleBlockedForPeriod = (vehicleId: string): { blocked: boolean; blockedRange?: { start: string; end: string } } => {
    if (!formData.pickupDate || !formData.dropoffDate) {
      return { blocked: false };
    }

    const pickupDate = new Date(formData.pickupDate);
    const dropoffDate = new Date(formData.dropoffDate);

    // Find any blocked dates for this specific vehicle that overlap with the rental period
    const vehicleBlockedDates = allBlockedDates.filter(block => block.vehicle_id === vehicleId);

    for (const block of vehicleBlockedDates) {
      const blockStart = new Date(block.start_date);
      const blockEnd = new Date(block.end_date);

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

    // Search filter - search in make, model, and reg
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(v =>
        (v.make && v.make.toLowerCase().includes(term)) ||
        (v.model && v.model.toLowerCase().includes(term)) ||
        v.reg.toLowerCase().includes(term)
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

    // Price range filter - use monthly_rent or daily_rent
    filtered = filtered.filter(v => {
      const price = v.monthly_rent || v.daily_rent || 0;
      return price >= filters.priceRange[0] && price <= filters.priceRange[1];
    });

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
        filtered.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
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
    setFilters({
      transmission: [],
      fuel: [],
      seats: [2, 7],
      priceRange: originalPriceRange // Use stored original range
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
  const validateStep1 = () => {
    const newErrors: {
      [key: string]: string;
    } = {};

    // Validate pickup location
    if (!formData.pickupLocation.trim()) {
      newErrors.pickupLocation = "Pickup location is required";
    } else {
      const pickupText = formData.pickupLocation.trim();
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
    if (!formData.dropoffLocation.trim()) {
      newErrors.dropoffLocation = "Drop-off location is required";
    } else {
      const dropoffText = formData.dropoffLocation.trim();
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

    // Validate driver age - now required
    if (!formData.driverAge || formData.driverAge.trim() === "") {
      newErrors.driverAge = "Please select driver age range.";
    } else if (!["under_25", "25_70", "over_70"].includes(formData.driverAge)) {
      newErrors.driverAge = "Please select a valid driver age range.";
    }

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
          const cleaned = phoneValue.replace(/[\s\-()]/g, '');
          const digitCount = (cleaned.match(/\d/g) || []).length;
          if (digitCount < 7 || digitCount > 15) {
            newErrors.customerPhone = "Please enter a valid phone number (7-15 digits)";
          } else if (cleaned.startsWith('+') && !/^\+\d+$/.test(cleaned)) {
            newErrors.customerPhone = "Invalid phone number format";
          } else if (!cleaned.startsWith('+') && !/^\d+$/.test(cleaned.replace(/[\s\-()]/g, ''))) {
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

      case 'driverAge':
        if (!value || value.trim() === "") {
          newErrors.driverAge = "Please select driver age range.";
        } else if (!["under_25", "25_70", "over_70"].includes(value)) {
          newErrors.driverAge = "Please select a valid driver age range.";
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
      // Store in localStorage
      const bookingContext = {
        pickupLocation: formData.pickupLocation,
        dropoffLocation: formData.dropoffLocation,
        pickupDate: formData.pickupDate,
        pickupTime: formData.pickupTime,
        dropoffDate: formData.dropoffDate,
        dropoffTime: formData.dropoffTime,
        driverAge: formData.driverAge,
        promoCode: formData.promoCode,
        young_driver: formData.driverAge === 'under_25'
      };
      localStorage.setItem('booking_context', JSON.stringify(bookingContext));

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
          driver_age: formData.driverAge,
          has_promo: !!formData.promoCode,
          young_driver: formData.driverAge === 'under_25'
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
      const bookingContext = JSON.parse(localStorage.getItem('booking_context') || '{}');
      localStorage.setItem('booking_context', JSON.stringify({
        ...bookingContext,
        vehicle_id: formData.vehicleId,
        viewMode,
        filters: {
          search: searchTerm,
          categories: selectedCategories,
          sortBy
        }
      }));
      setCurrentStep(3); // Go to insurance verification
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

    // Analytics tracking
    if ((window as any).gtag) {
      (window as any).gtag('event', 'booking_step4_submitted', {
        customer_type: formData.customerType,
        verification_status: verificationStatus
      });
    }
    setCurrentStep(5);
  };

  const validateStep3 = () => {
    // Step 3 is insurance - optional, always valid
    return true;
  };

  const validateStep4 = () => {
    // Validation for customer details (moved from old validateStep3)
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
    // License number validation removed - field not in UI

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
              {[{
              step: 1,
              label: "Trip",
              fullLabel: "Trip Details"
            }, {
              step: 2,
              label: "Vehicle",
              fullLabel: "Choose Vehicle"
            }, {
              step: 3,
              label: "Insurance",
              fullLabel: "Insurance Verification"
            }, {
              step: 4,
              label: "Details",
              fullLabel: "Customer Details"
            }, {
              step: 5,
              label: "Review",
              fullLabel: "Review & Confirm"
            }].map(({
              step,
              label,
              fullLabel
            }, index) => <div key={step} className="flex flex-col items-center flex-1 relative z-10">
                  <div className={cn("bk-step__node flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 md:w-14 md:h-14 rounded-full border-2 transition-all", currentStep >= step ? 'bg-primary border-primary shadow-glow' : 'border-border bg-muted', currentStep === step && 'bk-step__node--active shadow-glow')} aria-label={`Step ${step} of 5: ${fullLabel}`} aria-current={currentStep === step ? "step" : undefined}>
                    {currentStep > step ? <Check className="w-4 h-4 sm:w-5 sm:h-5 md:w-6 md:h-6 text-primary-foreground" /> : <span className={cn("text-base sm:text-lg md:text-xl font-bold", currentStep === step ? "text-primary-foreground" : "text-muted-foreground")}>
                        {step}
                      </span>}
                  </div>
                  <span className={`mt-1.5 sm:mt-2 text-[10px] sm:text-xs md:text-sm font-medium text-center leading-tight ${currentStep >= step ? 'text-primary' : 'text-muted-foreground'}`}>
                    <span className="hidden sm:inline">{fullLabel}</span>
                    <span className="sm:hidden">{label}</span>
                  </span>
                  {index < 4 && <div className={cn("bk-step__line absolute top-5 sm:top-6 md:top-7 left-[calc(50%+20px)] sm:left-[calc(50%+24px)] md:left-[calc(50%+28px)] w-[calc(100%-40px)] sm:w-[calc(100%-48px)] md:w-[calc(100%-56px)] h-0.5", currentStep > step ? 'bg-primary' : 'bg-border')} />}
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
            
            {/* Form Fields */}
            <div className="space-y-8">
              {/* Row 1: Pickup & Return Location */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                {/* Pickup Location */}
                <div className="space-y-2">
                  <Label htmlFor="pickupLocation" className="font-medium">Pickup *</Label>
                  <LocationAutocomplete id="pickupLocation" value={formData.pickupLocation} onChange={(value, lat, lon) => {
                  setFormData({
                    ...formData,
                    pickupLocation: value
                  });
                  setLocationCoords({
                    ...locationCoords,
                    pickupLat: lat || null,
                    pickupLon: lon || null
                  });
                  // Instant validation
                  validateField('pickupLocation', value);
                }} placeholder="Enter pickup address" className="h-12 focus-visible:ring-primary" />
                  <p className="text-xs text-muted-foreground">Start typing a Dallas address or landmark</p>
                  {errors.pickupLocation && <p className="text-sm text-destructive">{errors.pickupLocation}</p>}
                </div>

                {/* Return Location with Toggle */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="dropoffLocation" className="font-medium">Return *</Label>
                    <div className="flex items-center gap-2">
                      <Switch id="sameAsPickup" checked={sameAsPickup} onCheckedChange={checked => {
                      setSameAsPickup(checked);
                      if (!checked) {
                        setFormData(prev => ({
                          ...prev,
                          dropoffLocation: ""
                        }));
                        setLocationCoords(prev => ({
                          ...prev,
                          dropoffLat: null,
                          dropoffLon: null
                        }));
                      }
                    }} aria-label="Same as pickup location" />
                      <Label htmlFor="sameAsPickup" className="text-xs cursor-pointer font-normal">
                        Same as pickup
                      </Label>
                    </div>
                  </div>
                  <LocationAutocomplete id="dropoffLocation" value={formData.dropoffLocation} onChange={(value, lat, lon) => {
                  setFormData({
                    ...formData,
                    dropoffLocation: value
                  });
                  setLocationCoords({
                    ...locationCoords,
                    dropoffLat: lat || null,
                    dropoffLon: lon || null
                  });
                  // Instant validation
                  validateField('dropoffLocation', value);
                }} placeholder="Enter return address" className="h-12 focus-visible:ring-primary" disabled={sameAsPickup} />
                  <p className="text-xs text-muted-foreground">Start typing a Dallas address or landmark</p>
                  {errors.dropoffLocation && <p className="text-sm text-destructive">{errors.dropoffLocation}</p>}
                </div>
              </div>

              {/* Row 2: Pickup & Return Datetime */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                {/* Pickup Datetime */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Label className="font-medium">Pickup *</Label>
                    <span className="text-xs text-muted-foreground px-2 py-0.5 bg-muted rounded">PST/PDT</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className={cn("w-full justify-start text-left font-normal h-12", !formData.pickupDate && "text-muted-foreground")}>
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {formData.pickupDate ? format(new Date(formData.pickupDate), "MMM dd") : <span>Date</span>}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar mode="single" selected={formData.pickupDate ? new Date(formData.pickupDate) : undefined} onSelect={date => {
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
                        return date < today || date > oneYearFromNow || blockedDates.includes(dateStr);
                      }} initialFocus className="pointer-events-auto" />
                      </PopoverContent>
                    </Popover>
                    <TimePicker id="pickupTime" value={formData.pickupTime} onChange={value => {
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
                  }} className="h-12 focus-visible:ring-primary" />
                  </div>
                  {errors.pickupDate && <p className="text-sm text-destructive">{errors.pickupDate}</p>}
                  {errors.pickupTime && !errors.pickupDate && <p className="text-sm text-destructive">{errors.pickupTime}</p>}
                </div>

                {/* Return Datetime */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Label className="font-medium">Return *</Label>
                    <span className="text-xs text-muted-foreground px-2 py-0.5 bg-muted rounded">PST/PDT</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className={cn("w-full justify-start text-left font-normal h-12", !formData.dropoffDate && "text-muted-foreground")}>
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {formData.dropoffDate ? format(new Date(formData.dropoffDate), "MMM dd") : <span>Date</span>}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar mode="single" selected={formData.dropoffDate ? new Date(formData.dropoffDate) : undefined} onSelect={date => {
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
                        const pickupDate = formData.pickupDate ? new Date(formData.pickupDate) : new Date();
                        const oneYearFromPickup = new Date(pickupDate);
                        oneYearFromPickup.setFullYear(oneYearFromPickup.getFullYear() + 1);
                        const dateStr = format(date, "yyyy-MM-dd");
                        return date <= pickupDate || date > oneYearFromPickup || blockedDates.includes(dateStr);
                      }} initialFocus className="pointer-events-auto" />
                      </PopoverContent>
                    </Popover>
                    <TimePicker id="dropoffTime" value={formData.dropoffTime} onChange={value => {
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
                  }} className="h-12 focus-visible:ring-primary" />
                  </div>
                  {errors.dropoffDate && <p className="text-sm text-destructive">{errors.dropoffDate}</p>}
                  {errors.dropoffTime && !errors.dropoffDate && <p className="text-sm text-destructive">{errors.dropoffTime}</p>}
                </div>
              </div>

              {/* Row 3: Driver Age & Promo Code */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                <div className="space-y-2">
                  <Label htmlFor="driverAge" className="font-medium">Driver Age *</Label>
                  <Select value={formData.driverAge} onValueChange={value => {
                  setFormData({
                    ...formData,
                    driverAge: value
                  });
                  // Instant validation
                  validateField('driverAge', value);
                }}>
                    <SelectTrigger id="driverAge" className="h-12 focus-visible:ring-primary">
                      <SelectValue placeholder="Select age range" />
                    </SelectTrigger>
                    <SelectContent position="popper" sideOffset={4}>
                      <SelectItem value="under_25">Under 25</SelectItem>
                      <SelectItem value="25_70">25–70</SelectItem>
                      <SelectItem value="over_70">70+</SelectItem>
                    </SelectContent>
                  </Select>
                  {errors.driverAge && <p className="text-sm text-destructive">{errors.driverAge}</p>}
                  {formData.driverAge === 'under_25' && <p className="text-xs text-primary">Young Driver Fee will apply</p>}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="promoCode" className="font-medium">Promo Code</Label>
                  <Input id="promoCode" value={formData.promoCode} onChange={e => {
                  const value = e.target.value.toUpperCase();
                  setFormData({
                    ...formData,
                    promoCode: value
                  });
                }} placeholder="Enter promo code" className="h-12 focus-visible:ring-primary" maxLength={20} />
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
                    {format(new Date(formData.pickupDate), "MMM dd")} → {format(new Date(formData.dropoffDate), "MMM dd")}
                  </span>
                  <span>•</span>
                  <span>{formData.pickupLocation.split(',')[0] || 'Selected location'}</span>
                  <span>•</span>
                  <span>{calculateRentalDuration()?.days || 0} days</span>
                </div>}
            </div>

            {/* Toolbar */}
            <Card className="p-4 bg-card/90 backdrop-blur-sm border-primary/15 sticky top-20 z-10 shadow-lg">
              <div className="flex flex-col gap-4">
                {/* Top Row: Search, Sort, View Toggle */}
                <div className="flex flex-col sm:flex-row gap-3">
                  {/* Search */}
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input value={searchTerm} onChange={e => handleSearchChange(e.target.value)} placeholder="Search model or brand…" className="pl-10 h-10 bg-background focus-visible:ring-primary" aria-label="Search vehicles" />
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
                      <SelectItem value="seats_most">Seats: Most → Fewest</SelectItem>
                      <SelectItem value="newest">Newest Models</SelectItem>
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
                          setFilters({
                            transmission: [],
                            fuel: [],
                            seats: [2, 7],
                            priceRange: originalPriceRange // Use stored original range
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

                        {/* Price Range */}
                        <div className="space-y-2">
                          <Label className="text-sm font-medium">
                            Price per month: ${filters.priceRange[0]} - ${filters.priceRange[1]}
                          </Label>
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
              {/* Vehicle Grid/List */}
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
                  </Card> : <div className={cn("grid gap-6", viewMode === "grid" ? "grid-cols-1 md:grid-cols-2 lg:grid-cols-3" : "grid-cols-1")}>
                    {filteredVehicles.map(vehicle => {
                  const badge = getVehicleBadge(vehicle);
                  const vehicleName = vehicle.make && vehicle.model ? `${vehicle.make} ${vehicle.model}` : vehicle.make || vehicle.model || vehicle.reg;
                  const isRollsRoyce = (vehicle.make || '').toLowerCase().includes("rolls") || (vehicle.model || '').toLowerCase().includes("phantom");
                  const isSelected = formData.vehicleId === vehicle.id;
                  const estimation = calculateEstimatedTotal(vehicle);
                  const blockStatus = isVehicleBlockedForPeriod(vehicle.id);
                  const isBlocked = blockStatus.blocked;

                  if (viewMode === "list") {
                    // List View Card
                    return <Card key={vehicle.id} className={cn("group transition-all duration-300 overflow-hidden border-2 relative",
                      isBlocked ? "opacity-60 cursor-not-allowed border-destructive/30" : "cursor-pointer hover:shadow-2xl",
                      !isBlocked && isSelected ? "border-primary bg-primary/5 shadow-glow" : "border-border/30 hover:border-primary/40")} onClick={() => {
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
                            <div className="flex flex-col sm:flex-row">
                              {/* Image */}
                              <div className="relative w-full sm:w-64 aspect-video sm:aspect-square overflow-hidden bg-gradient-to-br from-muted/30 to-muted/5">
                                {vehicle.vehicle_photos?.[0]?.photo_url ? (
                                  <img
                                    src={vehicle.vehicle_photos[0].photo_url}
                                    alt={vehicleName}
                                    className="w-full h-full object-cover"
                                    loading="lazy"
                                    onError={(e) => {
                                      e.currentTarget.style.display = 'none';
                                      const fallback = e.currentTarget.nextElementSibling as HTMLElement;
                                      if (fallback) fallback.style.display = 'flex';
                                    }}
                                  />
                                ) : null}
                                <div className={`${vehicle.vehicle_photos?.[0]?.photo_url ? 'hidden' : 'flex'} items-center justify-center h-full w-full absolute inset-0`}>
                                  <Car className="w-16 h-16 opacity-20 text-muted-foreground" />
                                </div>

                                {/* Registration Chip */}
                                <div className="absolute top-3 right-3 px-3 py-1 bg-primary text-primary-foreground text-xs font-semibold rounded-full">
                                  {vehicle.reg}
                                </div>

                                {/* Blocked Badge */}
                                {isBlocked && blockStatus.blockedRange && (
                                  <div className="absolute bottom-3 left-3 right-3 px-3 py-2 bg-destructive/90 text-white text-xs font-medium rounded-lg backdrop-blur">
                                    <p className="font-semibold mb-1">Unavailable</p>
                                    <p className="text-[10px] opacity-90">
                                      {format(new Date(blockStatus.blockedRange.start), "MMM dd")} - {format(new Date(blockStatus.blockedRange.end), "MMM dd")}
                                    </p>
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
                                <div className="flex items-end justify-between gap-4 mt-4">
                                  <div className="space-y-1">
                                    <div className="flex items-baseline gap-2">
                                      <span className="text-3xl font-bold text-primary">
                                        ${vehicle.monthly_rent || vehicle.daily_rent || 0}
                                      </span>
                                      <span className="text-sm text-muted-foreground">/ month</span>
                                    </div>
                                    {(vehicle.daily_rent || vehicle.weekly_rent) && <p className="text-xs text-muted-foreground">
                                      {vehicle.daily_rent && `$${vehicle.daily_rent} / day`}
                                      {vehicle.daily_rent && vehicle.weekly_rent && ' • '}
                                      {vehicle.weekly_rent && `$${vehicle.weekly_rent} / week`}
                                    </p>}
                                  </div>

                                  <Button
                                    className={cn("w-40 h-11 font-medium transition-colors",
                                      isBlocked ? "bg-muted text-muted-foreground cursor-not-allowed" :
                                      isSelected ? "bg-primary text-primary-foreground hover:bg-primary/90" :
                                      "bg-background border-2 border-primary text-primary hover:bg-primary hover:text-primary-foreground")}
                                    disabled={isBlocked}
                                    onClick={e => {
                                      if (isBlocked) return;
                                      e.stopPropagation();
                                      setFormData({
                                        ...formData,
                                        vehicleId: vehicle.id
                                      });
                                      if ((window as any).gtag) {
                                        (window as any).gtag('event', 'vehicle_selected', {
                                          vehicle_id: vehicle.id,
                                          est_total: estimation?.total || 0
                                        });
                                      }
                                    }}>
                                    {isBlocked ? "Unavailable" : isSelected ? "Selected" : "Select This Vehicle"}
                                  </Button>
                                </div>
                              </div>
                            </div>
                          </Card>;
                  }

                  // Grid View Card (existing design)
                  return <Card key={vehicle.id} className={cn("group transition-all duration-300 overflow-hidden border-2 relative",
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
                          {/* Registration Chip */}
                          <div className="absolute top-3 right-3 z-10 px-3 py-1 bg-primary text-primary-foreground text-xs font-semibold rounded-full">
                            {vehicle.reg}
                          </div>

                          {/* Selected Tick */}
                          {isSelected && <div className="absolute top-3 right-3 z-20 w-6 h-6 bg-primary rounded-full flex items-center justify-center">
                              <Check className="w-4 h-4 text-black" />
                            </div>}

                          {/* Image Block */}
                          <div className={cn("relative aspect-video overflow-hidden bg-gradient-to-br", isRollsRoyce ? "from-primary/10 to-primary/20" : "from-muted/30 to-muted/5")}>
                            {vehicle.vehicle_photos?.[0]?.photo_url ? (
                              <img
                                src={vehicle.vehicle_photos[0].photo_url}
                                alt={vehicleName}
                                className="w-full h-full object-cover"
                                loading="lazy"
                                onError={(e) => {
                                  e.currentTarget.style.display = 'none';
                                  const fallback = e.currentTarget.nextElementSibling as HTMLElement;
                                  if (fallback) fallback.style.display = 'flex';
                                }}
                              />
                            ) : null}
                            <div className={`${vehicle.vehicle_photos?.[0]?.photo_url ? 'hidden' : 'flex'} flex-col items-center justify-center h-full w-full absolute inset-0`}>
                              <Car className={cn("w-16 h-16 mb-2 opacity-20", isRollsRoyce ? "text-primary" : "text-muted-foreground")} />
                            </div>

                            {/* Blocked Badge */}
                            {isBlocked && blockStatus.blockedRange && (
                              <div className="absolute bottom-3 left-3 right-3 px-3 py-2 bg-destructive/90 text-white text-xs font-medium rounded-lg backdrop-blur">
                                <p className="font-semibold mb-1">Unavailable</p>
                                <p className="text-[10px] opacity-90">
                                  {format(new Date(blockStatus.blockedRange.start), "MMM dd")} - {format(new Date(blockStatus.blockedRange.end), "MMM dd")}
                                </p>
                              </div>
                            )}
                          </div>

                          {/* Content */}
                          <div className="p-6 space-y-4">
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
                              <span title="Registration">{vehicle.reg}</span>
                            </div>

                            {/* Price Section */}
                            <div className="space-y-1">
                              <div className="flex items-baseline justify-between">
                                <span className="text-2xl font-bold text-primary">
                                  ${vehicle.monthly_rent || vehicle.daily_rent || 0}
                                </span>
                                <span className="text-sm text-muted-foreground">/ month</span>
                              </div>
                              {(vehicle.daily_rent || vehicle.weekly_rent) && <p className="text-xs text-muted-foreground">
                                {vehicle.daily_rent && `$${vehicle.daily_rent} / day`}
                                {vehicle.daily_rent && vehicle.weekly_rent && ' • '}
                                {vehicle.weekly_rent && `$${vehicle.weekly_rent} / week`}
                              </p>}
                            </div>

                            {/* CTA */}
                            <Button
                              className={cn("w-full h-11 font-medium transition-colors",
                                isBlocked ? "bg-muted text-muted-foreground cursor-not-allowed" :
                                isSelected ? "bg-primary text-primary-foreground hover:bg-primary/90" :
                                "bg-background border-2 border-primary text-primary hover:bg-primary hover:text-primary-foreground")}
                              disabled={isBlocked}
                              onClick={e => {
                                if (isBlocked) return;
                                e.stopPropagation();
                                setFormData({
                                  ...formData,
                                  vehicleId: vehicle.id
                                });
                                if ((window as any).gtag) {
                                  (window as any).gtag('event', 'vehicle_selected', {
                                    vehicle_id: vehicle.id,
                                    est_total: estimation?.total || 0
                                  });
                                }
                              }}>
                              {isBlocked ? "Unavailable" : isSelected ? "Selected" : "Select This Vehicle"}
                            </Button>
                          </div>
                        </Card>;
                })}
                  </div>}
              </div>

              {/* Sidebar Summary (Desktop Only) */}
              <div className="hidden lg:block">
                <Card className="sticky top-24 p-6 bg-card border-primary/20 space-y-4">
                  <h4 className="font-display text-xl font-semibold">Your Trip</h4>
                  
                  <div className="space-y-3 text-sm">
                    <div>
                      <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Pickup</p>
                      <p className="font-medium">{formData.pickupDate ? format(new Date(formData.pickupDate), "MMM dd, yyyy") : "—"}</p>
                      <p className="text-muted-foreground text-xs">{formData.pickupTime || "—"}</p>
                    </div>
                    
                    <div>
                      <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Return</p>
                      <p className="font-medium">{formData.dropoffDate ? format(new Date(formData.dropoffDate), "MMM dd, yyyy") : "—"}</p>
                      <p className="text-muted-foreground text-xs">{formData.dropoffTime || "—"}</p>
                    </div>
                    
                    <div className="pt-3 border-t border-border/50">
                      <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Duration</p>
                      <p className="font-semibold text-lg">{calculateRentalDuration()?.formatted || "—"}</p>
                    </div>
                    
                    <div>
                      <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Location</p>
                      <p className="font-medium text-xs">{formData.pickupLocation.split(',').slice(0, 2).join(',') || "—"}</p>
                    </div>
                  </div>

                  {selectedVehicle && estimatedBooking && <div className="pt-4 border-t border-border/50 space-y-3">
                      {/* Selected Vehicle */}
                      <div className="flex gap-3">
                        <div className="w-16 h-16 rounded-md overflow-hidden bg-muted flex-shrink-0 relative">
                          {selectedVehicle.vehicle_photos?.[0]?.photo_url ? (
                            <img
                              src={selectedVehicle.vehicle_photos[0].photo_url}
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
                          <div className={`${selectedVehicle.vehicle_photos?.[0]?.photo_url ? 'hidden' : 'flex'} w-full h-full items-center justify-center absolute inset-0`}>
                            <Car className="w-6 h-6 text-muted-foreground opacity-30" />
                          </div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-sm truncate">
                            {selectedVehicle.make && selectedVehicle.model ? `${selectedVehicle.make} ${selectedVehicle.model}` : selectedVehicle.make || selectedVehicle.model || selectedVehicle.reg}
                          </p>
                          <p className="text-xs text-muted-foreground">{estimatedBooking.days} days</p>
                          <p className="text-lg font-bold text-primary mt-1">
                            ${estimatedBooking.total.toFixed(0)}
                          </p>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Final total at checkout
                      </p>
                    </div>}

                  {!selectedVehicle && <div className="pt-4 border-t border-border/50">
                      <p className="text-xs text-muted-foreground">
                        Pricing shown per day; total calculated at checkout.
                      </p>
                    </div>}

                  <Button onClick={handleStep2Continue} disabled={!formData.vehicleId} className="w-full h-11 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-md hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed" size="lg">
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
              <Button onClick={handleStep2Continue} disabled={!formData.vehicleId} className="w-full sm:flex-1 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-md hover:shadow-lg transition-all disabled:opacity-50" size="lg">
                Review & Pay <ChevronRight className="ml-2 w-5 h-5" />
              </Button>
            </div>
          </div>}

        {/* Step 3: Insurance Verification */}
        {currentStep === 3 && <div className="space-y-8 animate-fade-in">
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
                        className="group relative overflow-hidden border-2 border-border hover:border-primary hover:shadow-lg transition-all cursor-pointer bg-gradient-to-br from-primary/5 to-transparent"
                        onClick={() => {
                          setHasInsurance(true);
                          setShowUploadDialog(true);
                        }}
                      >
                        <div className="p-8 text-center space-y-4">
                          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-2">
                            <CheckCircle className="w-8 h-8 text-primary" />
                          </div>
                          <div>
                            <h5 className="text-lg font-semibold mb-2">Yes, I Have Insurance</h5>
                            <p className="text-sm text-muted-foreground">
                              Upload your current insurance certificate and we'll verify it instantly
                            </p>
                          </div>
                          <Button
                            className="w-full bg-primary hover:bg-primary/90"
                            size="lg"
                          >
                            <Upload className="mr-2 h-5 w-5" />
                            Upload Certificate
                          </Button>
                          <div className="pt-4 border-t border-border/50">
                            <p className="text-xs text-muted-foreground">
                              ✓ Instant AI verification<br/>
                              ✓ Accepted formats: PDF, JPG, PNG<br/>
                              ✓ Max file size: 5MB
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
                              ✓ Instant online quotes<br/>
                              ✓ Affordable rates<br/>
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
                    <div className="p-8">
                      <div className="flex items-start gap-6">
                        <div className="flex-shrink-0">
                          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                            <FileCheck className="w-8 h-8 text-primary" />
                          </div>
                        </div>
                        <div className="flex-1 space-y-4">
                          <div>
                            <h4 className="text-xl font-semibold text-foreground mb-2">
                              Documents Uploaded Successfully!
                            </h4>
                            <p className="text-muted-foreground">
                              Our team is reviewing your insurance certificate now.
                            </p>
                          </div>

                          {/* Upload Complete Progress */}
                          <div className="bg-gradient-to-br from-primary/5 to-transparent rounded-lg p-6 border-2 border-primary/20">
                            <div className="max-w-2xl mx-auto">
                              <div className="text-center space-y-6">
                                {/* Success Icon with animated background */}
                                <div className="relative inline-block mb-4">
                                  <div className="absolute inset-0 bg-primary/10 rounded-full blur-2xl animate-pulse"></div>
                                  <div className="relative">
                                    <CheckCircle className="h-16 w-16 mx-auto text-primary" />
                                  </div>
                                </div>

                                <h3 className="text-2xl md:text-3xl font-bold text-primary">
                                  Upload Complete!
                                </h3>

                                <p className="text-base md:text-lg text-muted-foreground max-w-lg mx-auto">
                                  Your insurance certificate is being reviewed by our team
                                </p>

                                {/* Progress Bar at 100% */}
                                <div className="space-y-3 pt-2">
                                  <div className="w-full bg-muted rounded-full h-3 overflow-hidden">
                                    <div className="bg-primary h-full w-full transition-all duration-500"></div>
                                  </div>
                                  <p className="text-sm font-medium text-primary">
                                    100% complete
                                  </p>

                                  {/* Subtle AI indicator */}
                                  <div className="flex items-center justify-center gap-2 pt-2">
                                    <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 border border-primary/20">
                                      <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></div>
                                      <span className="text-xs text-muted-foreground">AI-assisted verification</span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <CheckCircle className="w-4 h-4 text-primary" />
                            <span>You can continue with your booking</span>
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
                          <p className="text-xs text-muted-foreground">Max 5MB</p>
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

            {/* NO Path - Bonzah Instructions */}
            {hasInsurance === false && (
              <div className="max-w-3xl mx-auto">
                <Card className="overflow-hidden border-2 border-accent/30 bg-gradient-to-br from-accent/5 to-transparent">
                  <div className="p-8 md:p-10 space-y-8">
                    {/* Header */}
                    <div className="text-center space-y-4">
                      <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-accent/10">
                        <Shield className="w-10 h-10 text-accent" />
                      </div>
                      <div>
                        <h4 className="text-2xl font-bold mb-2">Get Instant Insurance Coverage</h4>
                        <p className="text-muted-foreground max-w-xl mx-auto">
                          Partner with Bonzah to get affordable, instant insurance coverage for your rental. Quick setup in just 5 minutes!
                        </p>
                      </div>
                    </div>

                    {/* How it works */}
                    <div className="bg-card/80 backdrop-blur rounded-xl p-6 md:p-8 border border-border/50">
                      <h5 className="text-lg font-semibold mb-6 text-center">How It Works</h5>
                      <div className="space-y-6">
                        <div className="flex gap-4">
                          <div className="flex-shrink-0">
                            <div className="w-10 h-10 rounded-full bg-accent text-accent-foreground flex items-center justify-center font-bold text-lg">
                              1
                            </div>
                          </div>
                          <div className="pt-1">
                            <h6 className="font-semibold mb-1">Get Instant Quote</h6>
                            <p className="text-sm text-muted-foreground">
                              Visit Bonzah's website and receive an instant quote tailored to your rental
                            </p>
                          </div>
                        </div>
                        <div className="flex gap-4">
                          <div className="flex-shrink-0">
                            <div className="w-10 h-10 rounded-full bg-accent text-accent-foreground flex items-center justify-center font-bold text-lg">
                              2
                            </div>
                          </div>
                          <div className="pt-1">
                            <h6 className="font-semibold mb-1">Purchase Online</h6>
                            <p className="text-sm text-muted-foreground">
                              Complete your purchase securely online in just a few minutes
                            </p>
                          </div>
                        </div>
                        <div className="flex gap-4">
                          <div className="flex-shrink-0">
                            <div className="w-10 h-10 rounded-full bg-accent text-accent-foreground flex items-center justify-center font-bold text-lg">
                              3
                            </div>
                          </div>
                          <div className="pt-1">
                            <h6 className="font-semibold mb-1">Upload or Continue</h6>
                            <p className="text-sm text-muted-foreground">
                              Upload your certificate here, or proceed with your booking and upload later
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* CTA */}
                    <div className="text-center space-y-4">
                      <a
                        href="https://bonzah.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-block w-full sm:w-auto"
                      >
                        <Button
                          size="lg"
                          className="bg-accent hover:bg-accent/90 px-8 w-full sm:w-auto"
                        >
                          <Shield className="mr-2 h-5 w-5" />
                          Get Insurance from Bonzah
                          <ChevronRight className="ml-2 h-5 w-5" />
                        </Button>
                      </a>
                      <div className="flex items-center justify-center gap-2">
                        <Button
                          onClick={() => setHasInsurance(null)}
                          variant="ghost"
                          size="sm"
                        >
                          Go Back
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground max-w-md mx-auto pt-4 border-t border-border/50">
                        <AlertCircle className="w-4 h-4 inline mr-1" />
                        You can upload your insurance certificate after completing your booking if you prefer
                      </p>
                    </div>
                  </div>
                </Card>
              </div>
            )}

            {/* Navigation */}
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
                disabled={hasInsurance === null}
                className="w-full sm:flex-1 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-md hover:shadow-lg transition-all disabled:opacity-50"
                size="lg"
              >
                Continue to Details <ChevronRight className="ml-2 w-5 h-5" />
              </Button>
            </div>
          </div>}

        {/* Step 4: Customer Details */}
        {currentStep === 4 && <div className="space-y-8 animate-fade-in">
            {/* Header with underline */}
            <div>
              <h3 className="text-2xl md:text-3xl font-display font-semibold text-foreground pb-2 border-b-2 border-primary/30">
                Your Details
              </h3>
            </div>

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
                    className={cn("h-12 focus-visible:ring-primary", verificationStatus === 'verified' && "bg-muted cursor-not-allowed")}
                    disabled={verificationStatus === 'verified'}
                  />
                  {verificationStatus === 'verified' && (
                    <p className="text-xs text-green-600 flex items-center gap-1">
                      <CheckCircle className="w-3 h-3" /> Verified from ID document
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
                    className="h-12 focus-visible:ring-primary"
                  />
                  {errors.customerEmail && <p className="text-sm text-destructive">{errors.customerEmail}</p>}
                </div>
              </div>

              {/* Row 2: Customer Phone & Type */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                <div className="space-y-2">
                  <Label htmlFor="customerPhone" className="font-medium">Phone Number *</Label>
                  <Input
                    id="customerPhone"
                    type="tel"
                    value={formData.customerPhone}
                    onChange={e => {
                      const value = e.target.value;
                      setFormData({
                        ...formData,
                        customerPhone: value
                      });
                      // Instant validation
                      validateField('customerPhone', value);
                    }}
                    placeholder="+1 (555) 123-4567"
                    className="h-12 focus-visible:ring-primary"
                  />
                  {errors.customerPhone && <p className="text-sm text-destructive">{errors.customerPhone}</p>}
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

              {/* Identity Verification Section */}
              <div className="border-t border-border/50 pt-6 sm:pt-8">
                <h4 className="text-base sm:text-lg font-semibold mb-2 flex items-center gap-2">
                  Identity Verification <span className="text-destructive">*</span>
                </h4>
                <p className="text-xs sm:text-sm text-muted-foreground mb-4">
                  <strong>Required:</strong> To ensure security and compliance, all customers must complete identity verification before proceeding with their rental.
                </p>

                {verificationStatus === 'init' && (
                  <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3 sm:p-4">
                    <div className="flex items-start gap-2 sm:gap-3">
                      <AlertCircle className="w-5 h-5 text-destructive mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium mb-2 text-destructive">Verification Required</p>
                        <p className="text-xs sm:text-sm text-muted-foreground mb-4">
                          <strong>You must verify your identity to continue.</strong> Please fill in your details above, then click the button below to start the verification process.
                        </p>
                        <Button
                          onClick={handleStartVerification}
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
                      </div>
                    </div>
                  </div>
                )}

                {verificationStatus === 'verified' && (
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
                          onClick={handleStartVerification}
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
                onClick={() => setCurrentStep(3)}
                variant="outline"
                className="w-full sm:flex-1 h-11 sm:h-12 border-primary text-primary hover:bg-primary/10 font-semibold text-sm sm:text-base"
                size="lg"
              >
                <ChevronLeft className="mr-2 w-4 h-4 sm:w-5 sm:h-5" /> Back
              </Button>
              <Button
                onClick={handleStep4Continue}
                disabled={verificationStatus !== 'verified'}
                className="w-full sm:flex-1 h-11 sm:h-12 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-sm sm:text-base shadow-md hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                size="lg"
              >
                <span className="sm:hidden">Continue</span>
                <span className="hidden sm:inline">Continue to Review</span>
                <ChevronRight className="ml-2 w-4 h-4 sm:w-5 sm:h-5" />
              </Button>
            </div>
            {verificationStatus !== 'verified' && (
              <p className="text-xs sm:text-sm text-destructive text-center mt-2">
                Please complete identity verification to continue
              </p>
            )}
          </div>}

        {/* Step 5: Review & Payment */}
        {currentStep === 5 && <div className="animate-fade-in">
            <BookingCheckoutStep
              formData={formData}
              selectedVehicle={selectedVehicle}
              extras={extras}
              rentalDuration={calculateRentalDuration() || {
                days: 1,
                formatted: '1 day'
              }}
              vehicleTotal={estimatedBooking?.total || 0}
              onBack={() => setCurrentStep(4)}
            />
          </div>}

      </div>
    </Card>

    {/* Insurance Upload Dialog */}
    <InsuranceUploadDialog
      open={showUploadDialog}
      onOpenChange={setShowUploadDialog}
      onUploadComplete={async (documentId) => {
        // documentId is the database record ID
        setUploadedDocumentId(documentId);
        setScanningDocument(true);
        setShowUploadDialog(false);

        // Trigger document review
        try {
          const { error } = await supabase.functions.invoke('scan-insurance-document', {
            body: { documentId, fileUrl: documentId }
          });

          if (error) {
            console.error('Document review error:', error);
            toast.error("Document uploaded but review failed. You can continue with your booking.");
          } else {
            toast.success("Insurance document uploaded! Our team is reviewing it now...");
          }
        } catch (error) {
          console.error('Document review error:', error);
          toast.error("Document uploaded but review failed. You can continue with your booking.");
        } finally {
          setScanningDocument(false);
        }
      }}
    />
    </>;
};
export default MultiStepBookingWidget;