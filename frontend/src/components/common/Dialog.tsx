import {
  type ReactNode,
  type MouseEvent,
  useEffect,
  useRef,
  useCallback,
} from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}

export function Dialog({ open, onClose, children, className }: DialogProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [open, onClose]);

  const handleOverlayClick = useCallback(
    (e: MouseEvent) => {
      if (e.target === overlayRef.current) onClose();
    },
    [onClose],
  );

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
    >
      <div
        className={cn(
          "relative bg-background rounded-lg shadow-lg border p-6 w-full max-w-md max-h-[85vh] overflow-y-auto",
          className,
        )}
      >
        <button
          onClick={onClose}
          className="absolute top-4 start-4 rounded-sm opacity-70 hover:opacity-100 transition-opacity cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>
        {children}
      </div>
    </div>
  );
}

export function DialogHeader({ children }: { children: ReactNode }) {
  return <div className="mb-4">{children}</div>;
}

export function DialogTitle({ children }: { children: ReactNode }) {
  return <h2 className="text-lg font-semibold">{children}</h2>;
}

export function DialogFooter({ children }: { children: ReactNode }) {
  return (
    <div className="mt-6 flex justify-start gap-2">{children}</div>
  );
}
