import { CLAIM_STATUS_LABEL, ClaimStatus } from "@/contracts/ArcClaim";
import { cn } from "./ui";

const STYLES: Record<number, string> = {
  [ClaimStatus.FUNDED]: "bg-info-bg text-accent border-accent/25",
  [ClaimStatus.CLAIMED]: "bg-success-bg text-success border-success/25",
  [ClaimStatus.CANCELLED]: "bg-surface-2 text-muted border-border",
  [ClaimStatus.REFUNDED]: "bg-surface-2 text-muted border-border",
};

/** Contract status, with FUNDED-but-past-expiry shown as EXPIRED. */
export function StatusBadge({ status, expired }: { status?: number; expired?: boolean }) {
  if (status === undefined) {
    return <span className="inline-block h-6 w-20 animate-pulse rounded-full bg-surface-2" />;
  }
  const isExpired = status === ClaimStatus.FUNDED && expired;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold tracking-wide",
        isExpired ? "bg-warning-bg text-warning border-warning/25" : STYLES[status],
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {isExpired ? "EXPIRED" : CLAIM_STATUS_LABEL[status]}
    </span>
  );
}

const PHASE_STYLES: Record<string, string> = {
  ACTIVE: "bg-info-bg text-accent border-accent/25",
  FUNDED: "bg-info-bg text-accent border-accent/25",
  COMPLETED: "bg-success-bg text-success border-success/25",
  CLAIMED: "bg-success-bg text-success border-success/25",
  EXPIRED: "bg-warning-bg text-warning border-warning/25",
  REFUNDED: "bg-surface-2 text-muted border-border",
  CANCELLED: "bg-surface-2 text-muted border-border",
};

/** Badge for a batch phase (ACTIVE / COMPLETED / EXPIRED / REFUNDED / CANCELLED) or allocation status label. */
export function LabelBadge({ label }: { label?: string }) {
  if (!label) return <span className="inline-block h-6 w-20 animate-pulse rounded-full bg-surface-2" />;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold tracking-wide",
        PHASE_STYLES[label] ?? PHASE_STYLES.REFUNDED,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {label}
    </span>
  );
}
