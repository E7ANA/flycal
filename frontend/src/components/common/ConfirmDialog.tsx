import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "./Dialog";
import { Button } from "./Button";

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  loading?: boolean;
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = "מחק",
  loading = false,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>
      <p className="text-sm text-muted-foreground">{message}</p>
      <DialogFooter>
        <Button
          variant="destructive"
          onClick={onConfirm}
          disabled={loading}
        >
          {loading ? "מוחק..." : confirmLabel}
        </Button>
        <Button variant="outline" onClick={onClose} disabled={loading}>
          ביטול
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
