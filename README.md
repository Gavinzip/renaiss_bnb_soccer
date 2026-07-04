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

Local API testing uses an explicit runtime target. If no runtime target is set,
the server keeps the production/server defaults and reads `/data/soccer`.

```sh
cp .env.local.example .env.local
# Fill RENAISS_CLIENT_SECRET for Sign in with Renaiss. Fill Google/Discord/X values only if you want those providers locally.
npm run local:seed
npm run build
npm run local:server
```

Open `http://127.0.0.1:3000` to test the built app with the local API. For Vite
dev, keep `npm run local:server` running in another terminal and run:

```sh
npm run local:dev
```

To run the local Vite frontend against the production read APIs without using
production write/login endpoints, run:

```sh
npm run local:dev:prod-api
```

This mode uses `LOCAL_READ_API_ORIGIN=https://renaiss-worldcup.zeabur.app` from
`.env.prod-api` and proxies only read endpoints such as `/api/raffle-summary`,
`/api/milestones`, `/api/vote-preview`, `/api/match-results`, live FIFA match
feeds, and `/api/draw-winners`. It intentionally leaves auth, vote submit, and
draw-admin endpoints unconfigured, so local UI work can inspect real backend data
without logging into or mutating the production service.

The Renaiss SSO redirect URI can be left blank in local env. The auth server derives
`/auth/callback` from the current app origin when starting the OAuth flow.

`npm run local:seed` writes local-only demo data to `.local-data/soccer`:

- 8 Round of 16 match result fixtures marked `sourceLabel: local-round16-demo-result-fixture`.
- 24 fake SQLite vote allocations, 3 per match, covering 1 primary winner ticket plus 2 alternates.
- 8 per-match draw rows, each with its own 1..N namespace and `prizeSlotCount: 1`.
- 8 contract-compatible demo winners and 16 alternates generated with the same ticket-pick formula used by the Solidity contract.

Because the real 2026 Round of 16 results do not exist yet, the local seed also
creates local-only confirmed result fixtures. Production still requires the
backend FIFA result sync to produce `resultStatus: confirmed`; local fixtures are
not a production fallback.

To test locally against the current production ticket/vote data instead of the
local demo seed, sync the production read APIs into the local SQLite store:

```sh
npm run local:sync:production
npm run build
npm run local:server:production
```

Use the realtime variant when you want the local server to fetch the current
FIFA Round of 32 results into local `match-results.json` at startup:

```sh
npm run local:sync:production
npm run build
npm run local:server:realtime
```

`local:sync:production` uses `SOCCER_PRODUCTION_API_ORIGIN` from `.env.local`
and pulls:

- `/lucky-draw-ledger.json` for the real ticket ledger.
- `/api/vote-preview` for real vote allocations and submitted ticket totals.
- `/api/match-results` for backend result status.
- `/match-draw-ledger.json` and `/api/draw-winners` when available.

It writes `.local-data/soccer-production/production-data-summary.json` with
`ledger.totalFinalTickets`, `ledger.totalEntries`, `votes.voterCount`,
`votes.allocationCount`, and `votes.submittedTickets`. The production server
`/health` response also includes this vote summary under `votes`.

To test the reveal animation and testnet contract read-back with a larger
winner batch before production results exist:

```sh
npm run local:sync:production
npm run local:seed:test-batch
npm run build
npm run local:server:test-batch
```

`local:seed:test-batch` reads the synced production ticket ledger, uses those
real participating wallet addresses and capacities, then creates local-only fake
Round of 16 vote allocations. By default it generates 1,000 single-ticket vote
allocations across the eight Round of 16 matches and builds a test draw ledger
with 16 prize slots per match. Only the vote allocations are fake; the source
wallets and ticket capacity come from the production ledger.

Production builds read the server APIs by default:

- `/api/raffle-summary`
- `/api/raffle-entry?wallet=0x...`
- `/api/raffle-ticket-lookup?ticket=1`
- `/api/raffle-ticket-lookup?start=1&end=100`
- `/api/milestones`
- `/api/vote-preview`
- `POST /api/votes`
- `/api/draw-winners`
- `/api/auth/me`
- `/api/auth/renaiss/start`
- `/api/auth/x/start?connect=1`
- `/api/auth/x-account-eligibility/verify`

