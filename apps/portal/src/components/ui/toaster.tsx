import { useToast } from "@/hooks/use-toast";
import { Toast, ToastClose, ToastDescription, ToastProvider, ToastTitle, ToastViewport } from "@/components/ui/toast";
import { useV2 } from "@/lib/v2-context";

export function Toaster() {
  const { toasts } = useToast();
  // v2 (northwind): a failed save arrives in the faded red the inline field
  // notes and the save bar already use. Everyone else keeps the solid fill, and
  // the markup below is byte for byte what it was for them.
  const v2Chrome = useV2("chrome");

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, ...props }) {
        const variant = v2Chrome && props.variant === "destructive" ? "v2Destructive" : props.variant;
        const faded = variant === "v2Destructive";
        return (
          <Toast key={id} {...props} variant={variant}>
            <div className="grid gap-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {/* The dimmed description is for white on solid red; on the tint
                  it costs the reason 0.7 of its contrast, so it reads at full. */}
              {description && (
                <ToastDescription className={faded ? "opacity-100" : undefined}>{description}</ToastDescription>
              )}
            </div>
            {action}
            <ToastClose className={faded ? "rounded-xl" : undefined} />
          </Toast>
        );
      })}
      <ToastViewport />
    </ToastProvider>
  );
}
