# RENAISS Football Voting Bracket Architecture

This document turns the current visual prototype into a product plan for a real elimination voting surface.

## 1. Tournament Model

The product should model a tournament, not a flat list of countries.

Core entities:

- `Tournament`: global contest container, active round, starts/ends timestamps, rules version.
- `Round`: `round_of_16`, `quarter_final`, `semi_final`, `final`, `champion`.
- `Match`: two competitors, scheduled start time, voting cutoff, status, vote totals, result.
- `Competitor`: team or country metadata, display name, flag, eligibility state.
- `BaseTicket`: the user's underlying entitlement. It expands into one independent vote pool per stage.
- `StageVotePool`: additive stage-specific voting power derived from Base Tickets.
- `Vote`: user, wallet, match, selected competitor, transaction/hash if on-chain, created time.
- `Result`: official winner, loser, source, resolved time, resolver signature or admin action.

Match status lifecycle:

| Status | Meaning | UI Behavior |
| --- | --- | --- |
| `open` | Voting is allowed before match cutoff. | Team options active, vote count live, plus/check action visible. |
| `locked` | Match has started or cutoff passed. | Options disabled and gray, no new votes accepted. |
| `resolving` | Result source is pending confirmation. | Keep options disabled, show pending result state. |
| `resolved` | Winner is official. | Winner advances to next round, loser removed from future options. |
| `removed` | Competitor is no longer eligible. | Hide or collapse from later views; keep historical match record available. |
| `cancelled` | Match invalidated or vote selection cleared. | Clear active route and restore previous valid state. |

The frontend should not infer official advancement from local vote totals. Vote popularity and official match results are separate surfaces.

## 2. Voting Mechanism

Base Ticket conversion:

| Stage | User action | 1 Base Ticket becomes |
| --- | --- | --- |
| Before 32 | Vote champion team | 40 votes |
| Before 16 | Vote champion team | 18 votes |
| Before 8 | Vote champion team | 9 votes |
| Before 4 | Vote champion team | 4 votes |
| Before final | Vote champion team | 2 votes |

These pools are additive. A user with `87` Base Tickets has:

- Before 32: `87 * 40 = 3,480 votes`
- Before 16: `87 * 18 = 1,566 votes`
- Before 8: `87 * 9 = 783 votes`
- Before 4: `87 * 4 = 348 votes`
- Before final: `87 * 2 = 174 votes`
- Additive total: `6,351 votes`

Voting rules:

- A vote belongs to a specific `stageId` and `matchId` or champion market, not only a `teamId`.
- Each stage has its own independent vote pool. Spending a stage pool does not consume votes from another stage.
- All stages can be available for voting if the product rules allow it, but each stage can still lock independently.
- Voting for a stage closes at that stage's `votingClosesAt`.
- The backend/API must reject votes for `locked`, `resolving`, `resolved`, `removed`, and unknown matches.
- The UI can optimistically show a selected route during confirmation, but confirmed vote state must come from the vote response or wallet transaction result.
- A user cancellation before confirmation only clears local selection. It must not create a vote event.
- If an already voted competitor is later removed by official result, the vote remains in historical data but no longer appears as a selectable option.
- Aggregate popularity must be calculated as the sum of confirmed stage votes, while stage-level screens must preserve the individual stage breakdown.

Required API shape:

```ts
type MatchStatus = "open" | "locked" | "resolving" | "resolved" | "removed" | "cancelled";

type Match = {
  id: string;
  round: "round_of_32" | "round_of_16" | "quarter_final" | "semi_final" | "final";
  slot: number;
  leftCompetitorId: string | null;
  rightCompetitorId: string | null;
  status: MatchStatus;
  votingClosesAt: string;
  startsAt: string;
  resolvedAt: string | null;
  winnerCompetitorId: string | null;
  loserCompetitorId: string | null;
  totals: {
    leftVotes: number;
    rightVotes: number;
    uniqueVoters: number;
    stageVotes: Record<string, number>;
    updatedAt: string;
  };
};

type StageVotePool = {
  stageId: "round32" | "round16" | "quarterFinal" | "semiFinal" | "final";
  baseTicketCount: number;
  votesPerBaseTicket: number;
  totalVotes: number;
  remainingVotes: number;
  selectedCompetitorId: string | null;
  status: "open" | "locked" | "resolved";
};
```

Country detail data:

