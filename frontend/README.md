# ArcClaim — frontend

Create a USDC payment. The recipient can claim it before a deadline; otherwise the sender gets the money back.

Next.js (App Router) + TypeScript + Tailwind + wagmi/viem + RainbowKit, talking directly to the deployed
ArcClaim contract on **Arc Testnet** (chain 5042002). No backend — the chain is the source of truth.

## Run

```bash
npm install
cp .env.example .env.local   # optional
npm run dev                  # http://localhost:3000
```

## Routes

| Route         | Purpose                                                             |
| ------------- | ------------------------------------------------------------------- |
| `/`           | Create + fund a payment (exact-amount USDC approval, then `createClaim`) |
| `/claim/[id]` | Recipient claims; anyone can refund an expired payment                |
| `/pay/[id]`   | ArcClaimV2 payment (opaque `bytes32` id; supports never-expire)         |
| `/airdrop`    | CSV airdrop: upload → validate → preview → approve → create; your airdrops |
| `/airdrop/[id]` | Airdrop dashboard: progress, per-recipient status, claim / cancel / refund |
| `/dashboard`  | Sender's payments (v2 + Phase 1) with Cancel / Refund / Resend          |

Phase 2 contracts are enabled by the `NEXT_PUBLIC_ARC_CLAIM_V2_*` / `NEXT_PUBLIC_ARC_CLAIM_BATCH_*` variables
(see `.env.example`). Until they are set, the app behaves exactly like Phase 1.

## Where things live

- `src/config/arc.ts` — chain, RPC, USDC address/decimals, explorer helpers
- `src/contracts/ArcClaim.ts` — contract address, deploy block, ABI, status enum
- `src/hooks/` — `useClaim`, `useCreateClaim`, `useClaimPayment`, `useCancelClaim`, `useRefundExpired`, `useSenderClaims`
- `src/lib/errors.ts` — maps wallet/contract errors to readable messages
