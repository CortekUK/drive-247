'use client'

import { useState, useEffect } from "react"
import { Bug, X, Zap, RotateCcw, LogIn, UserPlus, Users, Car, Settings, LayoutDashboard, ChevronDown, ChevronRight, FileText, Loader2, AlertTriangle, DollarSign } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useRouter, usePathname } from "next/navigation"
import { supabase } from "@/integrations/supabase/client"
import { useTenant } from "@/contexts/TenantContext"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { addMonths, format } from "date-fns"

// Only render in development
const IS_DEV = process.env.NODE_ENV === 'development'

// Mock data for form automation
const MOCK_DATA = {
    name: "Ghulam Mohiuddin",
    email: "ilyasghulam35@gmail.com",
    phone: "+15551234567",
    license_number: "DL123456789",
    id_number: "ID987654321",
    password: "TestPassword123!",
}

// List of vehicle options for random selection
const VEHICLE_OPTIONS = [
    { make: "Toyota", model: "Camry", colour: "White" },
    { make: "Honda", model: "Civic", colour: "Silver" },
    { make: "Ford", model: "Focus", colour: "Blue" },
    { make: "BMW", model: "3 Series", colour: "Black" },
    { make: "Mercedes", model: "C-Class", colour: "Grey" },
    { make: "Audi", model: "A4", colour: "Red" },
    { make: "Volkswagen", model: "Golf", colour: "White" },
    { make: "Hyundai", model: "Tucson", colour: "Silver" },
    { make: "Kia", model: "Sportage", colour: "Blue" },
    { make: "Nissan", model: "Altima", colour: "Black" },
    { make: "Mazda", model: "CX-5", colour: "Red" },
    { make: "Chevrolet", model: "Malibu", colour: "White" },
]

// Generate random vehicle data
const generateRandomVehicleData = () => {
    const randomVehicle = VEHICLE_OPTIONS[Math.floor(Math.random() * VEHICLE_OPTIONS.length)]
    const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase()
    const randomYear = 2020 + Math.floor(Math.random() * 5) // 2020-2024
    const randomVinSuffix = Math.random().toString(36).substring(2, 10).toUpperCase()

    return {
        reg: `DEV-${randomSuffix}`,
        vin: `1HGBH41JXMN${randomVinSuffix}`,
        make: randomVehicle.make,
        model: randomVehicle.model,
        year: randomYear,
        colour: randomVehicle.colour,
        fuel_type: "Petrol" as const,
        purchase_price: 25000 + Math.floor(Math.random() * 20000), // $25k-$45k
        daily_rent: 40 + Math.floor(Math.random() * 30), // $40-$70
        weekly_rent: 250 + Math.floor(Math.random() * 100), // $250-$350
        monthly_rent: 800 + Math.floor(Math.random() * 400), // $800-$1200
        acquisition_type: "Purchase" as const,
        description: `Dev test vehicle - ${randomVehicle.make} ${randomVehicle.model} auto-generated`,
    }
}

// Custom event for filling customer form
export const DEV_FILL_CUSTOMER_FORM_EVENT = 'dev-fill-customer-form'
// Custom event for filling rental form
export const DEV_FILL_RENTAL_FORM_EVENT = 'dev-fill-rental-form'
// Custom event for filling vehicle form
export const DEV_FILL_VEHICLE_FORM_EVENT = 'dev-fill-vehicle-form'
// Custom event for filling fine form
export const DEV_FILL_FINE_FORM_EVENT = 'dev-fill-fine-form'
// Custom event for filling payment form
export const DEV_FILL_PAYMENT_FORM_EVENT = 'dev-fill-payment-form'

interface QuickNavItem {
    name: string
    path: string
    icon: React.ReactNode
}

const QUICK_NAV_ITEMS: QuickNavItem[] = [
    { name: "Dashboard", path: "/", icon: <LayoutDashboard className="w-3 h-3" /> },
    { name: "Customers", path: "/customers", icon: <Users className="w-3 h-3" /> },
    { name: "Vehicles", path: "/vehicles", icon: <Car className="w-3 h-3" /> },
    { name: "Rentals", path: "/rentals", icon: <FileText className="w-3 h-3" /> },
    { name: "Settings", path: "/settings", icon: <Settings className="w-3 h-3" /> },
]

