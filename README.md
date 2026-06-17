# Renaiss BNB Football

## Championship Voting Frontend

This workspace now includes a React/Vite frontend prototype for the Round of 16 championship voting experience.

```sh
npm install
npm run dev
```

Other frontend commands:

```sh
npm run build
npm run preview
```

The voting screen is frontend-only for now. Vote credits, selected teams, confirmation, and success states are local UI state until the real voting source is defined.

## Lucky Draw Tickets And Contract

This project includes the same base lucky-draw ticket accounting flow used by the Renaiss draw, but the football draw model is per match:

- OMEGA and EDEN are counted from direct buyback event logs.
- Costume Pack, MAGMA, Starry Pack, and Plasma Pack open logs are matched to `BuybackSuccessV3` logs by `checkoutId`.
- The scanner does not call the Renaiss activity API for ticket counting.
- Each match has an independent draw id, ticket namespace, ledger hash, prize count, and winner list.
- Only correct advancing-team votes enter that match's draw pool.
- The contract owner is the highest authority. Owner-invited draw admins can finalize/request/reveal draws, but cannot grant themselves owner powers.

Create local env files from the examples:

```sh
cp config/lucky-draw.env.example config/lucky-draw.env.local
cp config/draw-contract.env.example config/draw-contract.env.local
```

Generate the ledger:

```sh
npm run fetch:ledger:local
```

Compile and deploy the draw contract:

```sh
npm run contract:compile
npm run contract:deploy:check
npm run contract:deploy:bsc
```

Run a match draw with a custom prize count:

```sh
npm run contract:round -- --match-id m73 --prize-slots 32
```

The contract accepts `prizeSlotCount` per `drawId` through `finalizeLedger`, so prize count is not fixed to 20 or 21. Valid range is 1 to 256. `--match-id m73` is converted to a `bytes32` draw id with `keccak256("m73")`; you can also pass a raw `--draw-id 0x...` value.

The draw runner expects the ledger to contain a per-match draw row. A minimal shape is:

```json
{
  "draws": [
    {
      "matchId": "m73",
      "ledgerHash": "0x...",
      "totalTickets": 12842,
      "prizeSlotCount": 20,
      "ledgerUri": "public/lucky-draw-ledger.json#m73"
    }
  ]
}
```

Do not broadcast deployment or draw transactions until the target contract, owner/admin wallets, match id, ledger hash, ticket count, and prize count are confirmed.

## X Follower Verification

X follower verification sync for `@renaissxyz`.

This implementation uses the official X API only. There is no scraping fallback.

## Setup

1. Create an X Developer app.
2. Add a Bearer token to `.env` or export it in your shell:

```sh
export X_BEARER_TOKEN="..."
```

## Commands

Resolve and store the target account:

```sh
node src/cli.js resolve-account --handle renaissxyz
```

Build the first local follower cache:

```sh
node src/cli.js sync --mode full --handle renaissxyz
```

Scan the newest follower pages:

```sh
node src/cli.js sync --mode delta --handle renaissxyz --max-pages 2
```

Run delta sync every minute:

```sh
node src/cli.js watch --handle renaissxyz --interval-ms 60000 --max-pages 2
```

Check whether a known X user id is in the local cache:

```sh
node src/cli.js verify --handle renaissxyz --follower-id 1234567890
```

## Data Model

Generated files are under `data/x-followers` and are ignored by git:

- `accounts.json`: resolved X account ids by handle.
- `followers-{target_x_user_id}.json`: follower cache keyed by follower user id.
- `sync-runs-{target_x_user_id}.jsonl`: append-only sync run logs.

`first_seen_at` is the first time this sync job saw a follower. X does not return `followed_at`, so this is not an official follow timestamp.

## Sync Strategy

- `full` scans every follower page and marks missing previously known followers as `is_current=false`.
- `delta` scans the newest pages only. It is for discovering new followers quickly.
- `watch` runs `delta` repeatedly, defaulting to one minute when used through `npm run x:watch`.

Run a full sync before important reward decisions because delta sync does not reliably detect unfollows.
