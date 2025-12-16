import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "@/lib/utils";

const Tabs = TabsPrimitive.Root;

interface TabsListProps extends React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> {
  variant?: "default" | "evenly-spaced" | "sticky-evenly-spaced";
}

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  TabsListProps
>(({ className, variant = "default", ...props }, ref) => {
  const baseClasses = "flex items-center text-muted-foreground";
  
  const variantClasses = {
    default: "inline-flex justify-center rounded-md bg-muted p-1",
    "evenly-spaced": "w-full justify-between gap-1 bg-transparent p-0",
    "sticky-evenly-spaced": "w-full justify-between gap-1 bg-transparent p-0 sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60"
  };

  return (
    <TabsPrimitive.List
      ref={ref}
      className={cn(
        baseClasses,
        variantClasses[variant],
        className,
      )}
      {...props}
    />
  );
});
TabsList.displayName = TabsPrimitive.List.displayName;

interface TabsTriggerProps extends React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> {
  variant?: "default" | "evenly-spaced";
}

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  TabsTriggerProps
>(({ className, variant = "default", ...props }, ref) => {
  const baseClasses = "inline-flex items-center justify-center whitespace-nowrap text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50";
  
  const variantClasses = {
    default: "rounded-md px-3 py-2 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm",
    "evenly-spaced": "flex-1 px-4 py-3 border-b-2 border-transparent hover:text-foreground hover:border-muted-foreground/50 data-[state=active]:text-accent data-[state=active]:border-accent data-[state=active]:font-semibold dark:data-[state=active]:text-accent dark:data-[state=active]:border-accent"
  };

  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(
        baseClasses,
        variantClasses[variant],
        className,
      )}
      {...props}
    />
  );
});
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
