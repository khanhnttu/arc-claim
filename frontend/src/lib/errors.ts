import { NETWORK_NAME } from "@/config/arc";
import {
  BaseError,
  ChainMismatchError,
  ContractFunctionRevertedError,
  InsufficientFundsError,
  UserRejectedRequestError,
} from "viem";

/** An error whose message is already safe to show to users. */
export class FriendlyError extends Error {}

const CONTRACT_ERRORS: Record<string, string> = {
  InvalidRecipient: "The recipient address is not valid.",
  InvalidAmount: "The amount must be greater than 0.",
  InvalidExpiry: "The expiration must be in the future.",
  ClaimNotFound: "This payment does not exist. Check the claim ID.",
  InvalidStatus: "This payment is no longer active — it was already claimed, cancelled or refunded.",
  NotRecipient: "Only the recipient wallet can claim this payment.",
  NotSender: "Only the sender can cancel this payment.",
  ClaimExpired: "This payment has expired.",
  ClaimNotExpired: "This payment has not expired yet.",
  SafeERC20FailedOperation: "The USDC transfer failed.",
  // ArcClaimV2
  PaymentNotFound: "This payment does not exist. Check the link.",
  PaymentExpired: "This payment has expired.",
  PaymentNotExpired: "This payment has not expired yet.",
  NeverExpires: "This never expires, so it cannot be refunded. The sender can cancel instead.",
  TransferAmountMismatch: "The token transferred a different amount than expected.",
  // ArcClaimBatch
  EmptyBatch: "Add at least one recipient.",
  TooManyRecipients: "Too many recipients in one transaction.",
  LengthMismatch: "Recipients and amounts don't line up.",
  DuplicateRecipient: "The same wallet appears more than once in this airdrop.",
  BatchNotFound: "This airdrop does not exist.",
  BatchNotActive: "This airdrop has already been refunded or cancelled.",
  AlreadyClaimed: "You already claimed this allocation.",
  BatchExpired: "This airdrop has expired.",
  BatchNotExpired: "This airdrop has not expired yet.",
  NothingToRefund: "Everything has been claimed — there is nothing to return.",
  ERC20InsufficientBalance: "You don't have enough USDC for this payment.",
  ERC20InsufficientAllowance: "USDC allowance is too low. Please approve again.",
};

/** Convert any wallet / RPC / contract error into a short, human-readable message. */
export function toFriendlyMessage(error: unknown): string {
  if (error instanceof FriendlyError) return error.message;

  if (error instanceof BaseError) {
    if (error.walk((e) => e instanceof UserRejectedRequestError)) {
      return "You rejected the request in your wallet.";
    }
    if (error.walk((e) => e instanceof ChainMismatchError)) {
      return `Your wallet is on the wrong network. Switch to ${NETWORK_NAME}.`;
    }
    if (error.walk((e) => e instanceof InsufficientFundsError)) {
      return "Not enough USDC to pay for gas. Get testnet USDC from the Arc faucet.";
    }
    const revert = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName;
      if (name && CONTRACT_ERRORS[name]) return CONTRACT_ERRORS[name];
      if (revert.reason) return matchText(revert.reason) ?? "The transaction would fail on-chain.";
    }
  }

  const text = String((error as { message?: string })?.message ?? error);
  return matchText(text) ?? "Something went wrong. Please try again.";
}

function matchText(text: string): string | undefined {
  const t = text.toLowerCase();
  if (t.includes("user rejected") || t.includes("user denied") || t.includes("rejected the request"))
    return "You rejected the request in your wallet.";
  if (t.includes("insufficient funds") || t.includes("gas required exceeds"))
    return "Not enough USDC to pay for gas. Get testnet USDC from the Arc faucet.";
  if (t.includes("exceeds balance") || t.includes("insufficient balance"))
    return "You don't have enough USDC for this payment.";
  if (t.includes("exceeds allowance") || t.includes("insufficient allowance"))
    return "USDC allowance is too low. Please approve again.";
  if (t.includes("chain") && (t.includes("mismatch") || t.includes("does not match")))
    return `Your wallet is on the wrong network. Switch to ${NETWORK_NAME}.`;
  for (const [name, message] of Object.entries(CONTRACT_ERRORS)) {
    if (text.includes(name)) return message;
  }
  return undefined;
}
