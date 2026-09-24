import type { NextConfig } from "next";

// Optional packages pulled in by @coinbase/cdp-sdk (via RainbowKit's Base Account
// connector) that are not installed. They are never executed by ArcClaim.
const X402_STUB = "./src/stubs/x402.js";
const x402Aliases = Object.fromEntries(
  [
    "@x402/core/client",
    "@x402/evm",
    "@x402/evm/exact/client",
    "@x402/evm/upto/client",
    "@x402/svm/exact/client",
  ].map((name) => [name, X402_STUB]),
);

const nextConfig: NextConfig = {
  turbopack: {
    resolveAlias: x402Aliases,
  },
};

export default nextConfig;
