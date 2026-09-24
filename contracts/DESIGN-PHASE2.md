# ArcClaim — Phase 2 design

Phase 1 (`ArcClaim`, `0xDA2AfE4Ced93C02427F9924A628568D8405f5Dc4`) is **unchanged** and stays live.
Phase 2 adds two new, independent contracts. Neither has an owner, admin, fee, pause or upgrade path.

| Contract        | Responsibility                                                      |
| --------------- | ------------------------------------------------------------------- |
| `ArcClaimV2`    | Single-recipient payments, with optional **never-expire** (`expiry = 0`) |
| `ArcClaimBatch` | One sender → many recipients (batch payments / CSV airdrops)          |

Both use OpenZeppelin `SafeERC20` + `ReentrancyGuard`, follow checks-effects-interactions, and verify that the
contract's USDC balance increased by exactly the expected amount on every deposit.

---

## 1. Identifiers (`bytes32`)

```
id = keccak256(abi.encode(block.chainid, address(this), nonce))   // nonce = 1, 2, 3 …
```

* Generated **by the contract** at creation and emitted in the creation event, so the frontend reads it from the
  receipt — no backend, no database, no UUID→id mapping.
* Opaque in URLs (`/pay/0x…`, `/airdrop/0x…`) instead of a guessable `1, 2, 3` counter.
* Bound to chain + contract, so an id can never collide with or be replayed against another deployment.
* **Not a secret.** Anyone can recompute ids from the public nonce, and all state is public on-chain.
  Authorization is always `msg.sender == recipient` (claim) or `msg.sender == sender` (cancel), checked by the contract.

---

## 2. `ArcClaimV2` — single payments

```
Status: NONE → FUNDED → CLAIMED | CANCELLED | REFUNDED      (terminal states are final)
```

| Action           | Who            | When                                                        |
| ---------------- | -------------- | ----------------------------------------------------------- |
| `createPayment`  | anyone (sender)| `recipient ≠ 0`, `amount > 0`, `expiry == 0 \|\| expiry > now` |
| `claim`          | recipient only | FUNDED and not expired                                     |
| `cancel`         | sender only    | FUNDED and not expired                                     |
| `refundExpired`  | anyone         | FUNDED, `expiry ≠ 0`, `now ≥ expiry` → **always pays sender**  |

"Not expired" means `expiry == 0 || now < expiry`. A never-expire payment (`expiry == 0`) can be claimed or
cancelled at any time and `refundExpired` **always reverts** (`NeverExpires`) for it.

**Resend** is not a contract feature. It is a frontend action that pre-fills a new `createPayment` with the old
recipient/amount. The old payment is never touched; history stays immutable.

---

## 3. `ArcClaimBatch` — batch payments / airdrops

### State

```
Batch      { sender, expiry, status, totalAmount, claimedAmount, recipientCount, claimedCount }
Allocation { amount (uint128), status }            keyed by (batchId, recipient)

BatchStatus:      NONE → ACTIVE → REFUNDED | CANCELLED
AllocationStatus: NONE → FUNDED → CLAIMED
                  FUNDED + batch REFUNDED  ⇒ reported as REFUNDED
                  FUNDED + batch CANCELLED ⇒ reported as CANCELLED
```

One recipient appears **at most once per batch**. Duplicates revert with `DuplicateRecipient(addr)`. Summing
duplicates would hide input mistakes, so the sender must merge them explicitly.

### Accounting (all computed on-chain)

* `createBatch` / `addAllocations` validate every row, **sum the amounts in the contract**, and pull exactly that sum.
* `claim` moves one allocation FUNDED → CLAIMED and adds it to `claimedAmount`.
* Unclaimed amount is always `totalAmount − claimedAmount`.
* `refundExpired` (anyone, after expiry) and `cancelBatch` (sender, before expiry) send
  `totalAmount − claimedAmount` to **`batch.sender`**, never `msg.sender`, and close the batch. Claimed allocations
  are excluded by construction, and the status flip makes a second refund impossible.

Invariant (fuzz-tested): `USDC.balanceOf(batchContract) == Σ over ACTIVE batches (totalAmount − claimedAmount)`.

### Actions

| Action           | Who            | When                                                                  |
| ---------------- | -------------- | --------------------------------------------------------------------- |
| `createBatch`    | anyone (sender)| 1..`MAX_RECIPIENTS_PER_CALL` rows, valid expiry                        |
| `addAllocations` | batch sender   | ACTIVE and not expired (lets large airdrops span several transactions) |
| `claim`          | the allocation's recipient | ACTIVE, not expired, allocation FUNDED                     |
| `refundExpired`  | anyone         | ACTIVE, `expiry ≠ 0`, `now ≥ expiry`, unclaimed > 0                     |
| `cancelBatch`    | batch sender   | ACTIVE, not expired, unclaimed > 0                                      |

`cancelBatch` is a deliberate addition. Without it, the unclaimed part of a **never-expire** batch (e.g. a recipient who
lost their keys) would be locked forever. It mirrors `ArcClaimV2.cancel`: sender-only, only before expiry, and it can
never touch claimed allocations.

### Batch size

Arc Testnet's block gas limit is 30M. Each row costs roughly 25–30k gas (one storage slot + one event), so a single
call is capped at `MAX_RECIPIENTS_PER_CALL = 200`. Larger CSVs go into one `createBatch` followed by
`addAllocations` calls that all share the same `batchId`.

Recipient lists are rebuilt from `AllocationFunded` events (no on-chain arrays needed). Per-recipient status is always
read live with `getAllocation`.
