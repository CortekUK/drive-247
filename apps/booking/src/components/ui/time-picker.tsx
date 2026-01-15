import * as React from "react"
import { Clock, Info } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

interface TimePickerProps {
  value?: string
  onChange?: (value: string) => void
  disabled?: boolean
  className?: string
  id?: string
  // Business hours props
  businessHoursOpen?: string // Format: "HH:MM" (24-hour)
  businessHoursClose?: string // Format: "HH:MM" (24-hour)
  showBusinessHoursNotice?: boolean
  onBusinessHoursNoticeShown?: () => void
}

/**
 * Convert 24-hour time string to minutes since midnight
 */
function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number)
  return h * 60 + m
}

/**
 * Check if a time (in 24-hour format) is within business hours
 */
function isTimeWithinBusinessHours(time: string, openTime: string, closeTime: string): boolean {
  const timeMinutes = timeToMinutes(time)
  const openMinutes = timeToMinutes(openTime)
  const closeMinutes = timeToMinutes(closeTime)
  return timeMinutes >= openMinutes && timeMinutes < closeMinutes
}

/**
 * Format time for display (12-hour format with AM/PM)
 */
function formatTime12Hour(time: string): string {
  const [h, m] = time.split(":").map(Number)
  const period = h >= 12 ? "PM" : "AM"
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${hour12}:${m.toString().padStart(2, "0")} ${period}`
}

export function TimePicker({
  value = "",
  onChange,
  disabled,
  className,
  id,
  businessHoursOpen,
  businessHoursClose,
  showBusinessHoursNotice = false,
  onBusinessHoursNoticeShown
}: TimePickerProps) {
  const [isOpen, setIsOpen] = React.useState(false)
  const [hours, setHours] = React.useState("12")
  const [minutes, setMinutes] = React.useState("00")
  const [period, setPeriod] = React.useState<"AM" | "PM">("PM")
  const [showNotice, setShowNotice] = React.useState(false)
  const [noticeAcknowledged, setNoticeAcknowledged] = React.useState(false)

  const hasBusinessHours = businessHoursOpen && businessHoursClose

  // Parse existing value on mount or when value changes
  React.useEffect(() => {
    if (value) {
      const [h, m] = value.split(":")
      const hourNum = parseInt(h, 10)

      if (hourNum === 0) {
        setHours("12")
        setPeriod("AM")
      } else if (hourNum === 12) {
        setHours("12")
        setPeriod("PM")
      } else if (hourNum > 12) {
        setHours((hourNum - 12).toString().padStart(2, "0"))
        setPeriod("PM")
      } else {
        setHours(h)
        setPeriod("AM")
      }

      setMinutes(m)
    }
  }, [value])

  // Show notice when popover opens (if enabled and not yet acknowledged)
  React.useEffect(() => {
    if (isOpen && showBusinessHoursNotice && hasBusinessHours && !noticeAcknowledged) {
      setShowNotice(true)
      onBusinessHoursNoticeShown?.()
    }
  }, [isOpen, showBusinessHoursNotice, hasBusinessHours, noticeAcknowledged, onBusinessHoursNoticeShown])

  const handleProceedToBooking = () => {
    setShowNotice(false)
    setNoticeAcknowledged(true)
  }

  const handleApply = () => {
    let hour24 = parseInt(hours, 10)

    if (period === "AM") {
      if (hour24 === 12) hour24 = 0
    } else {
      if (hour24 !== 12) hour24 += 12
    }

    const timeString = `${hour24.toString().padStart(2, "0")}:${minutes}`
    onChange?.(timeString)
    setIsOpen(false)
  }

  // Check if a time is within business hours (for quick select buttons)
  const isQuickTimeAvailable = (h: string, m: string, p: string): boolean => {
    if (!hasBusinessHours) return true
    if (h === "" && m === "" && p === "") return true // "Now" is always available

    let hour24 = parseInt(h, 10)
    if (p === "AM") {
      if (hour24 === 12) hour24 = 0
    } else {
      if (hour24 !== 12) hour24 += 12
    }

    const timeString = `${hour24.toString().padStart(2, "0")}:${m}`
    return isTimeWithinBusinessHours(timeString, businessHoursOpen!, businessHoursClose!)
  }

  // Check if current selection is within business hours
  const isCurrentSelectionValid = (): boolean => {
    if (!hasBusinessHours) return true

    let hour24 = parseInt(hours, 10)
    if (isNaN(hour24)) return false
    if (period === "AM") {
      if (hour24 === 12) hour24 = 0
    } else {
      if (hour24 !== 12) hour24 += 12
    }

    const timeString = `${hour24.toString().padStart(2, "0")}:${minutes}`
    return isTimeWithinBusinessHours(timeString, businessHoursOpen!, businessHoursClose!)
  }

  // Auto-correct time to nearest valid business hours
  const autoCorrectToValidTime = () => {
    if (!hasBusinessHours) return

    let hour24 = parseInt(hours, 10)
    if (isNaN(hour24)) hour24 = 9 // Default to 9 if invalid
    if (period === "AM") {
      if (hour24 === 12) hour24 = 0
    } else {
      if (hour24 !== 12) hour24 += 12
    }

    const currentMinutes = hour24 * 60 + parseInt(minutes || "0", 10)
    const openMinutes = timeToMinutes(businessHoursOpen!)
    const closeMinutes = timeToMinutes(businessHoursClose!)

    let correctedMinutes: number
    if (currentMinutes < openMinutes) {
      // Before opening - set to opening time
      correctedMinutes = openMinutes
    } else if (currentMinutes >= closeMinutes) {
      // After closing - set to last valid time (close - 1 minute)
      correctedMinutes = closeMinutes - 1
    } else {
      // Within range, no correction needed
      return
    }

    // Convert corrected minutes back to hours/minutes/period
    const correctedHour24 = Math.floor(correctedMinutes / 60)
    const correctedMins = correctedMinutes % 60
    const correctedHour12 = correctedHour24 === 0 ? 12 : correctedHour24 > 12 ? correctedHour24 - 12 : correctedHour24
    const correctedPeriod = correctedHour24 >= 12 ? "PM" : "AM"

    setHours(correctedHour12.toString().padStart(2, "0"))
    setMinutes(correctedMins.toString().padStart(2, "0"))
    setPeriod(correctedPeriod)
  }

  // Check if a preset time matches the current selection
  const isPresetSelected = (presetH: string, presetM: string, presetP: string) => {
    if (presetH === "" && presetM === "" && presetP === "") {
      // "Now" button - never highlight as selected
      return false;
    }
    return hours === presetH && minutes === presetM && period === presetP;
  };

  // Generate quick select times based on business hours
  const getQuickSelectTimes = () => {
    const defaultTimes = [
      { label: "9:00 AM", h: "09", m: "00", p: "AM" },
      { label: "12:00 PM", h: "12", m: "00", p: "PM" },
      { label: "3:00 PM", h: "03", m: "00", p: "PM" },
      { label: "6:00 PM", h: "06", m: "00", p: "PM" },
      { label: "9:00 PM", h: "09", m: "00", p: "PM" },
      { label: "Now", h: "", m: "", p: "" },
    ]

    if (!hasBusinessHours) return defaultTimes

    // Generate times within business hours
    const openMinutes = timeToMinutes(businessHoursOpen!)
    const closeMinutes = timeToMinutes(businessHoursClose!)
    const businessHoursTimes: { label: string; h: string; m: string; p: string }[] = []

    // Add opening time
    const openHour = Math.floor(openMinutes / 60)
    const openHour12 = openHour === 0 ? 12 : openHour > 12 ? openHour - 12 : openHour
    const openPeriod = openHour >= 12 ? "PM" : "AM"
    businessHoursTimes.push({
      label: `${openHour12}:00 ${openPeriod}`,
      h: openHour12.toString().padStart(2, "0"),
      m: "00",
      p: openPeriod
    })

    // Add mid-day times at 3-hour intervals within business hours
    for (let mins = openMinutes + 180; mins < closeMinutes - 60; mins += 180) {
      const hour = Math.floor(mins / 60)
      const hour12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour
      const timePeriod = hour >= 12 ? "PM" : "AM"
      businessHoursTimes.push({
        label: `${hour12}:00 ${timePeriod}`,
        h: hour12.toString().padStart(2, "0"),
        m: "00",
        p: timePeriod
      })
    }

    // Add closing time - 1 hour (last available slot)
    const closeHour = Math.floor((closeMinutes - 60) / 60)
    if (closeHour > openHour) {
      const closeHour12 = closeHour === 0 ? 12 : closeHour > 12 ? closeHour - 12 : closeHour
      const closePeriod = closeHour >= 12 ? "PM" : "AM"
      const lastTime = {
        label: `${closeHour12}:00 ${closePeriod}`,
        h: closeHour12.toString().padStart(2, "0"),
        m: "00",
        p: closePeriod
      }
      // Avoid duplicates
      if (!businessHoursTimes.some(t => t.label === lastTime.label)) {
        businessHoursTimes.push(lastTime)
      }
    }

    // Limit to 5 times and add "Now"
    const limitedTimes = businessHoursTimes.slice(0, 5)
    limitedTimes.push({ label: "Now", h: "", m: "", p: "" })

    return limitedTimes
  }

  const quickSelectTimes = getQuickSelectTimes()

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="outline"
          disabled={disabled}
          className={cn(
            "w-full justify-start text-left font-normal h-10 hover:!bg-transparent hover:!text-foreground",
            !value && "text-muted-foreground",
            className
          )}
        >
          <Clock className="mr-2 h-4 w-4" />
          {value ? (
            // Format for display (12-hour)
            (() => {
              const [h, m] = value.split(":")
              const hourNum = parseInt(h, 10)
              const hour12 = hourNum === 0 ? 12 : hourNum > 12 ? hourNum - 12 : hourNum
              const periodDisplay = hourNum >= 12 ? "PM" : "AM"
              return `${hour12}:${m} ${periodDisplay}`
            })()
          ) : (
            "Select time"
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-4" align="start">
        {/* Business Hours Notice */}
        {showNotice && hasBusinessHours && (
          <div className="mb-4 p-4 bg-primary/10 border border-primary/20 rounded-lg">
            <div className="flex items-start gap-3">
              <Info className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <h4 className="font-semibold text-sm mb-1">Business Hours</h4>
                <p className="text-sm text-muted-foreground mb-3">
                  Pickup and drop-off times are available during our business hours:
                </p>
                <div className="bg-background rounded-md p-2 mb-3 text-center">
                  <span className="font-semibold text-lg">
                    {formatTime12Hour(businessHoursOpen!)} - {formatTime12Hour(businessHoursClose!)}
                  </span>
                </div>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleProceedToBooking}
                  className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  Proceed to Booking
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Time Picker Content - shown after notice is acknowledged or if no notice needed */}
        {(!showNotice || !showBusinessHoursNotice || noticeAcknowledged || !hasBusinessHours) && (
          <div className="space-y-4">
            <div className="text-sm font-medium">Select Time</div>

            {/* Business Hours Reminder */}
            {hasBusinessHours && (
              <div className="text-xs text-muted-foreground bg-muted/50 rounded-md p-2 flex items-center gap-2">
                <Clock className="h-3 w-3" />
                Available: {formatTime12Hour(businessHoursOpen!)} - {formatTime12Hour(businessHoursClose!)}
              </div>
            )}

            <div className="flex items-center gap-2">
              {/* Hours */}
              <div className="space-y-2">
                <Label htmlFor="hours" className="text-xs">Hours</Label>
                <Input
                  id="hours"
                  type="number"
                  min="1"
                  max="12"
                  value={hours}
                  onChange={(e) => {
                    let val = parseInt(e.target.value, 10)
                    if (isNaN(val)) {
                      setHours("")
                      return
                    }
                    if (val > 12) val = 12
                    if (val < 1) val = 1
                    setHours(val.toString().padStart(2, "0"))
                  }}
                  onBlur={() => {
                    // Auto-correct to valid business hours on blur
                    if (hasBusinessHours && !isCurrentSelectionValid()) {
                      autoCorrectToValidTime()
                    }
                  }}
                  className={cn(
                    "w-16 text-center",
                    hasBusinessHours && !isCurrentSelectionValid() && "border-destructive focus-visible:ring-destructive"
                  )}
                />
              </div>

              <div className="pt-6 text-xl font-bold">:</div>

              {/* Minutes */}
              <div className="space-y-2">
                <Label htmlFor="minutes" className="text-xs">Minutes</Label>
                <Input
                  id="minutes"
                  type="number"
                  min="0"
                  max="59"
                  value={minutes}
                  onChange={(e) => {
                    let val = parseInt(e.target.value, 10)
                    if (isNaN(val)) {
                      setMinutes("00")
                      return
                    }
                    if (val > 59) val = 59
                    if (val < 0) val = 0
                    setMinutes(val.toString().padStart(2, "0"))
                  }}
                  onBlur={() => {
                    // Auto-correct to valid business hours on blur
                    if (hasBusinessHours && !isCurrentSelectionValid()) {
                      autoCorrectToValidTime()
                    }
                  }}
                  className={cn(
                    "w-16 text-center",
                    hasBusinessHours && !isCurrentSelectionValid() && "border-destructive focus-visible:ring-destructive"
                  )}
                />
              </div>

              {/* AM/PM */}
              <div className="space-y-2">
                <Label className="text-xs">Period</Label>
                <div className="flex flex-col gap-1">
                  <Button
                    type="button"
                    variant={period === "AM" ? "default" : "outline"}
                    size="sm"
                    onClick={() => {
                      setPeriod("AM")
                      // Auto-correct after period change if invalid
                      setTimeout(() => {
                        if (hasBusinessHours && !isCurrentSelectionValid()) {
                          autoCorrectToValidTime()
                        }
                      }, 0)
                    }}
                    className={cn("w-16 h-8", period === "AM" && "bg-accent text-accent-foreground hover:bg-accent/90")}
                  >
                    AM
                  </Button>
                  <Button
                    type="button"
                    variant={period === "PM" ? "default" : "outline"}
                    size="sm"
                    onClick={() => {
                      setPeriod("PM")
                      // Auto-correct after period change if invalid
                      setTimeout(() => {
                        if (hasBusinessHours && !isCurrentSelectionValid()) {
                          autoCorrectToValidTime()
                        }
                      }, 0)
                    }}
                    className={cn("w-16 h-8", period === "PM" && "bg-accent text-accent-foreground hover:bg-accent/90")}
                  >
                    PM
                  </Button>
                </div>
              </div>
            </div>

            {/* Quick select times */}
            <div className="space-y-2">
              <Label className="text-xs">Quick Select</Label>
              <div className="grid grid-cols-3 gap-2">
                {quickSelectTimes.map((time) => {
                  const isSelected = isPresetSelected(time.h, time.m, time.p);
                  const isAvailable = isQuickTimeAvailable(time.h, time.m, time.p);
                  return (
                    <Button
                      key={time.label}
                      type="button"
                      variant={isSelected ? "default" : "outline"}
                      size="sm"
                      disabled={!isAvailable}
                      onClick={() => {
                        if (time.label === "Now") {
                          const now = new Date()
                          const currentHours = now.getHours()
                          const currentMinutes = now.getMinutes()
                          const hour12 = currentHours === 0 ? 12 : currentHours > 12 ? currentHours - 12 : currentHours
                          const currentPeriod = currentHours >= 12 ? "PM" : "AM"

                          setHours(hour12.toString().padStart(2, "0"))
                          setMinutes(currentMinutes.toString().padStart(2, "0"))
                          setPeriod(currentPeriod)
                        } else {
                          setHours(time.h)
                          setMinutes(time.m)
                          setPeriod(time.p as "AM" | "PM")
                        }
                      }}
                      className={cn(
                        "text-xs",
                        isSelected && "bg-accent text-accent-foreground hover:bg-accent/90",
                        !isAvailable && "opacity-50 cursor-not-allowed"
                      )}
                    >
                      {time.label}
                    </Button>
                  );
                })}
              </div>
            </div>

            {/* Validation message - always reserve space to prevent layout shift */}
            {hasBusinessHours && (
              <div className={cn(
                "text-xs rounded-md p-2 transition-opacity",
                !isCurrentSelectionValid()
                  ? "text-destructive bg-destructive/10 opacity-100"
                  : "opacity-0 h-0 p-0 overflow-hidden"
              )}>
                Time outside business hours
              </div>
            )}

            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsOpen(false)}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleApply}
                disabled={hasBusinessHours && !isCurrentSelectionValid()}
                className="flex-1 bg-accent text-accent-foreground hover:bg-accent/90"
              >
                Apply
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
