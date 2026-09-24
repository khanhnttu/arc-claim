"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { isAddress, parseUnits, zeroAddress, type Address } from "viem";
import { useAccount } from "wagmi";
import { USDC_DECIMALS } from "@/config/arc";
import { useCreatePayment, type CreateStep } from "@/hooks/useCreatePayment";
import { useNow } from "@/hooks/useNow";
import { useUsdcBalance } from "@/hooks/useUsdcBalance";
import { formatUsdc } from "@/lib/format";
import { isV2Enabled } from "@/lib/payments";
import { CreateSuccess } from "./CreateSuccess";
import { EXPIRY_PRESETS, ExpiryPicker, expiryError, resolveExpiry, type ExpiryChoice } from "./ExpiryPicker";
import { WalletButton } from "./WalletButton";
import { Button, Card, Notice, Spinner, cn } from "./ui";

const AMOUNT_PATTERN = /^\d+(\.\d{0,6})?$/;

type Errors = Partial<Record<"recipient" | "amount" | "expiry", string>>;

/** Values pre-filled by a "Resend" link. The sender can change all of them. */
export type PaymentPrefill = { recipient?: string; amount?: string; neverExpires?: boolean };

function validate(recipient: string, amount: string, balance: bigint | undefined) {
  const errors: Errors = {};
  const r = recipient.trim();
  if (!r) errors.recipient = "Enter the recipient's wallet address.";
  else if (!isAddress(r, { strict: false })) errors.recipient = "This is not a valid Ethereum address.";
  else if (r.toLowerCase() === zeroAddress) errors.recipient = "Recipient cannot be the zero address.";

  let parsedAmount: bigint | undefined;
  const a = amount.trim();
  if (!a) errors.amount = "Enter an amount.";
  else if (!AMOUNT_PATTERN.test(a)) errors.amount = "Use a number with up to 6 decimals.";
  else {
    parsedAmount = parseUnits(a, USDC_DECIMALS);
    if (parsedAmount <= 0n) errors.amount = "Amount must be greater than 0.";
    else if (balance !== undefined && parsedAmount > balance) errors.amount = "Insufficient USDC balance.";
  }
  return { errors, parsedAmount };
}