export default function DevPanel() {
    const [isMinimized, setIsMinimized] = useState(true)
    const [expandedSection, setExpandedSection] = useState<string | null>(null)
    const [isLoadingRental, setIsLoadingRental] = useState(false)
    const [isLoadingVehicle, setIsLoadingVehicle] = useState(false)
    const [isLoadingFine, setIsLoadingFine] = useState(false)
    const [isLoadingPayment, setIsLoadingPayment] = useState(false)
    const [isLoadingCustomer, setIsLoadingCustomer] = useState(false)
    const router = useRouter()
    const pathname = usePathname()
    const { tenant } = useTenant()
    const queryClient = useQueryClient()

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

    const fillLoginForm = () => {
        // Find and fill email field
        const emailInput = document.querySelector('input[type="email"], input[name="email"]') as HTMLInputElement
        if (emailInput) {
            emailInput.value = MOCK_DATA.email
            emailInput.dispatchEvent(new Event('input', { bubbles: true }))
            emailInput.dispatchEvent(new Event('change', { bubbles: true }))
        }

        // Find and fill password field
        const passwordInput = document.querySelector('input[type="password"], input[name="password"]') as HTMLInputElement
        if (passwordInput) {
            passwordInput.value = MOCK_DATA.password
            passwordInput.dispatchEvent(new Event('input', { bubbles: true }))
            passwordInput.dispatchEvent(new Event('change', { bubbles: true }))
        }

        toast.success('Login form filled')
        console.log('🔧 DEV: Login form filled')
    }

    const createCustomer = async () => {
        setIsLoadingCustomer(true)
        console.log('🔧 DEV: Creating customer and filling form...')

        try {
            const tenantId = tenant?.id
            if (!tenantId) {
                toast.error('Tenant not found. Please wait for page to fully load.')
                return
            }

            // Generate unique customer data using mock data plus random suffix
            const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase()
            const timestamp = Date.now()
            const customerData = {
                customer_type: 'Individual' as const,
                name: `${MOCK_DATA.name} ${randomSuffix}`, // Make name unique
                email: `dev.${timestamp}@test.com`, // Unique email per creation
                phone: `+1${Math.floor(Math.random() * 9000000000) + 1000000000}`, // Random phone
                license_number: `DL${randomSuffix}${Math.floor(Math.random() * 100000)}`,
                id_number: `ID${randomSuffix}${Math.floor(Math.random() * 100000)}`,
                status: 'Active' as const,
                whatsapp_opt_in: true,
                high_switcher: false,
            }

            // Insert customer directly into Supabase
            const { data: insertedCustomer, error } = await supabase
                .from('customers')
                .insert({
                    customer_type: customerData.customer_type,
                    type: customerData.customer_type, // Required field in database
                    name: customerData.name,
                    email: customerData.email,
                    phone: customerData.phone,
                    license_number: customerData.license_number,
                    id_number: customerData.id_number,
                    status: customerData.status,
                    whatsapp_opt_in: customerData.whatsapp_opt_in,
                    high_switcher: customerData.high_switcher,
                    tenant_id: tenantId,
                })
                .select()
                .single()

            if (error) {
                console.error('🔧 DEV: Customer insert error:', JSON.stringify(error, null, 2))
                toast.error(`Failed to create customer: ${error.message || error.code || 'Unknown error'}`)
                return
            }

            console.log('🔧 DEV: Customer created:', insertedCustomer)

            // Navigate to customers page first if not there, then dispatch event
            if (pathname === '/customers') {
                const event = new CustomEvent(DEV_FILL_CUSTOMER_FORM_EVENT, {
                    detail: customerData
                })
                window.dispatchEvent(event)
            } else {
                router.push('/customers')
                setTimeout(() => {
                    const event = new CustomEvent(DEV_FILL_CUSTOMER_FORM_EVENT, {
                        detail: customerData
                    })
                    window.dispatchEvent(event)
                }, 1000)
            }

            toast.success(`✓ Customer created: ${customerData.name}`)

            // Invalidate customer queries to refresh the list
            await queryClient.invalidateQueries({
                predicate: (query) => {
                    const key = query.queryKey[0]
                    return key === 'customers' || key === 'customers-list' || key === 'customer-count'
                }
            })

        } catch (error: any) {
            console.error('🔧 DEV: Customer creation error:', error)
            toast.error(`Customer creation failed: ${error.message}`)
        } finally {
            setIsLoadingCustomer(false)
        }
    }

    const createVehicle = async () => {
        setIsLoadingVehicle(true)
        console.log('🔧 DEV: Creating vehicle directly in database...')

        try {
            const tenantId = tenant?.id
            if (!tenantId) {
                toast.error('Tenant not found. Please wait for page to fully load.')
                return
            }

            // Generate random vehicle data
            const vehicleData = generateRandomVehicleData()

            // Insert directly into Supabase
            const { data: insertedVehicle, error } = await supabase
                .from('vehicles')
                .insert({
                    reg: vehicleData.reg,
                    vin: vehicleData.vin,
                    make: vehicleData.make,
                    model: vehicleData.model,
                    year: vehicleData.year,
                    colour: vehicleData.colour,
                    fuel_type: vehicleData.fuel_type,
                    purchase_price: vehicleData.purchase_price,
                    daily_rent: vehicleData.daily_rent,
                    weekly_rent: vehicleData.weekly_rent,
                    monthly_rent: vehicleData.monthly_rent,
                    acquisition_type: vehicleData.acquisition_type,
                    acquisition_date: new Date().toISOString().split('T')[0],
                    description: vehicleData.description,
                    status: 'Available',
                    tenant_id: tenantId,
                })
                .select()
                .single()

            if (error) {
                console.error('🔧 DEV: Vehicle insert error:', error)
                toast.error(`Failed to create vehicle: ${error.message}`)
                return
            }

            console.log('🔧 DEV: Vehicle created:', insertedVehicle)
            toast.success(`✓ Vehicle created: ${vehicleData.make} ${vehicleData.model} (${vehicleData.reg})`)

            // Invalidate vehicle queries to refresh the list
            // Use predicate to match queries that start with these keys (includes tenant ID variants)
            await queryClient.invalidateQueries({
                predicate: (query) => {
                    const key = query.queryKey[0]
                    return key === 'vehicles-list' || key === 'vehicles-pl' || key === 'vehicle-count'
                }
            })

        } catch (error: any) {
            console.error('🔧 DEV: Vehicle creation error:', error)
            toast.error(`Vehicle creation failed: ${error.message}`)
        } finally {
            setIsLoadingVehicle(false)
        }
    }

    const createFine = async () => {
        setIsLoadingFine(true)
        console.log('🔧 DEV: Creating fine and filling form...')

        try {
            const tenantId = tenant?.id
            if (!tenantId) {
                toast.error('Tenant not found. Please wait for page to fully load.')
                return
            }

            // First try to find the specific mock customer by email
            let customer: { id: string; name: string } | null = null
            const { data: mockCustomer } = await supabase
                .from('customers')
                .select('id, name')
                .eq('tenant_id', tenantId)
                .eq('email', MOCK_DATA.email) // ilyasghulam35@gmail.com
                .eq('status', 'Active')
                .limit(1)
                .single()

            if (mockCustomer) {
                customer = mockCustomer
                console.log('🔧 DEV: Found mock customer:', customer.name)
            } else {
                // Fallback: Fetch first available customer
                const { data: customers, error: customerError } = await supabase
                    .from('customers')
                    .select('id, name')
                    .eq('tenant_id', tenantId)
                    .eq('status', 'Active')
                    .limit(1)

                if (customerError || !customers?.length) {
                    toast.error('No active customers found. Create a customer first.')
                    return
                }
                customer = customers[0]
                console.log('🔧 DEV: Using fallback customer:', customer.name)
            }

            // Fetch first available vehicle
            const { data: vehicles, error: vehicleError } = await supabase
                .from('vehicles')
                .select('id, reg, make, model')
                .eq('tenant_id', tenantId)
                .limit(1)

            if (vehicleError || !vehicles?.length) {
                toast.error('No vehicles found. Create a vehicle first.')
                return
            }

            const vehicle = vehicles[0]

            // Generate random fine data
            const fineTypes = ['PCN', 'Speeding', 'Other'] as const
            const randomType = fineTypes[Math.floor(Math.random() * fineTypes.length)]
            const randomAmount = 50 + Math.floor(Math.random() * 200) // $50-$250
            const randomRef = `DEV-${Math.random().toString(36).substring(2, 8).toUpperCase()}`
            const issueDate = new Date()
            const dueDate = new Date(issueDate.getTime() + 28 * 24 * 60 * 60 * 1000) // +28 days
            const notes = `Dev test fine - auto-generated for ${vehicle.make} ${vehicle.model}`

            // Prepare fine data for both insert and form fill
            const fineData = {
                type: randomType,
                vehicle_id: vehicle.id,
                customer_id: customer.id,
                reference_no: randomRef,
                issue_date: issueDate,
                due_date: dueDate,
                amount: randomAmount,
                liability: 'Customer' as const,
                notes: notes,
                // Extra data for form display
                customer_name: customer.name,
                vehicle_reg: vehicle.reg,
                vehicle_make: vehicle.make,
                vehicle_model: vehicle.model,
            }

            // Insert fine directly into Supabase
            const { data: insertedFine, error } = await supabase
                .from('fines')
                .insert({
                    type: fineData.type,
                    vehicle_id: fineData.vehicle_id,
                    customer_id: fineData.customer_id,
                    reference_no: fineData.reference_no,
                    issue_date: issueDate.toISOString().split('T')[0],
                    due_date: dueDate.toISOString().split('T')[0],
                    amount: fineData.amount,
                    liability: fineData.liability,
                    notes: fineData.notes,
                    status: 'Open',
                    tenant_id: tenantId,
                })
                .select()
                .single()

            if (error) {
                console.error('🔧 DEV: Fine insert error:', error)
                toast.error(`Failed to create fine: ${error.message}`)
                return
            }

            console.log('🔧 DEV: Fine created:', insertedFine)

            // Navigate to fines/new page first if not there, then dispatch event
            if (pathname === '/fines/new') {
                // Already on fines/new page, dispatch event to fill form
                const event = new CustomEvent(DEV_FILL_FINE_FORM_EVENT, {
                    detail: fineData
                })
                window.dispatchEvent(event)
            } else {
                // Navigate to fines/new and dispatch event after navigation
                router.push('/fines/new')
                setTimeout(() => {
                    const event = new CustomEvent(DEV_FILL_FINE_FORM_EVENT, {
                        detail: fineData
                    })
                    window.dispatchEvent(event)
                }, 1000)
            }

            toast.success(`✓ Fine created: ${randomType} $${randomAmount} for ${customer.name}`)

            // Invalidate fine queries to refresh the list
            await queryClient.invalidateQueries({
                predicate: (query) => {
                    const key = query.queryKey[0]
                    return key === 'fines-list' || key === 'fines-kpis' || key === 'fines-enhanced' || key === 'customer-fines'
                }
            })

        } catch (error: any) {
            console.error('🔧 DEV: Fine creation error:', error)
            toast.error(`Fine creation failed: ${error.message}`)
        } finally {
            setIsLoadingFine(false)
        }
    }

    const createPayment = async () => {
        setIsLoadingPayment(true)
        console.log('🔧 DEV: Creating payment and filling form...')

        try {
            const tenantId = tenant?.id
            if (!tenantId) {
                toast.error('Tenant not found. Please wait for page to fully load.')
                return
            }

            // First try to find the specific mock customer by email
            let customer: { id: string; name: string } | null = null
            const { data: mockCustomer } = await supabase
                .from('customers')
                .select('id, name')
                .eq('tenant_id', tenantId)
                .eq('email', MOCK_DATA.email) // ilyasghulam35@gmail.com
                .eq('status', 'Active')
                .limit(1)
                .single()

            if (mockCustomer) {
                customer = mockCustomer
                console.log('🔧 DEV: Found mock customer:', customer.name)
            } else {
                // Fallback: Fetch first available customer
                const { data: customers, error: customerError } = await supabase
                    .from('customers')
                    .select('id, name')
                    .eq('tenant_id', tenantId)
                    .eq('status', 'Active')
                    .limit(1)

                if (customerError || !customers?.length) {
                    toast.error('No active customers found. Create a customer first.')
                    return
                }
                customer = customers[0]
                console.log('🔧 DEV: Using fallback customer:', customer.name)
            }

            // Find active rental for the customer to get vehicle
            const { data: activeRentals, error: rentalError } = await supabase
                .from('rentals')
                .select('id, vehicle_id, vehicles(id, reg, make, model)')
                .eq('tenant_id', tenantId)
                .eq('customer_id', customer.id)
                .eq('status', 'Active')
                .limit(1)

            let vehicle: { id: string; reg: string; make: string; model: string } | null = null
            let rentalId: string | null = null

            if (activeRentals?.length) {
                const rental = activeRentals[0]
                rentalId = rental.id
                vehicle = rental.vehicles as any
                console.log('🔧 DEV: Found active rental with vehicle:', vehicle?.reg)
            } else {
                // No active rental, try to get first vehicle
                const { data: vehicles } = await supabase
                    .from('vehicles')
                    .select('id, reg, make, model')
                    .eq('tenant_id', tenantId)
                    .limit(1)

                if (vehicles?.length) {
                    vehicle = vehicles[0]
                    console.log('🔧 DEV: No active rental, using first vehicle:', vehicle.reg)
                }
            }

            // Generate random payment data
            const paymentMethods = ['Cash', 'Card', 'Bank Transfer', 'Zelle'] as const
            const randomMethod = paymentMethods[Math.floor(Math.random() * paymentMethods.length)]
            const randomAmount = 100 + Math.floor(Math.random() * 400) // $100-$500
            const paymentDate = new Date()

            // Prepare payment data
            const paymentData = {
                customer_id: customer.id,
                vehicle_id: vehicle?.id || null,
                rental_id: rentalId,
                amount: randomAmount,
                payment_date: paymentDate,
                method: randomMethod,
                notes: `Dev test payment - auto-generated`,
                // Extra data for form display
                customer_name: customer.name,
                vehicle_reg: vehicle?.reg,
                vehicle_make: vehicle?.make,
                vehicle_model: vehicle?.model,
            }

            // Insert payment into Supabase
            const { data: insertedPayment, error } = await supabase
                .from('payments')
                .insert({
                    customer_id: paymentData.customer_id,
                    vehicle_id: paymentData.vehicle_id,
                    rental_id: paymentData.rental_id,
                    amount: paymentData.amount,
                    payment_date: paymentDate.toISOString().split('T')[0],
                    method: paymentData.method,
                    payment_type: 'Payment',
                    tenant_id: tenantId,
                })
                .select()
                .single()

            if (error) {
                console.error('🔧 DEV: Payment insert error:', error)
                toast.error(`Failed to create payment: ${error.message}`)
                return
            }

            console.log('🔧 DEV: Payment created, applying via edge function...')

            // Apply payment using edge function
            const { data: applyResult, error: applyError } = await supabase.functions.invoke('apply-payment', {
                body: { paymentId: insertedPayment.id }
            })

            if (applyError || !applyResult?.ok) {
                console.warn('🔧 DEV: Payment application warning:', applyError || applyResult?.error)
                // Don't delete payment, just warn - it's still recorded
            }

            console.log('🔧 DEV: Payment created and applied:', insertedPayment)

            // Navigate to payments page first if not there, then dispatch event
            if (pathname === '/payments') {
                const event = new CustomEvent(DEV_FILL_PAYMENT_FORM_EVENT, {
                    detail: paymentData
                })
                window.dispatchEvent(event)
            } else {
                router.push('/payments')
                setTimeout(() => {
                    const event = new CustomEvent(DEV_FILL_PAYMENT_FORM_EVENT, {
                        detail: paymentData
                    })
                    window.dispatchEvent(event)
                }, 1000)
            }

            toast.success(`✓ Payment recorded: $${randomAmount} via ${randomMethod} for ${customer.name}`)

            // Invalidate payment queries to refresh the list
            await queryClient.invalidateQueries({
                predicate: (query) => {
                    const key = query.queryKey[0]
                    return key === 'payments-data' || key === 'payment-summary' || key === 'customer-balance' ||
                        key === 'ledger-entries' || key === 'outstanding-balance'
                }
            })

        } catch (error: any) {
            console.error('🔧 DEV: Payment creation error:', error)
            toast.error(`Payment creation failed: ${error.message}`)
        } finally {
            setIsLoadingPayment(false)
        }
    }

    const fillRentalForm = async () => {
        setIsLoadingRental(true)
        console.log('🔧 DEV: Starting rental form auto-fill...')

        try {
            // Get tenant from context
            const tenantId = tenant?.id

            if (!tenantId) {
                toast.error('Tenant not found. Please wait for page to fully load.')
                return
            }

            console.log('🔧 DEV: Using tenant ID:', tenantId)

            // First try to find the specific mock customer by email
            let customer: { id: string; name: string; email: string } | null = null

            const { data: mockCustomer } = await supabase
                .from('customers')
                .select('id, name, email')
                .eq('tenant_id', tenantId)
                .eq('email', MOCK_DATA.email)
                .eq('status', 'Active')
                .maybeSingle()

            if (mockCustomer) {
                customer = mockCustomer
                console.log('🔧 DEV: Found mock customer:', customer.id, customer.name)
            } else {
                // If mock customer not found, fetch any active customer
                const { data: customers, error: customersError } = await supabase
                    .from('customers')
                    .select('id, name, email')
                    .eq('tenant_id', tenantId)
                    .eq('status', 'Active')
                    .limit(1)

                if (customersError || !customers || customers.length === 0) {
                    toast.error(`No customers found. Please create customer: ${MOCK_DATA.name} (${MOCK_DATA.email})`)
                    return
                }
                customer = customers[0]
                toast.info(`Mock customer not found, using: ${customer.name}`)
                console.log('🔧 DEV: Using fallback customer:', customer.id, customer.name)
            }

            console.log('🔧 DEV: Selected customer:', customer.id, customer.name)

            // Fetch first available vehicle
            const { data: vehicles, error: vehiclesError } = await supabase
                .from('vehicles')
                .select('id, reg, make, model, monthly_rent')
                .eq('tenant_id', tenantId)
                .or('status.ilike.Available,status.ilike.available')
                .limit(1)

            if (vehiclesError || !vehicles || vehicles.length === 0) {
                toast.error('No available vehicles found. Please add an available vehicle first.')
                return
            }

            const vehicle = vehicles[0]
            console.log('🔧 DEV: Selected vehicle:', vehicle.id, vehicle.make, vehicle.model)

            // Calculate dates
            const today = new Date()
            const endDate = addMonths(today, 1)

            // Rental form data to dispatch
            const rentalData = {
                customer_id: customer.id,
                customer_name: customer.name,
                vehicle_id: vehicle.id,
                vehicle_name: `${vehicle.make} ${vehicle.model} (${vehicle.reg})`,
                start_date: today,
                end_date: endDate,
                rental_period_type: 'Monthly',
                monthly_amount: vehicle.monthly_rent || 500,
                pickup_location: '123 Main St, Los Angeles, CA 90001',
                return_location: '123 Main St, Los Angeles, CA 90001',
                pickup_time: '10:00',
                return_time: '10:00',
            }

            // Check if we're on the rental creation page
            if (pathname === '/rentals/new') {
                // Dispatch event for the rental form to listen to
                const event = new CustomEvent(DEV_FILL_RENTAL_FORM_EVENT, {
                    detail: rentalData
                })
                window.dispatchEvent(event)
                toast.success(`Rental form filled: ${customer.name} → ${vehicle.make} ${vehicle.model}`)
            } else {
                // Navigate to rental creation page and then fill
                router.push('/rentals/new')

                // Wait for navigation and then dispatch event
                setTimeout(() => {
                    const event = new CustomEvent(DEV_FILL_RENTAL_FORM_EVENT, {
                        detail: rentalData
                    })
                    window.dispatchEvent(event)
                    toast.success(`Rental form filled: ${customer.name} → ${vehicle.make} ${vehicle.model}`)
                }, 1000)
            }

            console.log('🔧 DEV: Rental form fill event dispatched', rentalData)

        } catch (error: any) {
            console.error('🔧 DEV: Error filling rental form:', error)
            toast.error(`Failed to fill rental form: ${error.message}`)
        } finally {
            setIsLoadingRental(false)
        }
    }

    const navigateTo = (path: string) => {
        router.push(path)
        setIsMinimized(true)
    }

    const toggleSection = (section: string) => {
        setExpandedSection(expandedSection === section ? null : section)
    }

    // Minimized: small floating button
    if (isMinimized) {
        return (
            <button
                onClick={(e) => {
                    e.stopPropagation()
                    setIsMinimized(false)
                }}
                onMouseDown={(e) => e.stopPropagation()}
                className="fixed top-20 right-4 z-[9999] bg-orange-500 hover:bg-orange-600 text-white p-3 rounded-full shadow-lg transition-all hover:scale-110"
                title="Dev Panel (Ctrl+Shift+D)"
            >
                <Bug className="w-5 h-5" />
            </button>
        )
    }

    return (
        <Card
            className="fixed top-20 right-4 z-[9999] w-80 shadow-2xl border-orange-500/50 bg-background/95 backdrop-blur max-h-[75vh] overflow-y-auto scrollbar-none [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
        >
            {/* Header */}
            <div className="flex items-center justify-between p-3 border-b border-orange-500/30 bg-orange-500/10 sticky top-0 z-10">
                <div className="flex items-center gap-2">
                    <Bug className="w-4 h-4 text-orange-500" />
                    <span className="font-semibold text-sm">Dev Panel</span>
                    <Badge variant="outline" className="text-[10px] px-1 py-0 border-orange-500/50 text-orange-500">
                        PORTAL
                    </Badge>
                </div>
                <button onClick={() => setIsMinimized(true)} className="text-muted-foreground hover:text-foreground">
                    <X className="w-4 h-4" />
                </button>
            </div>

            <div className="p-3 space-y-3">
                <p className="text-xs text-muted-foreground">
                    Quick testing tools. <kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">Ctrl+Shift+D</kbd>
                </p>

                {/* Create Rental Section */}
                <div className="border border-border rounded-lg">
                    <button
                        onClick={() => toggleSection('rental')}
                        className="w-full flex items-center justify-between p-2 hover:bg-muted/50 transition-colors"
                    >
                        <div className="flex items-center gap-2">
                            <FileText className="w-4 h-4 text-orange-500" />
                            <span className="text-sm font-medium">Create Rental</span>
                        </div>
                        {expandedSection === 'rental' ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </button>
                    {expandedSection === 'rental' && (
                        <div className="px-2 pb-2 space-y-2">
                            <div className="text-xs text-muted-foreground px-2">
                                <p>Auto-selects first available:</p>
                                <p>• Customer</p>
                                <p>• Vehicle</p>
                                <p>• Sets 1-month rental period</p>
                            </div>
                            <Button
                                variant="outline"
                                size="sm"
                                className="w-full text-xs h-7"
                                onClick={fillRentalForm}
                                disabled={isLoadingRental}
                            >
                                {isLoadingRental ? (
                                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                ) : (
                                    <Zap className="w-3 h-3 mr-1 text-orange-500" />
                                )}
                                Fill Rental Form
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                className="w-full text-xs h-7"
                                onClick={() => router.push('/rentals/new')}
                            >
                                <FileText className="w-3 h-3 mr-1" />
                                Go to New Rental
                            </Button>
                        </div>
                    )}
                </div>

                {/* Login Form Section */}
                <div className="border border-border rounded-lg">
                    <button
                        onClick={() => toggleSection('login')}
                        className="w-full flex items-center justify-between p-2 hover:bg-muted/50 transition-colors"
                    >
                        <div className="flex items-center gap-2">
                            <LogIn className="w-4 h-4 text-orange-500" />
                            <span className="text-sm font-medium">Login Form</span>
                        </div>
                        {expandedSection === 'login' ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </button>
                    {expandedSection === 'login' && (
                        <div className="px-2 pb-2 space-y-2">
                            <div className="text-xs text-muted-foreground px-2">
                                <p>Email: {MOCK_DATA.email}</p>
                                <p>Password: {MOCK_DATA.password}</p>
                            </div>
                            <Button
                                variant="outline"
                                size="sm"
                                className="w-full text-xs h-7"
                                onClick={fillLoginForm}
                            >
                                <Zap className="w-3 h-3 mr-1 text-orange-500" />
                                Fill Login Form
                            </Button>
                        </div>
                    )}
                </div>

                {/* Add Customer Section */}
                <div className="border border-border rounded-lg">
                    <button
                        onClick={() => toggleSection('customer')}
                        className="w-full flex items-center justify-between p-2 hover:bg-muted/50 transition-colors"
                    >
                        <div className="flex items-center gap-2">
                            <UserPlus className="w-4 h-4 text-orange-500" />
                            <span className="text-sm font-medium">Add Customer</span>
                        </div>
                        {expandedSection === 'customer' ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </button>
                    {expandedSection === 'customer' && (
                        <div className="px-2 pb-2 space-y-2">
                            <div className="text-xs text-muted-foreground px-2">
                                <p>Creates customer with:</p>
                                <p>• Name: {MOCK_DATA.name}</p>
                                <p>• Email: {MOCK_DATA.email}</p>
                                <p>• Random License/ID</p>
                            </div>
                            <Button
                                variant="outline"
                                size="sm"
                                className="w-full text-xs h-7"
                                onClick={createCustomer}
                                disabled={isLoadingCustomer}
                            >
                                {isLoadingCustomer ? (
                                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                ) : (
                                    <Zap className="w-3 h-3 mr-1 text-orange-500" />
                                )}
                                {isLoadingCustomer ? 'Creating...' : 'Create Customer'}
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                className="w-full text-xs h-7"
                                onClick={() => router.push('/customers')}
                            >
                                <Users className="w-3 h-3 mr-1" />
                                Go to Customers
                            </Button>
                        </div>
                    )}
                </div>

                {/* Add Vehicle Section */}
                <div className="border border-border rounded-lg">
                    <button
                        onClick={() => toggleSection('vehicle')}
                        className="w-full flex items-center justify-between p-2 hover:bg-muted/50 transition-colors"
                    >
                        <div className="flex items-center gap-2">
                            <Car className="w-4 h-4 text-orange-500" />
                            <span className="text-sm font-medium">Add Vehicle</span>
                        </div>
                        {expandedSection === 'vehicle' ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </button>
                    {expandedSection === 'vehicle' && (
                        <div className="px-2 pb-2 space-y-2">
                            <div className="text-xs text-muted-foreground px-2">
                                <p>Generates random:</p>
                                <p>• Registration (DEV-XXXX)</p>
                                <p>• Make/Model (12 options)</p>
                                <p>• Year (2020-2024)</p>
                                <p>• Prices vary per vehicle</p>
                            </div>
                            <Button
                                variant="outline"
                                size="sm"
                                className="w-full text-xs h-7"
                                onClick={createVehicle}
                                disabled={isLoadingVehicle}
                            >
                                {isLoadingVehicle ? (
                                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                ) : (
                                    <Zap className="w-3 h-3 mr-1 text-orange-500" />
                                )}
                                {isLoadingVehicle ? 'Creating...' : 'Create Vehicle'}
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                className="w-full text-xs h-7"
                                onClick={() => router.push('/vehicles')}
                            >
                                <Car className="w-3 h-3 mr-1" />
                                Go to Vehicles
                            </Button>
                        </div>
                    )}
                </div>

                {/* Add Fine Section */}
                <div className="border border-border rounded-lg">
                    <button
                        onClick={() => toggleSection('fine')}
                        className="w-full flex items-center justify-between p-2 hover:bg-muted/50 transition-colors"
                    >
                        <div className="flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4 text-orange-500" />
                            <span className="text-sm font-medium">Add Fine</span>
                        </div>
                        {expandedSection === 'fine' ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </button>
                    {expandedSection === 'fine' && (
                        <div className="px-2 pb-2 space-y-2">
                            <div className="text-xs text-muted-foreground px-2">
                                <p>Generates random:</p>
                                <p>• Type (PCN/Speeding/Other)</p>
                                <p>• Amount ($50-$250)</p>
                                <p>• Reference (DEV-XXXX)</p>
                                <p>• Uses first customer/vehicle</p>
                            </div>
                            <Button
                                variant="outline"
                                size="sm"
                                className="w-full text-xs h-7"
                                onClick={createFine}
                                disabled={isLoadingFine}
                            >
                                {isLoadingFine ? (
                                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                ) : (
                                    <Zap className="w-3 h-3 mr-1 text-orange-500" />
                                )}
                                {isLoadingFine ? 'Creating...' : 'Create Fine'}
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                className="w-full text-xs h-7"
                                onClick={() => router.push('/fines')}
                            >
                                <AlertTriangle className="w-3 h-3 mr-1" />
                                Go to Fines
                            </Button>
                        </div>
                    )}
                </div>

                {/* Record Payment Section */}
                <div className="border border-border rounded-lg">
                    <button
                        onClick={() => toggleSection('payment')}
                        className="w-full flex items-center justify-between p-2 hover:bg-muted/50 transition-colors"
                    >
                        <div className="flex items-center gap-2">
                            <DollarSign className="w-4 h-4 text-orange-500" />
                            <span className="text-sm font-medium">Record Payment</span>
                        </div>
                        {expandedSection === 'payment' ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </button>
                    {expandedSection === 'payment' && (
                        <div className="px-2 pb-2 space-y-2">
                            <div className="text-xs text-muted-foreground px-2">
                                <p>Generates random:</p>
                                <p>• Amount ($100-$500)</p>
                                <p>• Method (Cash/Card/Transfer)</p>
                                <p>• Uses mock customer</p>
                                <p>• Auto-applies via FIFO</p>
                            </div>
                            <Button
                                variant="outline"
                                size="sm"
                                className="w-full text-xs h-7"
                                onClick={createPayment}
                                disabled={isLoadingPayment}
                            >
                                {isLoadingPayment ? (
                                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                ) : (
                                    <Zap className="w-3 h-3 mr-1 text-orange-500" />
                                )}
                                {isLoadingPayment ? 'Recording...' : 'Record Payment'}
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                className="w-full text-xs h-7"
                                onClick={() => router.push('/payments')}
                            >
                                <DollarSign className="w-3 h-3 mr-1" />
                                Go to Payments
                            </Button>
                        </div>
                    )}
                </div>

                {/* Quick Navigation */}
                <div className="border border-border rounded-lg">
                    <button
                        onClick={() => toggleSection('nav')}
                        className="w-full flex items-center justify-between p-2 hover:bg-muted/50 transition-colors"
                    >
                        <div className="flex items-center gap-2">
                            <LayoutDashboard className="w-4 h-4 text-orange-500" />
                            <span className="text-sm font-medium">Quick Navigation</span>
                        </div>
                        {expandedSection === 'nav' ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </button>
                    {expandedSection === 'nav' && (
                        <div className="px-2 pb-2 grid grid-cols-2 gap-1">
                            {QUICK_NAV_ITEMS.map((item) => (
                                <Button
                                    key={item.path}
                                    variant="outline"
                                    size="sm"
                                    className="text-xs h-7 justify-start"
                                    onClick={() => navigateTo(item.path)}
                                >
                                    {item.icon}
                                    <span className="ml-1">{item.name}</span>
                                </Button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Clear All */}
                <Button
                    variant="outline"
                    size="sm"
                    className="w-full text-xs h-7"
                    onClick={() => {
                        localStorage.clear()
                        sessionStorage.clear()
                        window.location.reload()
                    }}
                >
                    <RotateCcw className="w-3 h-3 mr-1" />
                    Clear All & Reload
                </Button>
            </div>
        </Card>
    )
}
