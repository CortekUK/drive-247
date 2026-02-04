'use client'

import { useState, useEffect } from "react"
import { format, addDays } from "date-fns"
import { Bug, X, Zap, RotateCcw, CheckCircle, AlertCircle, Loader2, Shield, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { supabase } from "@/integrations/supabase/client"
import { toast } from "sonner"
import { useBookingStore } from "@/stores/booking-store"

// Only render in development
const IS_DEV = process.env.NODE_ENV === 'development'

// Sample insurance image path (relative to public folder)
const SAMPLE_INSURANCE_PATH = '/helper-folder/Sample_insurance.png'

// Mock data for widget form
const MOCK_WIDGET_FORM_DATA = {
  pickupLocation: "123 Main St, Los Angeles, CA 90001",
  dropoffLocation: "123 Main St, Los Angeles, CA 90001",
  pickupLocationId: "",
  returnLocationId: "",
  pickupDate: format(addDays(new Date(), 7), "yyyy-MM-dd"),
  dropoffDate: format(addDays(new Date(), 37), "yyyy-MM-dd"),
  pickupTime: "10:00",
  dropoffTime: "10:00",
  specialRequests: "",
  vehicleId: "",
  driverDOB: format(new Date(1990, 5, 15), "yyyy-MM-dd"),
  promoCode: "",
  customerName: "Ghulam Mohiuddin",
  customerEmail: "ilyasghulam35@gmail.com",
  customerPhone: "+15551234567",
  customerType: "Individual",
  licenseNumber: "DL123456789",
  verificationSessionId: "",
}

interface WidgetStep {
  number: number
  name: string
  description: string
}

const WIDGET_STEPS: WidgetStep[] = [
  { number: 1, name: "Rental Details", description: "Dates & locations" },
  { number: 2, name: "Vehicle Selection", description: "Choose vehicle" },
  { number: 3, name: "Insurance", description: "Upload certificate" },
  { number: 4, name: "Customer Details", description: "Your information" },
  { number: 5, name: "Review & Pay", description: "Final review" },
]

// Custom event names for dev panel communication
export const DEV_JUMP_EVENT = 'dev-jump-to-step'
export const DEV_UPLOAD_INSURANCE_EVENT = 'dev-upload-insurance'

export interface DevJumpEventDetail {
  step: number
  formData: typeof MOCK_WIDGET_FORM_DATA
  vehicleId: string | null
  setVerified: boolean
  setInsuranceVerified: boolean
}

export default function DevJumpPanel() {
  const [isMinimized, setIsMinimized] = useState(true)
  const [isLoading, setIsLoading] = useState<number | null>(null)
  const [isUploadingInsurance, setIsUploadingInsurance] = useState(false)
  const { clearContext: clearBookingStore, addPendingInsuranceFile } = useBookingStore()

  // Don't render anything in production
  if (!IS_DEV) {
    return null
  }

  // Keyboard shortcut: Ctrl+Shift+D to toggle panel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'D') {
        e.preventDefault()
        setIsMinimized(prev => !prev)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const fetchFirstAvailableVehicle = async (): Promise<string | null> => {
    try {
      // Get tenant from localStorage (same as booking widget uses)
      const tenantData = localStorage.getItem('tenant')
      let tenantId: string | null = null

      if (tenantData) {
        try {
          const tenant = JSON.parse(tenantData)
          tenantId = tenant?.id
        } catch (e) {
          console.warn('Failed to parse tenant data:', e)
        }
      }

      // Build query matching the booking widget's vehicle fetch
      let query = supabase
        .from("vehicles")
        .select("id, make, model")
        .or("status.ilike.Available,status.ilike.available")
        .limit(1)

      // Apply tenant filter if available
      if (tenantId) {
        query = query.eq("tenant_id", tenantId)
      }

      const { data: vehicles, error } = await query

      if (error) {
        console.error("Vehicle fetch error:", error)
        return null
      }

      if (vehicles && vehicles.length > 0) {
        const vehicle = vehicles[0]
        console.log('🔧 DEV: Selected vehicle:', vehicle.id, vehicle.make, vehicle.model)
        return vehicles[0].id
      }
      return null
    } catch (error) {
      console.error("Failed to fetch vehicle:", error)
      return null
    }
  }

  // Upload sample insurance to Supabase storage and create document record
  const uploadSampleInsurance = async (): Promise<{ documentId: string; fileUrl: string } | null> => {
    setIsUploadingInsurance(true)
    console.log('🔧 DEV: Starting sample insurance upload to Supabase...')

    try {
      // Fetch the sample insurance image from public folder
      const response = await fetch(SAMPLE_INSURANCE_PATH)
      if (!response.ok) {
        throw new Error(`Failed to fetch sample insurance: ${response.statusText}`)
      }

      const blob = await response.blob()
      const file = new File([blob], 'Sample_insurance.png', { type: 'image/png' })
      const fileName = `dev-${Date.now()}-Sample_insurance.png`
      const filePath = `insurance/${fileName}`

      // Upload to Supabase Storage
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('customer-documents')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false
        })

      if (uploadError) {
        console.error('Upload error:', uploadError)
        throw new Error(`Storage upload failed: ${uploadError.message}`)
      }

      console.log('🔧 DEV: File uploaded to storage:', filePath)

      // Create a temporary customer record
      const uniqueEmail = `dev-${Date.now()}-${Math.random().toString(36).substring(7)}@temp.booking`
      const { data: tempCustomer, error: customerError } = await supabase
        .from('customers')
        .insert({
          name: MOCK_WIDGET_FORM_DATA.customerName,
          email: uniqueEmail,
          phone: MOCK_WIDGET_FORM_DATA.customerPhone,
          type: 'Individual'
        })
        .select()
        .single()

      if (customerError) {
        console.error('Customer create error:', customerError)
        throw new Error(`Failed to create temp customer: ${customerError.message}`)
      }

      // Create customer_documents record
      const { data: docData, error: docError } = await supabase
        .from('customer_documents')
        .insert({
          customer_id: tempCustomer.id,
          document_type: 'Insurance Certificate',
          document_name: 'Sample_insurance.png',
          file_url: filePath,
          file_name: 'Sample_insurance.png',
          file_size: file.size,
          mime_type: 'image/png',
          ai_scan_status: 'completed', // Valid values: pending, processing, completed, failed
          uploaded_at: new Date().toISOString()
        })
        .select()
        .single()

      if (docError) {
        console.error('Document create error:', docError)
        throw new Error(`Failed to create document: ${docError.message}`)
      }

      console.log('🔧 DEV: Document record created:', docData.id)

      // Store in localStorage for legacy cleanup logic (temp customer removal)
      const tempDocInfo = {
        temp_customer_id: tempCustomer.id,
        document_id: docData.id,
        file_url: filePath
      }
      localStorage.setItem('pending_insurance_docs', JSON.stringify([tempDocInfo]))

      // Also add to Zustand store for the new flow
      addPendingInsuranceFile({
        file_path: filePath,
        file_name: 'Sample_insurance.png',
        file_size: file.size,
        mime_type: 'image/png',
        uploaded_at: new Date().toISOString()
      })

      toast.success('✓ Sample insurance uploaded & verified!')
      return { documentId: docData.id, fileUrl: filePath }

    } catch (error: any) {
      console.error('🔧 DEV: Failed to upload sample insurance:', error)
      toast.error(`Insurance upload failed: ${error.message}`)
      return null
    } finally {
      setIsUploadingInsurance(false)
    }
  }

  const jumpToStep = async (step: WidgetStep) => {
    setIsLoading(step.number)

    try {
      // For steps 2+, we need a vehicle ID
      let vehicleId: string | null = null
      if (step.number >= 2) {
        vehicleId = await fetchFirstAvailableVehicle()
        if (!vehicleId) {
          toast.error("No available vehicles found. Add a vehicle with status 'Available' first.")
          setIsLoading(null)
          return
        }
        toast.success(`Vehicle selected: ${vehicleId.substring(0, 8)}...`)
      }

      // For Insurance step (3), also upload the sample insurance
      let insuranceUploaded = false
      if (step.number === 3) {
        const result = await uploadSampleInsurance()
        if (result) {
          insuranceUploaded = true
          // Dispatch event to update widget state with actual document ID
          window.dispatchEvent(new CustomEvent('dev-set-insurance', {
            detail: {
              verified: true,
              documentId: result.documentId
            }
          }))
        }
      }

      // Dispatch custom event that the widget listens to
      const event = new CustomEvent<DevJumpEventDetail>(DEV_JUMP_EVENT, {
        detail: {
          step: step.number,
          formData: {
            ...MOCK_WIDGET_FORM_DATA,
            vehicleId: vehicleId || "",
          },
          vehicleId,
          setVerified: step.number >= 5,
          setInsuranceVerified: step.number >= 4 || insuranceUploaded,
        }
      })

      window.dispatchEvent(event)
      console.log(`🔧 DEV: Jumping to step ${step.number}`, { vehicleId, insuranceUploaded })

      setIsMinimized(true)
    } finally {
      setIsLoading(null)
    }
  }

  const handleUploadInsuranceOnly = async () => {
    const result = await uploadSampleInsurance()
    if (result) {
      // Dispatch event to update widget state
      window.dispatchEvent(new CustomEvent('dev-set-insurance', {
        detail: {
          verified: true,
          documentId: result.documentId
        }
      }))
    }
  }

  const setInsuranceVerified = () => {
    // Mark insurance as verified without actual upload
    localStorage.setItem('dev_insurance_verified', 'true')

    window.dispatchEvent(new CustomEvent('dev-set-insurance', {
      detail: {
        verified: true,
        documentId: 'dev-mock-insurance-' + Date.now()
      }
    }))

    toast.success('Insurance marked as verified (no upload)')
    console.log('🔧 DEV: Insurance marked as verified')
  }

  const clearAllData = () => {
    // Clear Zustand store
    clearBookingStore()

    // Clear localStorage keys (keeping for backward compatibility and other dev data)
    const keysToRemove = [
      "verificationSessionId",
      "verificationStatus",
      "verificationTimestamp",
      "verificationToken",
      "verifiedCustomerName",
      "verifiedLicenseNumber",
      "verificationVendorData",
      "dev_last_vehicle_id",
      "dev_widget_step",
      "dev_widget_form_data",
      "dev_insurance_verified",
      "pending_insurance_docs",
      "booking_form_data",
      "booking_current_step",
      "booking_selected_extras",
    ]
    keysToRemove.forEach(key => localStorage.removeItem(key))
    sessionStorage.clear()

    window.dispatchEvent(new CustomEvent(DEV_JUMP_EVENT, {
      detail: { step: 1, formData: MOCK_WIDGET_FORM_DATA, vehicleId: null, setVerified: false, setInsuranceVerified: false }
    }))

    window.location.reload()
  }

  const setVerificationState = (verified: boolean) => {
    if (verified) {
      localStorage.setItem("verificationSessionId", "dev-mock-session-" + Date.now())
      localStorage.setItem("verificationStatus", "verified")
      localStorage.setItem("verificationTimestamp", Date.now().toString())
      localStorage.setItem("verifiedCustomerName", MOCK_WIDGET_FORM_DATA.customerName)
      localStorage.setItem("verifiedLicenseNumber", MOCK_WIDGET_FORM_DATA.licenseNumber)
      toast.success('Identity marked as verified')
    } else {
      localStorage.removeItem("verificationSessionId")
      localStorage.removeItem("verificationStatus")
      localStorage.removeItem("verificationTimestamp")
      localStorage.removeItem("verifiedCustomerName")
      localStorage.removeItem("verifiedLicenseNumber")
      toast.info('Verification cleared')
    }

    window.dispatchEvent(new CustomEvent('dev-set-verification', { detail: { verified } }))
  }

  // Minimized: small floating button
  if (isMinimized) {
    return (
      <button
        onClick={() => setIsMinimized(false)}
        className="fixed top-20 right-4 z-[50] bg-orange-500 hover:bg-orange-600 text-white p-3 rounded-full shadow-lg transition-all hover:scale-110"
        title="Dev Panel (Ctrl+Shift+D)"
      >
        <Bug className="w-5 h-5" />
      </button>
    )
  }

  return (
    <Card className="fixed top-20 right-4 z-[50] w-80 shadow-2xl border-orange-500/50 bg-background/95 backdrop-blur max-h-[75vh] overflow-y-auto scrollbar-none [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-orange-500/30 bg-orange-500/10 sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <Bug className="w-4 h-4 text-orange-500" />
          <span className="font-semibold text-sm">Dev Panel</span>
          <Badge variant="outline" className="text-[10px] px-1 py-0 border-orange-500/50 text-orange-500">
            BOOKING
          </Badge>
        </div>
        <button onClick={() => setIsMinimized(true)} className="text-muted-foreground hover:text-foreground">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Steps */}
      <div className="p-3 space-y-2">
        <p className="text-xs text-muted-foreground mb-3">
          Click any step to jump + auto-fill. <kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">Ctrl+Shift+D</kbd>
        </p>

        {WIDGET_STEPS.map((step) => (
          <button
            key={step.number}
            onClick={() => jumpToStep(step)}
            disabled={isLoading !== null || isUploadingInsurance}
            className="w-full flex items-center gap-3 p-2 rounded-lg border border-border hover:border-orange-500/50 hover:bg-orange-500/5 transition-all text-left group disabled:opacity-50"
          >
            <div className="flex items-center justify-center w-7 h-7 rounded-full bg-orange-500/20 text-orange-500 font-bold text-sm">
              {isLoading === step.number ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                step.number
              )}
            </div>
            <div className="flex-1 min-w-0">
              <span className="font-medium text-sm">{step.name}</span>
              <p className="text-[10px] text-muted-foreground">
                {step.number === 3 ? "Auto-uploads sample insurance" : step.description}
              </p>
            </div>
            <Zap className="w-3 h-3 text-orange-500 opacity-0 group-hover:opacity-100" />
          </button>
        ))}

        {/* Insurance Actions */}
        <div className="border-t border-border pt-3 mt-3 space-y-2">
          <p className="text-xs text-muted-foreground font-medium">Insurance Actions</p>
          <Button
            variant="outline"
            size="sm"
            className="w-full text-xs h-8"
            onClick={handleUploadInsuranceOnly}
            disabled={isUploadingInsurance}
          >
            {isUploadingInsurance ? (
              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
            ) : (
              <Upload className="w-3 h-3 mr-1 text-blue-500" />
            )}
            Upload Sample to Supabase
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="w-full text-xs h-8"
            onClick={setInsuranceVerified}
          >
            <Shield className="w-3 h-3 mr-1 text-green-500" />
            Skip (Mark Verified Only)
          </Button>
        </div>

        {/* Verification Actions */}
        <div className="border-t border-border pt-3 mt-3 space-y-2">
          <p className="text-xs text-muted-foreground font-medium">Identity Verification</p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => setVerificationState(true)}>
              <CheckCircle className="w-3 h-3 mr-1 text-green-500" />
              Set Verified
            </Button>
            <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => setVerificationState(false)}>
              <AlertCircle className="w-3 h-3 mr-1 text-red-500" />
              Clear
            </Button>
          </div>
        </div>

        {/* Reset */}
        <div className="border-t border-border pt-3 mt-3">
          <Button variant="outline" size="sm" className="w-full text-xs h-7" onClick={clearAllData}>
            <RotateCcw className="w-3 h-3 mr-1" />
            Reset All & Reload
          </Button>
        </div>
      </div>
    </Card>
  )
}
