'use client'

import { useState, useEffect } from "react"
import { format, addDays } from "date-fns"
import { Bug, X, Zap, RotateCcw, CheckCircle, AlertCircle, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

// Only render in development
const IS_DEV = process.env.NODE_ENV === 'development'

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
  customerName: "Test User",
  customerEmail: "test@example.com",
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

// Custom event name for dev panel communication
export const DEV_JUMP_EVENT = 'dev-jump-to-step'

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
      const { supabase } = await import("@/integrations/supabase/client")
      const { data: vehicles } = await supabase
        .from("vehicles")
        .select("id")
        .eq("status", "Available")
        .limit(1)

      if (vehicles && vehicles.length > 0) {
        return vehicles[0].id
      }
      return null
    } catch (error) {
      console.error("Failed to fetch vehicle:", error)
      return null
    }
  }

  const jumpToStep = async (step: WidgetStep) => {
    setIsLoading(step.number)

    try {
      // For steps 2+, we need a vehicle ID
      let vehicleId: string | null = null
      if (step.number >= 2) {
        vehicleId = await fetchFirstAvailableVehicle()
        if (!vehicleId && step.number >= 3) {
          alert("No available vehicles found. Add a vehicle with status 'Available' first.")
          setIsLoading(null)
          return
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
          setInsuranceVerified: step.number >= 4,
        }
      })

      window.dispatchEvent(event)
      console.log(`🔧 DEV: Jumping to step ${step.number}`, { vehicleId })

      setIsMinimized(true)
    } finally {
      setIsLoading(null)
    }
  }

  const clearAllData = () => {
    const keysToRemove = [
      "booking_context",
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
    ]
    keysToRemove.forEach(key => localStorage.removeItem(key))

    // Dispatch reset event
    window.dispatchEvent(new CustomEvent(DEV_JUMP_EVENT, {
      detail: { step: 1, formData: MOCK_WIDGET_FORM_DATA, vehicleId: null, setVerified: false, setInsuranceVerified: false }
    }))
  }

  const setVerificationState = (verified: boolean) => {
    if (verified) {
      localStorage.setItem("verificationSessionId", "dev-mock-session-" + Date.now())
      localStorage.setItem("verificationStatus", "verified")
      localStorage.setItem("verificationTimestamp", Date.now().toString())
      localStorage.setItem("verifiedCustomerName", MOCK_WIDGET_FORM_DATA.customerName)
      localStorage.setItem("verifiedLicenseNumber", MOCK_WIDGET_FORM_DATA.licenseNumber)
    } else {
      localStorage.removeItem("verificationSessionId")
      localStorage.removeItem("verificationStatus")
      localStorage.removeItem("verificationTimestamp")
      localStorage.removeItem("verifiedCustomerName")
      localStorage.removeItem("verifiedLicenseNumber")
    }

    // Dispatch event to update widget state
    window.dispatchEvent(new CustomEvent('dev-set-verification', { detail: { verified } }))
  }

  // Minimized: small floating button
  if (isMinimized) {
    return (
      <button
        onClick={() => setIsMinimized(false)}
        className="fixed bottom-4 right-4 z-[9999] bg-orange-500 hover:bg-orange-600 text-white p-3 rounded-full shadow-lg transition-all hover:scale-110"
        title="Dev Panel (Ctrl+Shift+D)"
      >
        <Bug className="w-5 h-5" />
      </button>
    )
  }

  return (
    <Card className="fixed bottom-4 right-4 z-[9999] w-80 shadow-2xl border-orange-500/50 bg-background/95 backdrop-blur">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-orange-500/30 bg-orange-500/10">
        <div className="flex items-center gap-2">
          <Bug className="w-4 h-4 text-orange-500" />
          <span className="font-semibold text-sm">Dev Panel</span>
          <Badge variant="outline" className="text-[10px] px-1 py-0 border-orange-500/50 text-orange-500">
            DEV
          </Badge>
        </div>
        <button onClick={() => setIsMinimized(true)} className="text-muted-foreground hover:text-foreground">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Steps */}
      <div className="p-3 space-y-2">
        <p className="text-xs text-muted-foreground mb-3">
          Jump to any step instantly. <kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">Ctrl+Shift+D</kbd>
        </p>

        {WIDGET_STEPS.map((step) => (
          <button
            key={step.number}
            onClick={() => jumpToStep(step)}
            disabled={isLoading !== null}
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
              <p className="text-[10px] text-muted-foreground">{step.description}</p>
            </div>
            <Zap className="w-3 h-3 text-orange-500 opacity-0 group-hover:opacity-100" />
          </button>
        ))}

        {/* Quick Actions */}
        <div className="border-t border-border pt-3 mt-3 space-y-2">
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
          <Button variant="outline" size="sm" className="w-full text-xs h-7" onClick={clearAllData}>
            <RotateCcw className="w-3 h-3 mr-1" />
            Reset All
          </Button>
        </div>
      </div>
    </Card>
  )
}