export function CreatePaymentForm({ prefill }: { prefill?: PaymentPrefill }) {
  const { address, isConnected } = useAccount();
  const balance = useUsdcBalance(address);
  const tx = useCreatePayment();
  const now = useNow();

  const isResend = !!prefill?.recipient || !!prefill?.amount;
  const [recipient, setRecipient] = useState(prefill?.recipient ?? "");
  const [amount, setAmount] = useState(prefill?.amount ?? "");
  const [expiry, setExpiry] = useState<ExpiryChoice>(
    prefill?.neverExpires && isV2Enabled ? "never" : EXPIRY_PRESETS[0].seconds,
  );
  const [custom, setCustom] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const { errors, parsedAmount } = validate(recipient, amount, balance.data);
  const expiryMsg = expiryError(expiry, custom, now);
  if (expiryMsg) errors.expiry = expiryMsg;
  const showErrors = submitted ? errors : {};

  if (tx.step === "success" && tx.result) {
    return (
      <CreateSuccess
        result={tx.result}
        onReset={() => {
          tx.reset();
          setRecipient("");
          setAmount("");
          setSubmitted(false);
        }}
      />
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    const resolved = resolveExpiry(expiry, custom);
    if (Object.keys(errors).length > 0 || parsedAmount === undefined || resolved === undefined) return;
    await tx.create({ recipient: recipient.trim() as Address, amount: parsedAmount, expiry: resolved });
  }

  const locked = tx.isBusy;

  return (
    <Card className="p-5 sm:p-7">
      <form onSubmit={onSubmit} noValidate className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{isResend ? "Resend a Payment" : "Send a Payment"}</h2>
          <p className="mt-1 text-sm text-muted">
            {isResend
              ? "Pre-filled from a previous payment. This creates a brand-new payment — the original stays unchanged."
              : "Send USDC to a specific recipient. They can claim it before the deadline, or you can recover the funds if it remains unclaimed."}
          </p>
        </div>

        <Field label="Recipient" htmlFor="recipient" error={showErrors.recipient}>
          <input
            id="recipient"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="Wallet address (0x…)"
            autoComplete="off"
            spellCheck={false}
            disabled={locked}
            className={inputClass(!!showErrors.recipient, "font-mono")}
          />
        </Field>

        <Field
          label="Amount"
          htmlFor="amount"
          error={showErrors.amount}
          hint={
            isConnected ? (
              <button
                type="button"
                disabled={locked || balance.data === undefined}
                onClick={() => balance.data !== undefined && setAmount(formatUsdc(balance.data).replace(/,/g, ""))}
                className="hover:text-fg"
              >
                Balance: {balance.data === undefined ? "…" : `${formatUsdc(balance.data)} USDC`}
              </button>
            ) : undefined
          }
        >
          <div className="relative">
            <input
              id="amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(",", "."))}
              placeholder="0.00"
              inputMode="decimal"
              autoComplete="off"
              disabled={locked}
              className={inputClass(!!showErrors.amount, "pr-16 text-lg tabular-nums")}
            />
            <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm font-medium text-muted">
              USDC
            </span>
          </div>
        </Field>

        <Field label="Claim period" error={showErrors.expiry}>
          <ExpiryPicker
            value={expiry}
            custom={custom}
            onChange={setExpiry}
            onCustomChange={setCustom}
            allowNever={isV2Enabled}
            disabled={locked}
            invalid={!!showErrors.expiry}
            now={now}
          />
        </Field>

        {tx.isBusy && <Progress step={tx.step} needsApproval={tx.needsApproval} message={tx.message} />}
        {tx.step === "error" && tx.error && <Notice tone="error">{tx.error}</Notice>}

        {isConnected ? (
          <Button type="submit" size="lg" className="w-full" loading={locked}>
            {locked ? "Processing…" : isResend ? "Create new payment" : "Create Payment"}
          </Button>
        ) : (
          <WalletButton block label="Connect Wallet to create a payment" />
        )}

        <p className="text-center text-xs text-muted">
          You&apos;ll approve exactly this amount of USDC, then confirm the payment. Two wallet prompts at most.
        </p>
      </form>
    </Card>
  );
}

export function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={htmlFor} className="text-sm font-medium">
          {label}
        </label>
        {hint && <span className="text-xs text-muted">{hint}</span>}
      </div>
      {children}
      {error && <p className="text-xs font-medium text-danger">{error}</p>}
    </div>
  );
}

export function inputClass(invalid: boolean, extra?: string) {
  return cn(
    "h-12 w-full rounded-xl border bg-surface px-4 text-sm outline-none transition-colors placeholder:text-muted/70",
    "focus:border-accent focus:ring-4 focus:ring-accent/10 disabled:opacity-60",
    invalid ? "border-danger" : "border-border",
    extra,
  );
}

const STEP_ORDER: CreateStep[] = ["checking", "approve-wallet", "approving", "approved", "create-wallet", "creating", "success"];

function Progress({ step, needsApproval, message }: { step: CreateStep; needsApproval: boolean; message: string }) {
  const idx = STEP_ORDER.indexOf(step);
  const steps = [
    ...(needsApproval
      ? [{ label: "Approve USDC", done: idx >= STEP_ORDER.indexOf("approved"), active: idx >= 1 && idx <= 2 }]
      : []),
    { label: "Create payment", done: false, active: idx >= STEP_ORDER.indexOf("create-wallet") },
  ];
  return <StepProgress message={message} steps={steps} />;
}

export function StepProgress({
  message,
  steps,
}: {
  message: string;
  steps: { label: string; done: boolean; active: boolean }[];
}) {
  return (
    <div className="space-y-3 rounded-xl border border-border bg-surface-2 p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Spinner className="text-accent" />
        {message}
      </div>
      <ol className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
        {steps.map((s, i) => (
          <li
            key={s.label}
            className={cn("flex items-center gap-1.5", s.done ? "text-success" : s.active ? "text-fg" : "text-muted")}
          >
            <span
              className={cn(
                "grid h-4 w-4 place-items-center rounded-full border text-[10px]",
                s.done ? "border-success bg-success text-white" : "border-current",
              )}
            >
              {s.done ? "✓" : i + 1}
            </span>
            {s.label}
          </li>
        ))}
      </ol>
    </div>
  );
}