Local dev still uses the mock vote preview unless `VITE_VOTE_PREVIEW_URL` is set.
The winner reveal page reads `VITE_DRAW_WINNERS_URL` when configured. Plain
`npm run dev` reads `public/mock-api/draw-winners.json` so the reveal animation
can show local-only grouped winners; set `VITE_DRAW_WINNERS_URL=/api/draw-winners`
with `npm run local:server` when testing the local API snapshot instead. Keep
`VITE_VOTE_SUBMIT_URL` empty for read-only local modes, including
`npm run local:dev:prod-api`, so vote confirmation stays local preview only.

## Production Data Service

Run the production server after building:

```sh
npm run build
npm start
```

Zeabur should build this repository with the checked-in `Dockerfile`, then run `npm start`.
The server exposes public `/healthz` for liveness. Private diagnostics live at `/health`
and require `Authorization: Bearer $HEALTH_ADMIN_TOKEN`; use that to confirm `ledgerExists`, `bscscanApiKeyConfigured`,
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
    vote-store.sqlite           production vote source of truth when SOCCER_VOTE_STORE=sqlite
    vote-events.jsonl           append-only user vote submissions
    vote-state.json             JSON compatibility snapshot, not the SQLite fallback
    vote-preview.json           frontend-compatible vote preview snapshot
  profiles/
    user-profiles.sqlite        wallet-keyed login profile records for winner display
  match-results.json            backend FIFA official result snapshot
  match-draw-ledger.json        per-match draw ledger generated from confirmed results
  draw-winners.json             on-chain reveal winner snapshot
  auth/
    sessions.json               signed session records
    auth-state.json             OAuth state, wallet nonces, and hashed OTP challenges
```

The Git backup target is `https://github.com/Gavinzip/renaiss_bnb_soccer_data.git`. The server restores missing
files from that repo on startup, then pushes `/data/soccer` back on the backup interval. Add these environment
variables in Zeabur:

```sh
SOCCER_RUNTIME_TARGET=server
SOCCER_DATA_DIR=/data/soccer
LUCKY_DRAW_DATA_DIR=/data/soccer
LUCKY_DRAW_CACHE_DIR=/data/soccer/cache
LUCKY_DRAW_LEDGER_PATH=/data/soccer/lucky-draw-ledger.json
SOCCER_VOTES_DIR=/data/soccer/votes
SOCCER_VOTE_STORE=sqlite
SOCCER_VOTE_DB_PATH=/data/soccer/votes/vote-store.sqlite
SOCCER_PROFILE_DB_PATH=/data/soccer/profiles/user-profiles.sqlite
SOCCER_VOTE_STATE_PATH=/data/soccer/votes/vote-state.json
SOCCER_VOTE_PREVIEW_PATH=/data/soccer/votes/vote-preview.json
SOCCER_MATCH_RESULTS_PATH=/data/soccer/match-results.json
SOCCER_MATCH_DRAW_LEDGER_PATH=/data/soccer/match-draw-ledger.json
SOCCER_DRAW_WINNERS_PATH=/data/soccer/draw-winners.json
SOCCER_DRAW_ALTERNATE_COUNT=2
WINNER_REVEAL_VIDEO_URL=https://pub-7230fa99c50e44e9b241e47cac526165.r2.dev/draw/winner-reveal-2026-06-17-hq.mp4
VITE_GA_MEASUREMENT_ID=G-...

DATA_BACKUP_REPO_URL=https://github.com/Gavinzip/renaiss_bnb_soccer_data.git
DATA_BACKUP_GITHUB_TOKEN=<PAT token>
DATA_BACKUP_INTERVAL_MINUTES=60
DATA_BACKUP_BRANCH=main
DATA_BACKUP_RESTORE_ON_STARTUP=1
DATA_BACKUP_RESTORE_FORCE=0

AUTH_SESSION_SECRET=<at least 32 random characters>
LOGIN_AUDIT_HASH_SECRET=<at least 32 random characters>
AUTH_REQUIRE_SESSION_FOR_VOTES=1
AUTH_COOKIE_SECURE=1
HEALTH_ADMIN_TOKEN=<private health diagnostics token>
HTTP_RATE_LIMIT_ENABLED=1
AUTH_LEGACY_LOGIN_ENABLED=0
AUTH_SUCCESS_REDIRECT_PATH=/?auth=success
AUTH_ERROR_REDIRECT_PATH=/?auth=error
PUBLIC_APP_ORIGIN=https://renaiss-worldcup.zeabur.app
RENAISS_ISSUER=https://www.renaiss.xyz/api/auth
RENAISS_CLIENT_ID=rpk_u2PA7GjyPDT1c-h81KhRhI2j
RENAISS_CLIENT_SECRET=...
RENAISS_REDIRECT_URI=
RENAISS_SCOPE=openid profile email safe x
X_CLIENT_ID=...
X_CLIENT_SECRET=...
X_REDIRECT_URI=https://renaiss-worldcup.zeabur.app/api/auth/x/callback
X_OAUTH_SCOPE=users.read follows.read offline.access
X_FOLLOW_GATE_HANDLE=thefireflyapp
X_FOLLOW_GATE_REQUIRED=1
X_FOLLOW_SKIP_ENABLED=0
FIREFLY_X_ACCOUNT_ELIGIBILITY_REQUIRED=1
FIREFLY_RENAISS_API_KEY=...
FIREFLY_X_ACCOUNT_ELIGIBILITY_TTL_SECONDS=86400
FIREFLY_X_ACCOUNT_ELIGIBILITY_TIMEOUT_MS=8000

LUCKY_DRAW_REFRESH_MINUTES=5
LUCKY_DRAW_REFRESH_HISTORY_LIMIT=24
LUCKY_DRAW_EVENT_CACHE_LOOKBACK_ROUNDS=12
# Optional explicit override. Empty means refresh minutes * lookback rounds.
LUCKY_DRAW_EVENT_CACHE_LOOKBACK_MINUTES=
LUCKY_DRAW_CAMPAIGN_START=1781422200
LUCKY_DRAW_CAMPAIGN_END=1784469600
BSCSCAN_API_KEY=...
```

