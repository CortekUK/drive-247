import * as React from "react"
import { Clock } from "lucide-react"
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
}

export function TimePicker({ value = "", onChange, disabled, className, id }: TimePickerProps) {
  const [isOpen, setIsOpen] = React.useState(false)
  const [hours, setHours] = React.useState("12")
  const [minutes, setMinutes] = React.useState("00")
  const [period, setPeriod] = React.useState<"AM" | "PM">("PM")

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

  const displayValue = value || "Select time"

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
      <PopoverContent className="w-auto p-4" align="start">
        <div className="space-y-4">
          <div className="text-sm font-medium">Select Time</div>

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
                className="w-16 text-center"
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
                className="w-16 text-center"
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
                  onClick={() => setPeriod("AM")}
                  className={cn("w-16 h-8", period === "AM" && "bg-accent text-accent-foreground hover:bg-accent/90")}
                >
                  AM
                </Button>
                <Button
                  type="button"
                  variant={period === "PM" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setPeriod("PM")}
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
              {[
                { label: "9:00 AM", h: "09", m: "00", p: "AM" },
                { label: "12:00 PM", h: "12", m: "00", p: "PM" },
                { label: "3:00 PM", h: "03", m: "00", p: "PM" },
                { label: "6:00 PM", h: "06", m: "00", p: "PM" },
                { label: "9:00 PM", h: "09", m: "00", p: "PM" },
                { label: "Now", h: "", m: "", p: "" },
              ].map((time) => (
                <Button
                  key={time.label}
                  type="button"
                  variant="outline"
                  size="sm"
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
                  className="text-xs"
                >
                  {time.label}
                </Button>
              ))}
            </div>
          </div>

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
              className="flex-1 bg-accent text-accent-foreground hover:bg-accent/90"
            >
              Apply
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
