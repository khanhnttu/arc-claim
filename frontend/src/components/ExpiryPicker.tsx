"use client";

import type { ButtonHTMLAttributes } from "react";
import { formatDuration } from "@/lib/format";
import { nowSeconds } from "@/lib/tx";
import { cn } from "./ui";

export const EXPIRY_PRESETS = [
  { label: "10 minutes", seconds: 10 * 60 },
  { label: "1 hour", seconds: 60 * 60 },
  { label: "24 hours", seconds: 24 * 60 * 60 },
  { label: "7 days", seconds: 7 * 24 * 60 * 60 },
  { label: "30 days", seconds: 30 * 24 * 60 * 60 },
] as const;

/** Minimum lead time so a custom expiry is still in the future when the tx lands. */
export const MIN_CUSTOM_SECONDS = 60;

/** Preset duration in seconds, "custom" (datetime input) or "never" (expiry = 0). */
export type ExpiryChoice = number | "custom" | "never";

export const NEVER_EXPIRES_COPY =
  "This payment does not expire. The recipient can claim at any time, and the sender can cancel before it is claimed.";

export function toLocalInputValue(unixSeconds: number) {
  const d = new Date(unixSeconds * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function parseLocalInput(value: string): number | undefined {
  const ms = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : undefined;
}

/**
 * Resolve the picker state to an on-chain expiry at submit time (0n = never).
 * Returns undefined when a custom date is missing/invalid.
 */
export function resolveExpiry(choice: ExpiryChoice, custom: string): bigint | undefined {
  if (choice === "never") return 0n;
  if (choice === "custom") {
    const s = parseLocalInput(custom);
    return s === undefined ? undefined : BigInt(s);
  }
  return BigInt(nowSeconds() + choice);
}

/** Validation message for the picker, or undefined when valid. `now` = 0 before hydration. */
export function expiryError(choice: ExpiryChoice, custom: string, now: number): string | undefined {
  if (choice !== "custom") return undefined;
  const s = parseLocalInput(custom);
  if (s === undefined) return "Choose a date and time.";
  if (now > 0 && s < now + MIN_CUSTOM_SECONDS) return "Expiration must be at least a minute in the future.";
  return undefined;
}

export function ExpiryPicker({
  value,
  custom,
  onChange,
  onCustomChange,
  allowNever,
  disabled,
  invalid,
  now,
  subject = "payment",
}: {
  value: ExpiryChoice;
  custom: string;
  onChange: (v: ExpiryChoice) => void;
  onCustomChange: (v: string) => void;
  allowNever: boolean;
  disabled?: boolean;
  invalid?: boolean;
  now: number;
  subject?: "payment" | "airdrop";
}) {
  const customSeconds = parseLocalInput(custom);
  return (
    <div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {EXPIRY_PRESETS.map((p) => (
          <Choice key={p.seconds} active={value === p.seconds} disabled={disabled} onClick={() => onChange(p.seconds)}>
            {p.label}
          </Choice>
        ))}
        <Choice
          active={value === "custom"}
          disabled={disabled}
          onClick={() => {
            onChange("custom");
            if (!custom) onCustomChange(toLocalInputValue(nowSeconds() + 3 * 24 * 3600));
          }}
        >
          Custom
        </Choice>
        <Choice
          active={value === "never"}
          disabled={disabled || !allowNever}
          title={allowNever ? undefined : "Available once ArcClaim V2 is deployed"}
          className="col-span-2"
          onClick={() => onChange("never")}
        >
          Never expires
        </Choice>
      </div>

      {value === "custom" && (
        <div className="mt-3 space-y-1.5">
          <input
            type="datetime-local"
            value={custom}
            min={now ? toLocalInputValue(now + MIN_CUSTOM_SECONDS) : undefined}
            onChange={(e) => onCustomChange(e.target.value)}
            disabled={disabled}
            className={cn(
              "h-12 w-full rounded-xl border bg-surface px-4 text-sm outline-none focus:border-accent focus:ring-4 focus:ring-accent/10",
              invalid ? "border-danger" : "border-border",
            )}
          />
          {customSeconds !== undefined && now > 0 && customSeconds > now && (
            <p className="text-xs text-muted">Expires in {formatDuration(customSeconds - now)}</p>
          )}
        </div>
      )}

      {value === "never" && (
        <p className="mt-3 rounded-xl border border-border bg-surface-2 px-4 py-3 text-sm leading-relaxed text-muted">
          {subject === "payment"
            ? NEVER_EXPIRES_COPY
            : "Never expires: recipients can claim at any time, and you can cancel to recover unclaimed USDC."}
        </p>
      )}
      {!allowNever && (
        <p className="mt-2 text-xs text-muted">&ldquo;Never expires&rdquo; becomes available once ArcClaim V2 is deployed.</p>
      )}
    </div>
  );
}

function Choice({
  active,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { active: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "h-10 rounded-xl border text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        active ? "border-primary bg-primary text-primary-fg" : "border-border bg-surface hover:bg-surface-2",
        className,
      )}
      {...props}
    />
  );
}
