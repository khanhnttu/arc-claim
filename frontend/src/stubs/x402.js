// Stub for Coinbase CDP SDK's optional `@x402/*` peer packages.
// RainbowKit -> @base-org/account -> @coinbase/cdp-sdk references them for x402
// payments, which ArcClaim never uses. Aliased in next.config.ts so bundling succeeds.
function unavailable() {
  throw new Error("x402 payments are not supported in ArcClaim.");
}

export const toClientEvmSigner = unavailable;
