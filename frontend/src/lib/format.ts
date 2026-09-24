import { formatUnits, type Address } from "viem";
import { USDC_DECIMALS } from "@/config/arc";

export function shortAddress(address?: string, chars = 4): string {
  if (!address) return "";
  return `${address.slice(0, 2 + chars)}…${address.slice(-chars)}`;
}

/** 5000000n -> "5", 1234567890n -> "1,234.56789" */
export function formatUsdc(amount: bigint | undefined, maxDecimals = USDC_DECIMALS): string {
  if (amount === undefined) return "—";
  const [whole, frac = ""] = formatUnits(amount, USDC_DECIMALS).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const trimmed = frac.slice(0, maxDecimals).replace(/0+$/, "");
  return trimmed ? `${grouped}.${trimmed}` : grouped;
}

const UNITS: [label: string, seconds: number][] = [
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
  ["second", 1],
];

/** 582 -> "9 minutes 42 seconds" (two most significant units). */
export function formatDuration(totalSeconds: number): string {
  let rest = Math.max(0, Math.floor(totalSeconds));
  if (rest === 0) return "0 seconds";
  const parts: string[] = [];
  for (const [label, size] of UNITS) {
    const n = Math.floor(rest / size);
    if (n > 0) {
      parts.push(`${n} ${label}${n === 1 ? "" : "s"}`);
      rest -= n * size;
    }
    if (parts.length === 2) break;
  }
  return parts.join(" ");
}

/** 141 -> "2m 21s", 257_000 -> "2d 23h" (two most significant units, compact). */
export function formatDurationShort(totalSeconds: number): string {
  let rest = Math.max(0, Math.floor(totalSeconds));
  if (rest === 0) return "0s";
  const parts: string[] = [];
  for (const [unit, size] of [
    ["d", 86_400],
    ["h", 3_600],
    ["m", 60],
    ["s", 1],
  ] as const) {
    const n = Math.floor(rest / size);
    if (n > 0) {
      parts.push(`${n}${unit}`);
      rest -= n * size;
    }
    if (parts.length === 2) break;
  }
  return parts.join(" ");
}

export function formatDate(unixSeconds: bigint | number): string {
  return new Date(Number(unixSeconds) * 1000).toLocaleDateString(undefined, { dateStyle: "medium" });
}

/** Relative phrase for an expiry timestamp: "in 9 minutes 42 seconds" / "3 minutes ago". */
export function formatExpiry(expiry: bigint, nowSeconds: number): string {
  const diff = Number(expiry) - nowSeconds;
  return diff > 0 ? `in ${formatDuration(diff)}` : `${formatDuration(-diff)} ago`;
}

export function formatDateTime(unixSeconds: bigint | number): string {
  return new Date(Number(unixSeconds) * 1000).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export const sameAddress = (a?: Address | string, b?: Address | string) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();
