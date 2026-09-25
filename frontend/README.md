# ArcClaim — frontend

Create a USDC payment. The recipient can claim it before a deadline; otherwise the sender gets the money back.

Next.js (App Router) + TypeScript + Tailwind + wagmi/viem + RainbowKit, talking directly to the deployed
ArcClaim contracts on **Arc Testnet** (chain 5042002, default) or **Arc Mainnet** (chain 5042), selected with the
network switcher in the navbar. No backend — the chain is the source of truth.

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
| `/activity`   | Your payments (v2 + Phase 1) and airdrops with Cancel / Refund / Resend (`/dashboard` redirects here) |

The selected network is stored in `localStorage` under `arcclaim:network`; shared links add `?network=testnet|mainnet`.

## Where things live

- `src/config/arc.ts` — per-network chain id, RPC, USDC, ArcClaim contract addresses + deploy blocks, explorer helpers
- `src/components/NetworkProvider.tsx` — selected network state (`useNetwork()`), persisted across reloads
- `src/components/NetworkSwitcher.tsx` — navbar switcher, wrong-network banner, network-aware footer
- `src/contracts/*.ts` — ABIs and status enums (no addresses)
- `src/hooks/` — `useClaim`, `useCreateClaim`, `useClaimPayment`, `useCancelClaim`, `useRefundExpired`, `useSenderClaims`
- `src/lib/errors.ts` — maps wallet/contract errors to readable messages