- A country profile needs stage-level totals for the current simulated stage only, plus unique voter count against the visible population size. Future-stage totals stay hidden until that stage becomes current.
- A country profile needs voter rows with wallet fragment, Base Ticket count, stage participation, and total additive votes.
- Locked or resolved competitors should remain inspectable for historical transparency, while their vote submission action remains disabled.
- Local mock voter rows are acceptable only as prototype fixtures. They must be labelled as simulated and must not be mixed with backend truth.

Frontend actions:

- `selectCompetitor(stageId, matchId, competitorId)` updates only local selection.
- `cancelSelection()` clears local selection and active route.
- `submitStageVote(stageId, matchId, competitorId)` spends that stage's available vote pool and waits for confirmed state.
- `lockMatch(matchId)` should arrive from backend/realtime events, not from UI-only timers.
- `resolveMatch(matchId, winnerCompetitorId)` advances bracket slots from official result data.

## 3. Bracket UI Direction

The primary screen should become a true knockout bracket.

Desktop:

- Round of 32 or Round of 16 starts at the outside columns, depending on the active tournament stage.
- Winners advance inward to quarter finals, then semi finals, then final.
- Champion endpoint attaches to the trophy body or base using visible asset bounds.
- Every connector is orthogonal: horizontal to vertical join, vertical join, horizontal advance.
- Each match has its own state, so one match can lock while another remains open.
- The stage switcher must show the active vote pool for that stage. Previous stages are closed and future stages are not started.

Mobile:

- Use stacked match groups by round, with a compact top switcher for rounds.
- Keep the trophy and champion state visible above or between rounds.
- Do not force the full desktop SVG bracket if it creates horizontal scrolling.

State treatment:

- `open`: normal contrast, active vote action.
- `locked`: gray row, lock icon, no active route.
- `resolved`: winner highlighted, loser collapsed or moved into match history.
- `removed`: absent from active voting; historical row can be shown in data view.

In-bracket data expression:

- The stage layer switcher shows the tournament timeline. The current stage shows its vote pool, past stages show closed, and future stages show not started.
- Team rows stay compact: flag, team name, vote share, vote count, and action icon only.
- Stage distribution appears in the top stage rail and the country drilldown profile, not as row-level bottom bars.

## 4. Realtime Data Screen

Add a second product view dedicated to prediction data. It should not be a decorative sidebar.

Primary data blocks:

- Total votes across the tournament.
- Additive total votes by stage.
- Unique voters.
- Current most popular teams by vote share.
- Match-level popularity: left competitor, right competitor, vote counts, percentages, status.
- Recent vote activity or settlement events if the backend supports it.
- Data freshness: `updatedAt`, realtime connected state, stale state.
- Country drilldown: stage distribution and voter list for the selected team.

Recommended UI:

- Compact ranking table for overall popularity.
- Stage conversion strip: 40, 18, 9, 4, 2 votes per Base Ticket.
- Compact matchup percentages in team rows so users can scan popularity without adding row-level progress bars.
- Country drilldown bars so users can see which stages contributed to a team's support.
- Per-match horizontal comparison bars.
- Event list for recent votes/results, using AnimatedList only after the event stream exists.
- Round filter tabs: Round of 32, Round of 16, Quarter Finals, Semi Finals, Final.

Realtime transport:

- Prefer server-sent events or websocket channel keyed by `tournamentId`.
- Events should include `match.updated`, `vote.created`, `match.locked`, and `match.resolved`.
- Client should reconcile events into normalized match state instead of mutating only visible rows.

## 5. Development Preparation

Implementation order:

1. Replace flat team selection with `Match` based state.
2. Add `StageVotePool` state from Base Ticket conversion and keep it separate from match result state.
3. Render Round of 16 or Round of 32 from match slots, not manually split left/right team arrays.
4. Make route geometry derive from rendered match nodes and trophy visible bounds.
5. Add lock/resolved/removed UI states before connecting realtime.
6. Add the realtime data view once an API or event fixture exists.

Acceptance checks:

- A match that reaches cutoff disables voting without hiding historical totals.
- A stage can be voted independently from the other stages.
- The additive total equals the sum of all stage vote pools.
- A resolved winner advances into the next round slot.
- A loser is removed from future selectable options.
- Vote totals and official winners are visually separate.
- Active route connects to the visible trophy contour, not transparent image padding.
- Mobile has no horizontal overflow.

Known current prototype boundary:

- The current app still uses local frontend state for votes and winner simulation.
- The country vote profiles use deterministic local mock voters, not backend or chain truth.
- There is no backend truth source or realtime channel in this workspace yet.
- No fallback result logic should be added to fake official match resolution.
