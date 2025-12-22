"use client";

import { Toaster as Sonner, toast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-[#141414] group-[.toaster]:text-gray-100 group-[.toaster]:border-[#262626] group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-gray-400",
          actionButton:
            "group-[.toast]:bg-primary-600 group-[.toast]:text-white",
          cancelButton:
            "group-[.toast]:bg-[#1a1a1a] group-[.toast]:text-gray-300",
          success: "group-[.toast]:border-green-800/50",
          error: "group-[.toast]:border-red-800/50",
          info: "group-[.toast]:border-blue-800/50",
          warning: "group-[.toast]:border-yellow-800/50",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