`DATA_BACKUP_GITHUB_TOKEN` is the PAT token variable name. Startup restore only copies missing files by default;
set `DATA_BACKUP_RESTORE_FORCE=1` only when you intentionally want the data repo to overwrite `/data/soccer`.
`BSCSCAN_API_KEY` is required for live ticket refresh. `LUCKY_DRAW_EVENT_CACHE_LOOKBACK_ROUNDS=12` with a
5-minute refresh makes every ledger refresh re-scan the latest 60 minutes of on-chain event cache before writing
the ticket ledger. Do not commit either token.

When testing a fresh buyback ledger on the server, isolate only the ticket ledger/cache paths. Do not remove
`votes/`, `profiles/`, `auth/`, `match-results.json`, or `match-draw-ledger.json`; those are separate runtime
sources and are not required for rebuilding raw buyback tickets.

Set `SOCCER_VOTE_STORE=sqlite` for production voting. The server then uses
`vote-store.sqlite` transactions for vote submission, balance checks, and
preview reads. `vote-state.json` and `vote-preview.json` remain compatibility
snapshots for exports and older readers; they are not used as a fallback when
SQLite is configured.

Production vote submission uses the signed auth session wallet when `AUTH_REQUIRE_SESSION_FOR_VOTES=1`; the server
does not trust a client-supplied `walletAddress` for `POST /api/votes`. Renaiss SSO verifies the OIDC `id_token`
and resolves `safe_wallet_address` directly into the voting wallet when that claim is present. Google, Discord,
email, and wallet login routes are disabled by default; set `AUTH_LEGACY_LOGIN_ENABLED=1` only for an intentional
legacy test. X OAuth remains connect-only for follow verification after a Renaiss wallet session already exists.
If Renaiss returns `safe_wallet_address: null`, the user can be logged in but cannot submit votes.

Vote access is gated before the Vote room is rendered and again before `POST /api/votes` writes any allocation.
The required production path is: Renaiss wallet session, wallet-bound Renaiss X identity, verified follow of
`X_FOLLOW_GATE_HANDLE`, then Firefly/Predict eligibility through the server-side
`FIREFLY_RENAISS_API_KEY`. The Firefly request uses the verified numeric X user id from the session chain; the
client never supplies `x_account_id`. If the Firefly API is unconfigured or unavailable, production voting is blocked
instead of falling back to a permissive state.

