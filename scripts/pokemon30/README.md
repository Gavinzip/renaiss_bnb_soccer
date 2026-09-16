# Pokémon 30 ticket ledger

The V3 `CheckoutSuccess` event proves that a configured pack was purchased. It does not expose the card's buyback value, so it cannot itself issue a raffle ticket.

`build-pokemon30-ticket-ledger.mjs` has two required inputs:

- `POKEMON30_PACK_RULES_JSON`: all five event machines, each with an on-chain `packId`, an explicit `lowestTierBbbvMax` in USD, `buybackPayoutBasisPoints`, and the fixed ticket weight. The required price-to-weight mapping is `28→1`, `48→2`, `88→3`, `248→8`, and `100→5`.
- `POKEMON30_CHECKOUT_BUYBACK_LINK_PATH`: a trusted, private checkout-to-buyback mapping. Every row needs `checkoutId`, `buybackId`, `walletAddress`, `packId`, `openedAt` (Unix seconds), and `source`. It contains no monetary amount: the scanner reads the raw USDT `amount` directly from the V3 `BuybackSuccess` event.

The scan reads the shared BSC VRF V3 contract and reconciles each configured checkout against the mapping file. A ticket is issued only when the raw on-chain `BuybackSuccess.amount` is at or below the exact pack payout cap. Missing, duplicate, mismatched, malformed, or out-of-window records block publication: no partial ledger is written and the public API reports the ledger as not ready.

The live pages currently publish these lowest-tier BBBV caps and an Instant buyback rate of 85%:

| Machine | Lowest tier | Highest BBBV | Raw USDT payout cap |
| --- | --- | ---: | ---: |
| PANDORA $28 | Tier C | $35 | $29.75 |
| PANDORA $48 | Tier C | $60 | $51 |
| PANDORA $88 | Common | $90 | $76.50 |
| PANDORA $248 | Common | $250 | $212.50 |
| $100 limited machine | Lowest tier | $120 | $108.00 |

The $100 limited machine uses a 90% instant-buyback rate, unlike the four PANDORA machines at 85%. Its actual on-chain `packId` must be configured before scanning. Do not derive it from public Pull history; that history has no checkoutId or wallet identifier, and entries can appear after the buyback-offer period.

The scanner also rejects a substituted V3 `packId` for the four live PANDORA machines. Their confirmed IDs are:

| Machine | V3 `packId` |
| --- | --- |
| PANDORA $28 | `0xcf11308cc7c642554a781b039a63a542c2f20b36f904b5b6981d48a2f76a5f90` |
| PANDORA $48 | `0x4de1e3c158c8630faa2db4e6c5250933188c4990ba30640a44a41eb6732d257d` |
| PANDORA $88 | `0xfe35d4de033fa6ffd14fb4e6a74ffef5ea2fc3ae6666a78d33c4bfb860e056fe` |
| PANDORA $248 | `0x347ba3e1d2875a0e9e09a378369f6105a6a5f3d2a5c0a51b6837da4beb52dd7d` |

If a result source provides `tier`, it is retained in `reportedTierCounts` for audit only. It is not the ticket predicate.

Run the scanner explicitly; it is intentionally not a startup or periodic server task:

```sh
# First copy config/pokemon30.env.example to config/pokemon30.env.local,
# add the BscScan key, the final $100 packId, and a protected mapping export.
npm run build:pokemon30-ticket-ledger -- --env-file config/pokemon30.env.local --checkout-buyback-links /secure/pokemon30-checkout-buyback-links.json --dry-run
```

After a clean dry run, remove `--dry-run` and set `POKEMON30_TICKET_LEDGER_PATH` to the resulting protected ledger path. The server exposes only the aggregate readiness endpoint and the Renaiss-SSO-scoped holder entry; it does not publish the outcome file or full ticket ledger.

## VRF draw ledger

After the campaign closes and the ticket ledger is fully reconciled, create a separate immutable draw ledger for the existing `RenaissLuckyDraw` single-draw flow. This is deliberately a separate command: it never scans purchases and it never sends a transaction.

Before it will write a draw ledger, all three still-open terms must be confirmed explicitly:

- `POKEMON30_PRIZE_SLOT_COUNT`: the final number of Pokémon 30th Celebration prizes.
- `POKEMON30_ALLOW_REPEAT_WINNERS=true`: the existing contract selects unique ticket numbers, but a wallet with multiple tickets can receive more than one prize. Setting `false` is rejected because the contract cannot enforce a one-wallet-one-prize policy.
- `POKEMON30_DRAW_LEDGER_URI`: an immutable public HTTPS or IPFS URL for the published draw ledger.

```sh
npm run build:pokemon30-draw-ledger -- \
  --env-file config/pokemon30.env.local \
  --ticket-ledger /secure/pokemon30-ticket-ledger.json \
  --prize-slots 10 \
  --allow-repeat-winners true \
  --ledger-uri https://example.com/pokemon30/draw-ledger.json \
  --dry-run
```

After reviewing that output, rerun without `--dry-run` to write the local immutable ledger. The generic contract runner can then inspect its on-chain state without a transaction:

```sh
node scripts/run-lucky-draw-round.mjs \
  --env-file config/draw-contract.env.local \
  --ledger /secure/pokemon30-draw-ledger.json \
  --verify-only
```

Only a deliberate later `--broadcast` invocation can finalize the ledger, request VRF randomness, or reveal winners. Do not use that flag until the terms, public ledger content/hash, contract address, and draw-admin wallet have all been reviewed.
