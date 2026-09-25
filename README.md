<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="frontend/public/brand/arcclaim-logo-dark.png">
    <img alt="ArcClaim" src="frontend/public/brand/arcclaim-logo-light.png" width="266">
  </picture>
</p>

<h3 align="center">Programmable USDC Payments on Arc</h3>

<p align="center">Send to one. Distribute to many. Let recipients claim. Recover what's unclaimed.</p>

---

ArcClaim is a USDC payment and distribution app for the [Arc](https://arc.io) network. A sender locks USDC in a
smart contract for one or many recipients. Each recipient claims their own allocation with their wallet, and funds
that are not claimed before an optional deadline can be recovered by the sender.

The app has no backend or database: the contracts hold the funds and the blockchain is the only source of truth.

> **Unaudited software.** The contracts have not been audited. See the [risk disclaimer](#risk-disclaimer).

## Lifecycle: SEND → CLAIM → RECOVER

| Step | What happens |
| --- | --- |
| **Send** | The sender approves exactly the required USDC and locks it in the contract for one recipient (Single Payment) or many (Airdrop), with an optional claim deadline. |
| **Claim** | Each recipient connects their wallet and claims their own allocation. Only the assigned wallet can claim. |
| **Recover** | Unclaimed USDC goes back to the sender: by cancelling before the deadline (sender only), or by an expired refund after it. Anyone may trigger an expired refund, but the funds **always** go to the original sender. |

A deadline is optional. With **Never expires**, recipients can claim at any time, the sender can cancel before a
claim, and the expired-refund path is disabled.

## Modes

### Single Payment — `ArcClaimV2`

One sender, one recipient, one amount.

| State | Reached by | Who | When |
| --- | --- | --- | --- |
| `FUNDED` | `createPayment` | sender | deadline in the future, or `0` (never expires) |
| `CLAIMED` | `claim` | recipient only | before the deadline |
| `CANCELLED` | `cancel` | sender only | before the deadline |
| `REFUNDED` | `refundExpired` | anyone (funds go to sender) | at or after the deadline; never for never-expire payments |

Terminal states are final. "Resend" in the app creates a new payment pre-filled from an old one; the original is
never modified.

### Airdrop — `ArcClaimBatch`

One sender, many recipients, each with an independent allocation. Recipients can be uploaded as a
`wallet,amount` CSV, which the app validates (addresses, amounts, duplicates) and previews before sending.

- The contract validates every row and computes the total itself; it pulls exactly that total from the sender.
- Each wallet may appear at most once per airdrop.
- Up to 200 recipients per transaction. Larger lists are funded in several transactions under the same airdrop ID
  (`createBatch` followed by `addAllocations`).
- Each recipient claims only their own allocation. Claimed allocations are never refunded.
- The unclaimed remainder (`total − claimed`) returns to the sender, via `cancelBatch` (sender, before the
  deadline) or `refundExpired` (anyone, after it). Either action closes the airdrop.

Allocation states: `FUNDED` → `CLAIMED`, or `FUNDED` → `REFUNDED` / `CANCELLED` when the airdrop is closed.

## Arc Mainnet

| | |
| --- | --- |
| Chain ID | `5042` |
| RPC | `https://rpc.mainnet.arc.io` |
| Explorer | [explorer.arc.io](https://explorer.arc.io) |
| USDC (ERC-20 interface, 6 decimals) | `0x3600000000000000000000000000000000000000` |
| Gas token | USDC (native) |

### Deployed contracts

| Contract | Address | Deploy transaction |
| --- | --- | --- |
| ArcClaimV2 | [`0xDA2AfE4Ced93C02427F9924A628568D8405f5Dc4`](https://explorer.arc.io/address/0xDA2AfE4Ced93C02427F9924A628568D8405f5Dc4) | [`0x52e1…11d9`](https://explorer.arc.io/tx/0x52e1428d92e4bc54abf21d4004dcef1e8559c05adc70b096b9b6a0d58f2511d9) |
| ArcClaimBatch | [`0x8BDF2D2bDEd0d97eaeAA1Fc510cE6d005c920538`](https://explorer.arc.io/address/0x8BDF2D2bDEd0d97eaeAA1Fc510cE6d005c920538) | [`0x99de…d4b2`](https://explorer.arc.io/tx/0x99de4a4ca0a64438802d5f11d4abc3b5e20b51ba08a57f4136bafa5e996ad4b2) |

Both were deployed in block `22513232` with constructor argument `usdc_ = 0x3600000000000000000000000000000000000000`.
The deployed runtime bytecode matches a build of the sources in this repository.

<details>
<summary>Earlier Arc Testnet deployments (chain ID 5042002)</summary>

| Contract | Address |
| --- | --- |
| ArcClaim (Phase 1, numeric claim IDs) | `0xDA2AfE4Ced93C02427F9924A628568D8405f5Dc4` |
| ArcClaimV2 | `0xf9C01246746B4dd538D9fdEB08Df993473FE2948` |
| ArcClaimBatch | `0x6bA799909E960c3828F7ad1A7d9b4988Af56CFA1` |

The Phase 1 contract exists only on Arc Testnet. On Mainnet, the same address holds ArcClaimV2.
</details>

## Architecture

```
            ┌──────────────────────────── Browser (Next.js app) ────────────────────────────┐
            │  RainbowKit wallet  ·  wagmi / viem reads & writes  ·  event scans + cache    │
            └───────────────┬───────────────────────────────────────────────┬───────────────┘
                            │ JSON-RPC (Arc)                                │
             ┌──────────────▼──────────────┐                 ┌──────────────▼──────────────┐
             │ ArcClaimV2                  │                 │ ArcClaimBatch               │
             │ single payments             │                 │ airdrops / batch payments   │
             └──────────────┬──────────────┘                 └──────────────┬──────────────┘
                            └────────────── USDC (0x3600…0000) ─────────────┘
```

**Contracts**

- Solidity `^0.8.24`, OpenZeppelin `SafeERC20` and `ReentrancyGuard`, checks-effects-interactions.
- No owner, admin, pause, upgrade path, fees, or sweep function. Funds can only move to a payment's sender or
  recipient.
- Every deposit checks that the contract's USDC balance increased by exactly the expected amount.
- Payment and airdrop IDs are `bytes32` values derived on-chain from `(chainid, contract, nonce)`. They are opaque
  in URLs but **not secret**: authorization is always the connected wallet (`msg.sender`).
- Design notes: [`contracts/DESIGN-PHASE2.md`](contracts/DESIGN-PHASE2.md).

**Frontend**

- Reads state directly from the contracts and polls until a payment or airdrop is settled.
- Discovers a sender's payments and airdrops, and an airdrop's recipients, from contract events. The Arc RPC
  limits `eth_getLogs` to 10,000 blocks, so scans are chunked and cached in `localStorage` (only as a scan cache;
  live state is always re-read on-chain).
- Payment and airdrop pages show details only to the sender and the assigned recipients; other wallets see an
  eligibility message. This is a UI choice, not access control — all contract data is public on-chain.
- A network switcher in the navbar selects Arc Testnet (default) or Arc Mainnet; the choice is saved in
  `localStorage` (`arcclaim:network`). Chain IDs, RPCs, USDC, contract addresses and explorers for both networks
  live in one place: `frontend/src/config/arc.ts`. Shared claim/airdrop links carry `?network=` so they open on the
  right network.

App routes: `/` (send a payment) · `/pay/[id]` (claim a payment) · `/airdrop` (create and list airdrops) ·
`/airdrop/[id]` (airdrop status and claim) · `/activity` (your payments and airdrops) · `/claim/[id]` (Phase 1
payments, Testnet only).

## Tech stack

| Layer | Tools |
| --- | --- |
| Contracts | Solidity, Foundry (forge, cast, anvil), OpenZeppelin Contracts v5.7.0, forge-std v1.16.2 |
| Frontend | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4 |
| Web3 | wagmi 2, viem 2, RainbowKit 2, TanStack Query 5 |

## Testing

```bash
cd contracts
forge test
```

`forge test` reports **165 passing tests across 8 suites**, covering:

- create / claim / cancel / expired-refund paths for both contracts, including never-expire payments and airdrops
- expiry boundaries (`timestamp < expiry`, `== expiry`, `> expiry`)
- unauthorized claim, cancel, refund and top-up attempts
- input validation (lengths, zero address, zero amount, duplicates, expiry, per-transaction limit)
- exact USDC approval and transfer amounts, including rejection of fee-on-transfer tokens
- reentrancy attempts through a malicious test token
- 0 / 1 / N / mixed claimed-and-refunded airdrops
- fuzz tests and stateful invariants, e.g. the contract balance always equals the unclaimed amount of open
  airdrops, allocation statuses never move backwards, and recipients only ever receive their own claims

Tests use mock tokens. Arc's USDC routes transfers through Arc-specific precompiles that a local Foundry fork
cannot execute, so behavior against the real token was checked on-chain after deployment rather than in the suite.

## Local development

**Prerequisites:** Node.js 20.9+ (required by Next.js 16) and [Foundry](https://getfoundry.sh).

### Contracts

```bash
cd contracts
git clone --depth 1 --branch v1.16.2 https://github.com/foundry-rs/forge-std lib/forge-std
git clone --depth 1 --branch v5.7.0 https://github.com/OpenZeppelin/openzeppelin-contracts lib/openzeppelin-contracts
forge build
forge test
```

`contracts/lib/` is not committed; the versions above match `contracts/foundry.lock`.

### Frontend

```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev
```

Then open http://localhost:3000 and pick Testnet or Mainnet from the network switcher in the navbar. No
environment variables are needed to choose a network; both deployments are configured in
`frontend/src/config/arc.ts`.

All frontend variables are public (`NEXT_PUBLIC_*`); see `frontend/.env.example`. Optionally set
`NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` to enable WalletConnect wallets; without it, browser-extension wallets are
used. Other scripts: `npm run build`, `npm run lint`.

### Deploying contracts

`contracts/script/DeployPhase2.s.sol` deploys ArcClaimV2 and ArcClaimBatch. It reads `USDC_ADDRESS` from the
environment and takes the signer from the command line, for example an encrypted Foundry keystore
(`--account <name>`). Never commit private keys; `.env` files are ignored by git.

## Repository structure

```
.
├── contracts/                    Foundry project
│   ├── src/
│   │   ├── ArcClaimV2.sol        single payments (optional never-expire)
│   │   ├── ArcClaimBatch.sol     airdrops / batch payments
│   │   └── ArcClaim.sol          Phase 1 contract (Arc Testnet only)
│   ├── test/                     unit, fuzz, invariant and review tests
│   ├── script/                   deployment scripts
│   └── DESIGN-PHASE2.md          contract design and accounting model
└── frontend/                     Next.js app
    ├── public/brand/             logo assets
    └── src/
        ├── app/                  routes, layout, icons
        ├── components/           UI
        ├── config/               network and wallet configuration
        ├── contracts/            addresses and ABIs
        ├── hooks/                contract reads, writes and event scans
        └── lib/                  formatting, CSV parsing, error messages, helpers
```

## Risk disclaimer

ArcClaim is experimental software provided as-is, without warranty of any kind.

- The smart contracts **have not been audited** by a third party. Automated tests, fuzzing and invariant checks
  reduce but do not eliminate the risk of bugs, and they do not prove the contracts are secure.
- Contracts are immutable: there is no admin, pause, upgrade or recovery mechanism. A bug cannot be patched in
  place, and funds sent to the contracts can only leave through the paths described above.
- USDC is issued by Circle. If the USDC contract is paused, or the sender or a recipient is blocklisted, affected
  claims, cancellations or refunds will revert until that changes.
- USDC sent directly to a contract, rather than through `createPayment` / `createBatch` / `addAllocations`, cannot
  be recovered.
- Unclaimed funds in a never-expire airdrop stay locked until the sender cancels it.
- Payment and airdrop data, including recipient addresses and amounts, is public on-chain. Claim links are not
  secrets; only the assigned wallet can claim.

Use only amounts you are prepared to lose, and review the contract source before interacting with it.

## License

The Solidity sources carry an `SPDX-License-Identifier: MIT` header. The repository does not currently include a
separate `LICENSE` file.
