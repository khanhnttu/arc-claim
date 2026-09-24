import { getAddress, isAddress, parseUnits, zeroAddress, type Address } from "viem";
import { USDC_DECIMALS } from "@/config/arc";

/** Hard cap on rows per airdrop in the UI (each 200 rows = one transaction). */
export const MAX_AIRDROP_ROWS = 5_000;

export type RowIssue = "invalid-address" | "zero-address" | "invalid-amount" | "zero-amount" | "duplicate";

export type AirdropRow = {
  /** 1-based line number in the source text (for error messages). */
  line: number;
  wallet: string;
  amountText: string;
  address?: Address;
  amount?: bigint;
  issues: RowIssue[];
};

export type AirdropParseResult = {
  rows: AirdropRow[];
  validRows: { address: Address; amount: bigint }[];
  total: bigint;
  invalidAddresses: number;
  invalidAmounts: number;
  duplicateAddresses: number;
  /** Non-row problems (empty file, too many rows, …). */
  fileErrors: string[];
  isValid: boolean;
};

const AMOUNT_PATTERN = /^\d+(\.\d{1,6})?$/;
const HEADER_WALLET = /^(wallet|address|recipient)$/i;

export const ISSUE_LABEL: Record<RowIssue, string> = {
  "invalid-address": "Invalid address",
  "zero-address": "Zero address",
  "invalid-amount": "Invalid amount",
  "zero-amount": "Amount must be > 0",
  duplicate: "Duplicate address",
};

function splitLine(line: string): string[] {
  // Handles `a,b`, `"a","b"`, `a;b` and tabs. Airdrop CSVs are simple two-column files.
  const sep = line.includes(",") ? "," : line.includes(";") ? ";" : "\t";
  return line.split(sep).map((c) => c.trim().replace(/^"(.*)"$/, "$1").trim());
}

/**
 * Parse and validate `wallet,amount` CSV text. Only a UX pre-check:
 * the batch contract re-validates every row and computes the total itself.
 */
export function parseAirdropCsv(text: string): AirdropParseResult {
  const fileErrors: string[] = [];
  const rows: AirdropRow[] = [];

  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const [wallet = "", amountText = "", ...extra] = splitLine(line);
    if (rows.length === 0 && HEADER_WALLET.test(wallet)) return; // header row
    const row: AirdropRow = { line: i + 1, wallet, amountText, issues: [] };

    if (!isAddress(wallet, { strict: false })) row.issues.push("invalid-address");
    else if (wallet.toLowerCase() === zeroAddress) row.issues.push("zero-address");
    else row.address = getAddress(wallet);

    const normalized = amountText.replace(/_/g, "");
    if (extra.some((c) => c !== "") || !AMOUNT_PATTERN.test(normalized)) row.issues.push("invalid-amount");
    else {
      const amount = parseUnits(normalized, USDC_DECIMALS);
      if (amount === 0n) row.issues.push("zero-amount");
      else row.amount = amount;
    }
    rows.push(row);
  });

  // Every occurrence of a repeated address is flagged, so the sender sees all of them.
  const counts = new Map<string, number>();
  for (const r of rows) if (r.address) counts.set(r.address, (counts.get(r.address) ?? 0) + 1);
  for (const r of rows) if (r.address && counts.get(r.address)! > 1) r.issues.push("duplicate");

  if (rows.length === 0) fileErrors.push("No recipients found. Use the format: wallet,amount");
  if (rows.length > MAX_AIRDROP_ROWS)
    fileErrors.push(`Too many rows (${rows.length}). The maximum is ${MAX_AIRDROP_ROWS.toLocaleString()} per airdrop.`);

  const validRows = rows
    .filter((r) => r.issues.length === 0)
    .map((r) => ({ address: r.address!, amount: r.amount! }));
  const total = validRows.reduce((s, r) => s + r.amount, 0n);

  const invalidAddresses = rows.filter(
    (r) => r.issues.includes("invalid-address") || r.issues.includes("zero-address"),
  ).length;
  const invalidAmounts = rows.filter(
    (r) => r.issues.includes("invalid-amount") || r.issues.includes("zero-amount"),
  ).length;
  const duplicateAddresses = [...counts.values()].filter((c) => c > 1).length;

  return {
    rows,
    validRows,
    total,
    invalidAddresses,
    invalidAmounts,
    duplicateAddresses,
    fileErrors,
    isValid: fileErrors.length === 0 && rows.length > 0 && validRows.length === rows.length,
  };
}

export const AIRDROP_CSV_TEMPLATE = `wallet,amount
0x4943bd630ff69f1a2fd888667dda4815cefd551e,10
0x62628a9bb100d15494d00f6c76c22c975bbb7195,5.5
`;
