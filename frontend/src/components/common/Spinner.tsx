import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function Spinner({ className }: { className?: string }) {
  return (
    <div className="flex items-center justify-center py-12">
      <Loader2 className={cn("h-8 w-8 animate-spin text-primary", className)} />
    </div>
  );
}
