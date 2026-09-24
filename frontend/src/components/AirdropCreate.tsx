"use client";

import Link from "next/link";
import { useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { useAccount } from "wagmi";
import { explorerTxUrl } from "@/config/arc";
import { MAX_RECIPIENTS_PER_CALL } from "@/contracts/ArcClaimBatch";
import { useCreateBatch, chunkRows } from "@/hooks/useCreateBatch";
import { useNow } from "@/hooks/useNow";
import { useUsdcBalance } from "@/hooks/useUsdcBalance";
import { batchPath, batchUrl, isBatchEnabled } from "@/lib/batches";
import { AIRDROP_CSV_TEMPLATE, ISSUE_LABEL, parseAirdropCsv, type AirdropRow } from "@/lib/csv";
import { formatUsdc, shortAddress } from "@/lib/format";
import { CopyButton } from "./CopyButton";
import { StepProgress } from "./CreatePaymentForm";
import { EXPIRY_PRESETS, ExpiryPicker, expiryError, resolveExpiry, type ExpiryChoice } from "./ExpiryPicker";
import { WalletButton } from "./WalletButton";
import { Button, Card, Notice, buttonClass, cn } from "./ui";

const PREVIEW_PAGE = 50;

/** CSV upload → parse → validate → preview → confirm → approve → create batch (+ add chunks). */
export function AirdropCreate() {
  const { address, isConnected } = useAccount();
  const balance = useUsdcBalance(address);
  const tx = useCreateBatch();
  const now = useNow();

  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string>();
  const [expiry, setExpiry] = useState<ExpiryChoice>(EXPIRY_PRESETS[3].seconds);
  const [custom, setCustom] = useState("");
  const [page, setPage] = useState(0);
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const parsed = useMemo(() => (text.trim() ? parseAirdropCsv(text) : undefined), [text]);
  const txCount = parsed ? chunkRows(parsed.validRows).length : 0;
  const expiryMsg = expiryError(expiry, custom, now);
  const insufficient = parsed && balance.data !== undefined && parsed.total > balance.data;
  const canSubmit =
    isBatchEnabled && !!parsed?.isValid && !expiryMsg && !insufficient && confirmed && isConnected && !tx.isBusy;

  function loadFile(file: File) {
    setFileName(file.name);
    setPage(0);
    setConfirmed(false);
    tx.reset();
    file.text().then(setText);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) loadFile(f);
  }

  function downloadTemplate() {
    const url = URL.createObjectURL(new Blob([AIRDROP_CSV_TEMPLATE], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "arcclaim-airdrop-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function submit() {
    if (!parsed?.isValid) return;
    const resolved = resolveExpiry(expiry, custom);
    if (resolved === undefined) return;
    await tx.create(parsed.validRows, resolved);
  }

  if (tx.step === "success" && tx.result) {
    const r = tx.result;
    return (
      <Card className="p-5 sm:p-7">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-success-bg text-success">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
              <path d="m5 12 5 5 9-10" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold tracking-tight">Airdrop ready</h2>
            <p className="mt-0.5 text-sm text-muted">
              {formatUsdc(r.total)} USDC locked for {r.count.toLocaleString()} recipient{r.count === 1 ? "" : "s"}.
              Share the link — each recipient connects their wallet to claim their own allocation.
            </p>
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <Link
            href={`${batchPath(r.batchId)}?created=1`}
            className={buttonClass({ size: "lg", className: "flex-1" })}
          >
            Open airdrop
          </Link>
          <CopyButton value={batchUrl(r.batchId)} label="Copy Airdrop Link" className="h-12 flex-1" />
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border pt-4 text-xs text-muted">
          <span className="flex flex-wrap gap-x-3">
            {r.txHashes.map((h, i) => (
              <a key={h} href={explorerTxUrl(h)} target="_blank" rel="noreferrer" className="hover:text-fg">
                {r.txHashes.length > 1 ? `Transaction ${i + 1}` : "View transaction"} ↗
              </a>
            ))}
          </span>
          <button
            type="button"
            className="hover:text-fg"
            onClick={() => {
              tx.reset();
              setText("");
              setFileName(undefined);
              setConfirmed(false);
            }}
          >
            Create another airdrop
          </button>
        </div>
      </Card>
    );
  }

  const rows = parsed ? (onlyIssues ? parsed.rows.filter((r) => r.issues.length > 0) : parsed.rows) : [];
  const pageRows = rows.slice(page * PREVIEW_PAGE, (page + 1) * PREVIEW_PAGE);
  const pages = Math.max(1, Math.ceil(rows.length / PREVIEW_PAGE));

  return (
    <Card className="p-5 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Create an Airdrop</h2>
          <p className="mt-1 text-sm text-muted">
            Distribute USDC to multiple wallets. Each recipient gets an individual allocation and can claim it directly.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={downloadTemplate}>
          Download template
        </Button>
      </div>

      {/* 1. Upload */}
      <div className="mt-6">
        <h3 className="text-sm font-semibold">Upload recipient list</h3>
        <p className="mt-0.5 text-sm text-muted">
          Upload a CSV containing wallet addresses and USDC amounts. Format:{" "}
          <span className="font-mono text-fg">wallet,amount</span>
        </p>
      </div>
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        className="mt-3 rounded-xl border border-dashed border-border bg-surface-2 p-5 text-center"
      >
        <input
          ref={fileInput}
          type="file"
          accept=".csv,text/csv,text/plain"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && loadFile(e.target.files[0])}
        />
        <p className="text-sm">
          {fileName ? (
            <>
              Loaded <span className="font-medium">{fileName}</span>
            </>
          ) : (
            "Drag a CSV file here, or"
          )}
        </p>
        <Button
          variant="secondary"
          size="sm"
          className="mt-3"
          disabled={tx.isBusy}
          onClick={() => fileInput.current?.click()}
        >
          {fileName ? "Choose another file" : "Upload CSV"}
        </Button>
      </div>
      <details className="mt-3 text-sm" open={!!text && !fileName}>
        <summary className="cursor-pointer text-muted hover:text-fg">…or paste CSV text</summary>
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setFileName(undefined);
            setPage(0);
            setConfirmed(false);
          }}
          disabled={tx.isBusy}
          rows={6}
          placeholder={"wallet,amount\n0xAAA…,10\n0xBBB…,5"}
          spellCheck={false}
          className="mt-2 w-full rounded-xl border border-border bg-surface p-3 font-mono text-xs outline-none focus:border-accent"
        />
      </details>

      {parsed && (
        <>
          {/* 2. Airdrop preview (validation summary) */}
          <h3 className="mt-6 text-sm font-semibold">Airdrop preview</h3>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Recipients" value={parsed.rows.length.toLocaleString()} />
            <Stat
              label="Total amount"
              value={`${formatUsdc(parsed.total)} USDC`}
              hint={parsed.isValid ? undefined : "valid rows only"}
              strong
            />
            <Stat label="Valid wallets" value={parsed.validRows.length.toLocaleString()} />
            <Stat
              label="Errors"
              value={(parsed.rows.length - parsed.validRows.length).toLocaleString()}
              bad={parsed.rows.length > parsed.validRows.length}
            />
          </div>
          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
            <span className={cn(parsed.invalidAddresses > 0 && "font-medium text-danger")}>
              Invalid addresses: {parsed.invalidAddresses}
            </span>
            <span className={cn(parsed.duplicateAddresses > 0 && "font-medium text-danger")}>
              Duplicate addresses: {parsed.duplicateAddresses}
            </span>
            <span className={cn(parsed.invalidAmounts > 0 && "font-medium text-danger")}>
              Invalid amounts: {parsed.invalidAmounts}
            </span>
            <span>
              {txCount} transaction{txCount === 1 ? "" : "s"} ({MAX_RECIPIENTS_PER_CALL} recipients each)
            </span>
          </p>

          {parsed.fileErrors.map((e) => (
            <Notice key={e} tone="error" className="mt-3">
              {e}
            </Notice>
          ))}
          {!parsed.isValid && parsed.rows.length > 0 && (
            <Notice tone="error" className="mt-3">
              Fix the highlighted rows before creating the airdrop. Duplicate wallets must be merged into one row.
            </Notice>
          )}
          {insufficient && (
            <Notice tone="error" className="mt-3">
              Insufficient USDC: the airdrop needs {formatUsdc(parsed.total)} USDC and your balance is{" "}
              {formatUsdc(balance.data)} USDC.
            </Notice>
          )}

          {/* 3. Preview */}
          <div className="mt-5 overflow-hidden rounded-xl border border-border">
            <div className="flex items-center justify-between gap-2 border-b border-border bg-surface-2 px-4 py-2 text-xs">
              <span className="font-medium text-muted uppercase">Recipient list</span>
              <label className="flex items-center gap-2 text-muted">
                <input
                  type="checkbox"
                  checked={onlyIssues}
                  onChange={(e) => {
                    setOnlyIssues(e.target.checked);
                    setPage(0);
                  }}
                />
                Only rows with issues
              </label>
            </div>
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface text-left text-xs text-muted">
                  <tr>
                    <th className="px-4 py-2 font-medium">Line</th>
                    <th className="px-4 py-2 font-medium">Wallet</th>
                    <th className="px-4 py-2 text-right font-medium">Amount</th>
                    <th className="px-4 py-2 font-medium">Check</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {pageRows.map((r) => (
                    <PreviewRow key={r.line} row={r} />
                  ))}
                  {pageRows.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-4 py-6 text-center text-muted">
                        No rows with issues.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {pages > 1 && (
              <div className="flex items-center justify-between border-t border-border px-4 py-2 text-xs text-muted">
                <span>
                  Page {page + 1} of {pages}
                </span>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>
                    Previous
                  </Button>
                  <Button size="sm" variant="ghost" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
                    Next
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* 4. Expiry + confirm */}
          <div className="mt-6 space-y-2">
            <p className="text-sm font-medium">Claim period</p>
            <ExpiryPicker
              value={expiry}
              custom={custom}
              onChange={setExpiry}
              onCustomChange={setCustom}
              allowNever
              disabled={tx.isBusy || tx.canResume}
              invalid={!!expiryMsg}
              now={now}
              subject="airdrop"
            />
            {expiryMsg && <p className="text-xs font-medium text-danger">{expiryMsg}</p>}
            {expiry !== "never" && (
              <p className="text-xs text-muted">
                After the deadline, you can recover any unclaimed USDC. Claimed allocations are never refunded.
              </p>
            )}
          </div>

          {parsed.isValid && (
            <label className="mt-5 flex items-start gap-3 rounded-xl border border-border p-4 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={confirmed}
                disabled={tx.isBusy}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              <span>
                I confirm sending <strong>{formatUsdc(parsed.total)} USDC</strong> to{" "}
                <strong>{parsed.validRows.length.toLocaleString()} recipients</strong> in {txCount} transaction
                {txCount === 1 ? "" : "s"} (plus one USDC approval if needed).
              </span>
            </label>
          )}

          {tx.isBusy && <CreateProgress tx={tx} />}
          {tx.step === "error" && tx.error && (
            <Notice tone="error" className="mt-4">
              {tx.error}
              {tx.canResume && (
                <>
                  {" "}
                  {tx.progress.done} of {tx.progress.total} transactions completed. You can resume — already-funded
                  recipients will not be charged again.
                </>
              )}
            </Notice>
          )}

          <div className="mt-5">
            {!isBatchEnabled ? (
              <Notice tone="warning">
                ArcClaimBatch is not deployed yet, so airdrops can be validated but not created.
              </Notice>
            ) : !isConnected ? (
              <WalletButton block label="Connect Wallet to create the airdrop" />
            ) : (
              <Button size="lg" className="w-full" disabled={!canSubmit} loading={tx.isBusy} onClick={submit}>
                {tx.canResume ? "Resume airdrop" : "Create Airdrop"}
              </Button>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

function CreateProgress({ tx }: { tx: ReturnType<typeof useCreateBatch> }) {
  const { step, progress, needsApproval } = tx;
  const current = Math.min(progress.done + 1, progress.total);
  const message =
    step === "checking"
      ? "Checking USDC balance and allowance…"
      : step === "approve-wallet" || step === "tx-wallet"
        ? "Waiting for wallet confirmation…"
        : step === "approving"
          ? "Approving USDC…"
          : step === "approved"
            ? "USDC approved."
            : progress.total > 1
              ? `Creating airdrop… transaction ${current} of ${progress.total}`
              : "Creating airdrop…";
  const steps = [
    ...(needsApproval
      ? [{ label: "Approve USDC", done: step === "approved" || step.startsWith("tx"), active: step.startsWith("approv") }]
      : []),
    ...Array.from({ length: progress.total }, (_, i) => ({
      label: progress.total > 1 ? `Batch ${i + 1}/${progress.total}` : "Create airdrop",
      done: i < progress.done,
      active: i === progress.done && step.startsWith("tx"),
    })),
  ];
  return (
    <div className="mt-4">
      <StepProgress message={message} steps={steps} />
    </div>
  );
}

function PreviewRow({ row }: { row: AirdropRow }) {
  const bad = row.issues.length > 0;
  return (
    <tr className={cn(bad && "bg-danger-bg/60")}>
      <td className="px-4 py-2 text-xs text-muted tabular-nums">{row.line}</td>
      <td className="px-4 py-2 font-mono text-xs" title={row.wallet}>
        {row.address ? shortAddress(row.address, 6) : row.wallet || <span className="text-muted">(empty)</span>}
      </td>
      <td className="px-4 py-2 text-right tabular-nums">
        {row.amount !== undefined ? formatUsdc(row.amount) : row.amountText || <span className="text-muted">(empty)</span>}
      </td>
      <td className="px-4 py-2 text-xs">
        {bad ? (
          <span className="font-medium text-danger">{row.issues.map((i) => ISSUE_LABEL[i]).join(", ")}</span>
        ) : (
          <span className="text-success">OK</span>
        )}
      </td>
    </tr>
  );
}

function Stat({
  label,
  value,
  hint,
  strong,
  bad,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  strong?: boolean;
  bad?: boolean;
}) {
  return (
    <div className={cn("rounded-xl border p-3", bad ? "border-danger/30 bg-danger-bg" : "border-border bg-surface")}>
      <p className={cn("text-xs", bad ? "text-danger" : "text-muted")}>{label}</p>
      <p className={cn("mt-1 tabular-nums", strong ? "text-lg font-semibold" : "font-medium", bad && "text-danger")}>
        {value}
      </p>
      {hint && <p className="text-[11px] text-muted">{hint}</p>}
    </div>
  );
}
