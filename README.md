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

Production builds read the server APIs by default:

- `/api/raffle-summary`
- `/api/raffle-entry?wallet=0x...`
- `/api/raffle-ticket-lookup?ticket=1`
- `/api/raffle-ticket-lookup?start=1&end=100`
- `/api/milestones`
- `/api/vote-preview`
- `POST /api/votes`
- `/api/auth/me`
- `/api/auth/google/start`
- `/api/auth/x/start`
- `/api/auth/wallet/nonce`
- `/api/auth/email/start`

Local dev still uses the mock vote preview unless `VITE_VOTE_PREVIEW_URL` and `VITE_VOTE_SUBMIT_URL` are set.

## Production Data Service

Run the production server after building:

```sh
npm run build
npm start
```

Zeabur should build this repository with the checked-in `Dockerfile`, then run `npm start`.
The server exposes `/health`; use it to confirm `ledgerExists`, `bscscanApiKeyConfigured`,
`refreshMinutes`, `ledger.totalFinalTickets`, `ledger.ageSeconds`, `lastRefresh.durationSeconds`,
`refreshHistory`, `lastRestore`, and `restoreHistory`. A live API route returns JSON; if these routes return `index.html`, the
service is still running the static frontend image.

On Zeabur, mount the persistent disk at `/data` and use `/data/soccer` for this project. The server keeps all ticket and vote data there:

```text
/data/soccer/
  lucky-draw-ledger.json        confirmed ticket ledger
  cache/                        BscScan and wallet-resolution scan cache
  snapshots/                    generated ledger snapshots
  votes/
    vote-events.jsonl           append-only user vote submissions
    vote-state.json             current vote allocation state
    vote-preview.json           frontend-compatible vote preview payload
  auth/
    sessions.json               signed session records
    auth-state.json             OAuth state, wallet nonces, and hashed OTP challenges
```

The Git backup target is `https://github.com/Gavinzip/renaiss_bnb_soccer_data.git`. The server restores missing
files from that repo on startup, then pushes `/data/soccer` back on the backup interval. Add these environment
variables in Zeabur:

```sh
SOCCER_DATA_DIR=/data/soccer
LUCKY_DRAW_DATA_DIR=/data/soccer
LUCKY_DRAW_CACHE_DIR=/data/soccer/cache
LUCKY_DRAW_LEDGER_PATH=/data/soccer/lucky-draw-ledger.json
SOCCER_VOTES_DIR=/data/soccer/votes

DATA_BACKUP_REPO_URL=https://github.com/Gavinzip/renaiss_bnb_soccer_data.git
DATA_BACKUP_GITHUB_TOKEN=<PAT token>
DATA_BACKUP_INTERVAL_MINUTES=60
DATA_BACKUP_BRANCH=main
DATA_BACKUP_RESTORE_ON_STARTUP=1
DATA_BACKUP_RESTORE_FORCE=0

AUTH_SESSION_SECRET=<at least 32 random characters>
AUTH_REQUIRE_SESSION_FOR_VOTES=1
AUTH_COOKIE_SECURE=1
AUTH_SUCCESS_REDIRECT_PATH=/?auth=success
AUTH_ERROR_REDIRECT_PATH=/?auth=error
PUBLIC_APP_ORIGIN=https://renaiss-worldcup.zeabur.app
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=https://renaiss-worldcup.zeabur.app/api/auth/google/callback
X_CLIENT_ID=...
X_CLIENT_SECRET=...
X_REDIRECT_URI=https://renaiss-worldcup.zeabur.app/api/auth/x/callback
X_OAUTH_SCOPE=users.read
SIWE_DOMAIN=renaiss-worldcup.zeabur.app
SIWE_CHAIN_ID=56
IDENTITY_RESOLVER_API_URL=...
IDENTITY_RESOLVER_API_KEY=...
RESEND_API_KEY=...
EMAIL_FROM=Renaiss <login@renaiss.xyz>

LUCKY_DRAW_REFRESH_MINUTES=10
LUCKY_DRAW_REFRESH_HISTORY_LIMIT=24
LUCKY_DRAW_CAMPAIGN_START=1781422200
LUCKY_DRAW_CAMPAIGN_END=1784469600
BSCSCAN_API_KEY=...
```

`DATA_BACKUP_GITHUB_TOKEN` is the PAT token variable name. Startup restore only copies missing files by default;
set `DATA_BACKUP_RESTORE_FORCE=1` only when you intentionally want the data repo to overwrite `/data/soccer`.
`BSCSCAN_API_KEY` is required for live ticket refresh. Do not commit either token.

Production vote submission uses the signed auth session wallet when `AUTH_REQUIRE_SESSION_FOR_VOTES=1`; the server
does not trust a client-supplied `walletAddress` for `POST /api/votes`. Google, X, and email logins create identity
sessions first, then call `IDENTITY_RESOLVER_API_URL` to map that identity to a voting wallet. Wallet login verifies
a signed message and can resolve directly to the signing address. If the resolver is not configured or returns no
wallet, the user can be logged in but cannot submit votes.

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