Successful Renaiss and X-connect flows enqueue a SQLite profile write and a `user_login_audits`
row in `SOCCER_PROFILE_DB_PATH`. The audit table stores the wallet, provider,
Twitter username when supplied by the identity payload, hashed IP/User-Agent,
public IP prefix, and deployment-provided geo headers such as Vercel or
Cloudflare country/region/city. It does not store the full raw IP. If the
deployment platform does not provide geo headers, `geo_source` is `none` and the
server will not guess a location.

Google Analytics is build-time gated by `VITE_GA_MEASUREMENT_ID`. The frontend
only loads GA when this value is a valid `G-...` Measurement ID, strips identity
query params such as `wallet` from page views, and sends only anonymous events
such as app view changes and login provider status. Treat GA as installed only
after the live page contains the ID, `gtag.js` returns 200, collection requests
return 204, and GA realtime/API shows traffic for the correct property.

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
cp config/fifa-results.env.example config/fifa-results.env.local
```

Generate the base buyback ticket ledger:

```sh
npm run fetch:ledger:local
```

Sync backend-confirmed official FIFA match results. The source map must explicitly
map each local `matchId` to a FIFA `IdMatch` or `MatchNumber`; the sync does not
infer production results from frontend fixture ids or demo winners.

```sh
cp config/fifa-match-map.example.json /data/soccer/fifa-match-map.json
npm run sync:fifa-results:local
```

Build the round/match draw ledger after mapped matches have `resultStatus:
confirmed`. Pending, missing, source-error, stale, or team-mismatch results do
not enter the draw pool. Each match keeps an independent `1..N` ticket
namespace, and each prize slot includes one primary winner plus the configured
alternate count.

```sh
npm run build:match-draw-ledger:local -- --prize-slots 1 --alternates 2
```

Compile and deploy the draw contract:

```sh
npm run contract:compile
npm run contract:deploy:check
npm run contract:deploy:bsc
```

Run a round draw verification. This is no-broadcast by default and uses one VRF
random word for the round:

```sh
npm run contract:round -- --round-id round16
```

`contract:round` validates the round ledger row, reads chain state, prints
planned `finalizeRoundLedger`, `requestRoundDraw`, and per-match reveal steps,
and, if the round is already fulfilled, maps primary and alternate ticket
numbers back to ledger wallet/allocation rows. To actually send transactions,
run the broadcast script only after the target contract, owner/admin wallet,
round id/key, round ledger hash, match hashes, ticket counts, prize counts, and
alternate count are confirmed:

```sh
npm run contract:round:broadcast -- --round-id round16 --match-batch-size 1
```

When the draw is fulfilled, write the frontend winner snapshot:

```sh
npm run contract:round -- --round-id round16 --winners-out /data/soccer/draw-winners.json
```

The same `--winners-out` flag can be added to the broadcast command. The
production server exposes that file through `/api/draw-winners` and
`/draw-winners.json`; if the file does not exist yet, the API returns `pending`
with an empty `winners` list instead of placeholder winners.

The round-level contract accepts `prizeSlotCount` and `alternateCount` per
match through `finalizeRoundLedger`, so prize count is not fixed. In the current
production path, `round16` uses 8 match ledgers, each with 1 primary winner
and 2 alternates for that prize slot. The old per-match runner is still available as
`contract:match-round` for legacy draw inspection only.

The draw runner expects the ledger to contain a per-match draw row. A minimal shape is:

```json
{
  "draws": [
    {
      "matchId": "m73",
      "ledgerHash": "0x...",
      "totalTickets": 12842,
      "prizeSlotCount": 1,
      "alternateCount": 2,
      "ledgerUri": "public/lucky-draw-ledger.json#m73"
    }
  ]
}
```

Do not broadcast deployment or draw transactions until the target contract, owner/admin wallets, match id, ledger hash, ticket count, and prize count are confirmed.

The production server also exposes `/api/match-results` and `/match-draw-ledger.json`;
`/api/vote-preview` settles vote outcomes only from the backend match-results
snapshot. The bundled campaign fixture `official_final` fields are preview/demo
state and are not used for production draw eligibility.

For SQLite-backed votes, build the per-match ledger directly from the database:

```sh
npm run build:match-draw-ledger -- --vote-store sqlite --vote-db /data/soccer/votes/vote-store.sqlite
```

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
