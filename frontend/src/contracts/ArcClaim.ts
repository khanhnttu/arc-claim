// Phase 1 ArcClaim. Deployment addresses per network live in src/config/arc.ts.

export const ClaimStatus = {
  NONE: 0,
  FUNDED: 1,
  CLAIMED: 2,
  CANCELLED: 3,
  REFUNDED: 4,
} as const;

export type ClaimStatusValue = (typeof ClaimStatus)[keyof typeof ClaimStatus];

export const CLAIM_STATUS_LABEL: Record<number, string> = {
  0: "NONE",
  1: "FUNDED",
  2: "CLAIMED",
  3: "CANCELLED",
  4: "REFUNDED",
};

/** ABI copied from the compiled contract (contracts/out/ArcClaim.sol/ArcClaim.json). */
export const arcClaimAbi = [
  {
    type: "function",
    name: "cancel",
    inputs: [{ name: "claimId", type: "uint256", internalType: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "claim",
    inputs: [{ name: "claimId", type: "uint256", internalType: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "createClaim",
    inputs: [
      { name: "recipient", type: "address", internalType: "address" },
      { name: "amount", type: "uint256", internalType: "uint256" },
      { name: "expiry", type: "uint256", internalType: "uint256" },
    ],
    outputs: [{ name: "claimId", type: "uint256", internalType: "uint256" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "getClaim",
    inputs: [{ name: "claimId", type: "uint256", internalType: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        internalType: "struct ArcClaim.Claim",
        components: [
          { name: "sender", type: "address", internalType: "address" },
          { name: "recipient", type: "address", internalType: "address" },
          { name: "amount", type: "uint256", internalType: "uint256" },
          { name: "expiry", type: "uint256", internalType: "uint256" },
          { name: "status", type: "uint8", internalType: "enum ArcClaim.ClaimStatus" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "refundExpired",
    inputs: [{ name: "claimId", type: "uint256", internalType: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    name: "ClaimCreated",
    inputs: [
      { name: "claimId", type: "uint256", indexed: true, internalType: "uint256" },
      { name: "sender", type: "address", indexed: true, internalType: "address" },
      { name: "recipient", type: "address", indexed: true, internalType: "address" },
      { name: "amount", type: "uint256", indexed: false, internalType: "uint256" },
      { name: "expiry", type: "uint256", indexed: false, internalType: "uint256" },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Claimed",
    inputs: [
      { name: "claimId", type: "uint256", indexed: true, internalType: "uint256" },
      { name: "recipient", type: "address", indexed: true, internalType: "address" },
      { name: "amount", type: "uint256", indexed: false, internalType: "uint256" },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Cancelled",
    inputs: [
      { name: "claimId", type: "uint256", indexed: true, internalType: "uint256" },
      { name: "sender", type: "address", indexed: true, internalType: "address" },
      { name: "amount", type: "uint256", indexed: false, internalType: "uint256" },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "ExpiredRefunded",
    inputs: [
      { name: "claimId", type: "uint256", indexed: true, internalType: "uint256" },
      { name: "sender", type: "address", indexed: true, internalType: "address" },
      { name: "amount", type: "uint256", indexed: false, internalType: "uint256" },
    ],
    anonymous: false,
  },
  { type: "error", name: "ClaimExpired", inputs: [] },
  { type: "error", name: "ClaimNotExpired", inputs: [] },
  { type: "error", name: "ClaimNotFound", inputs: [] },
  { type: "error", name: "InvalidAmount", inputs: [] },
  { type: "error", name: "InvalidExpiry", inputs: [] },
  { type: "error", name: "InvalidRecipient", inputs: [] },
  { type: "error", name: "InvalidStatus", inputs: [] },
  { type: "error", name: "InvalidToken", inputs: [] },
  { type: "error", name: "NotRecipient", inputs: [] },
  { type: "error", name: "NotSender", inputs: [] },
  { type: "error", name: "ReentrancyGuardReentrantCall", inputs: [] },
  {
    type: "error",
    name: "SafeERC20FailedOperation",
    inputs: [{ name: "token", type: "address", internalType: "address" }],
  },
] as const;

