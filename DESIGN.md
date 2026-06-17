# Design System: RENAISS Football Championship

## 1. Visual Theme & Atmosphere

A dark collectible-finance product interface for live football voting. The bracket should feel precise, operational, and valuable, like a trading terminal for tournament outcomes rather than a sports poster.

- Density: 8/10, cockpit dense but readable.
- Variance: 5/10, mostly symmetric bracket logic with small asymmetric data emphasis.
- Motion: 5/10, restrained CSS motion for active routes, vote deltas, and live states only.
- Primary UI metaphor: a true knockout bracket, not two lists pointing at a trophy.

## 2. Color Palette & Roles

- **Graphite Canvas** (#131313) - Primary app background. Never use pure black.
- **Carbon Surface** (#191A1A) - Team rows, modal surfaces, and fixed docks.
- **Raised Carbon** (#222323) - Hover and selected surfaces.
- **Soft Line** (rgba(255,255,255,0.16)) - Structural borders and idle bracket paths.
- **Faint Grid** (rgba(255,255,255,0.055)) - Low-contrast product grid.
- **Paper Text** (#F5F6F1) - Primary labels and team names.
- **Muted Text** (rgba(245,246,241,0.58)) - Metadata, secondary labels, inactive rounds.
- **Trophy Gold** (#C9A05A) - The single accent for champion states, active route highlights, and primary confirmations.
- **State Gray** (#676C6C) - Locked, removed, cancelled, and inactive match states.

Use country flags as content color, not as UI accent. Avoid purple, pink, cyan, blue, and rainbow gradients in core product chrome.

## 3. Typography Rules

- **Display:** Geist or Satoshi, uppercase only for compact labels and round names.
- **Body:** Geist or Satoshi, normal case for readable explanatory copy.
- **Numbers:** Geist Mono or JetBrains Mono for votes, wallet fragments, percentages, and timestamps.
- **Weights:** 700-850 for team names and key labels, 500-650 for supporting copy.
- **Banned:** Inter, generic serif fonts, pure system font-only stacks for the final product.

## 4. Component Styling

- **Team rows:** 8-12px radius, single border, dark fill, flag, team name, vote share, vote count, and one icon action. No seed numbers and no bottom progress bars in user-facing country rows.
- **Stage progress:** Stage-level additive vote status belongs in the top stage layer rail and country drilldown profile, not below every country row.
- **Bracket lines:** SVG or canvas lines must be straight orthogonal segments only. No curves. All paths must be measured from rendered card edges and visible trophy bounds, not guessed static coordinates.
- **Match state:** Open rows are high contrast. Locked rows are gray and non-clickable. Resolved losers are removable or collapsed. Winners advance into the next round slot.
- **Trophy:** The trophy is an asset on the board, not a card. Do not wrap it in a visible panel or oversized container.
- **Voting modal:** Use only for the active confirmation step. It should not obscure permanent champion state once closed.
- **Country detail:** Clicking a country opens a compact vote profile for the current simulated stage only. Future-stage votes must stay hidden until that stage is selected.
- **Live data:** Use compact tables, bars, and activity rows. Prefer animated number updates over decorative charts.
- **Ticket conversion:** Display Base Tickets separately from stage votes. A Base Ticket is the source entitlement; votes are the stage-specific converted power.

## 5. Layout Principles

- The first screen is the product surface, not a landing page.
- The default desktop view is a 16 to 8 to 4 to 2 to champion bracket.
- The champion endpoint must visually touch the trophy body or trophy base. Do not connect to transparent image padding.
- The stage switcher should read as a compact layer rail: Round of 32, Round of 16, Quarter Finals, Semi Finals, and Final, each with votes per Base Ticket and open/locked state.
- Stage vote pools are additive, but the current simulation view exposes only the selected stage's data window. Future-stage vote totals must not appear as already available.
- Keep the side navigation out of this screen unless it holds real product navigation.
- Avoid cards inside cards. Sections are product bands or tool surfaces, not floating marketing blocks.
- Mobile may collapse the full bracket into stacked match groups if the complete SVG bracket becomes unreadable. This is a responsive layout decision, not a data fallback.

## 6. Motion & Interaction

- Active route draw uses transform/opacity or SVG stroke dash offset only.
- Vote count updates may use CountUp.
- Team row glare is acceptable if restrained and tied to hover or active state.
- Live data rows may use AnimatedList when connected to real event data.
- No constant decorative motion in idle state except subtle grid scan. Do not add a scanning line over the trophy.

## 7. Product State Rules

- Voting open: button enabled, row contrast normal, current vote count live.
- Stage vote open: active stage pool is visible and can be spent independently from other stages.
- Match or stage locked: voting disabled at the relevant cutoff, row gray, lock state explicit.
- Match resolved: winner advances, loser is removed/collapsed from later vote options.
- Vote cancelled: user selection clears immediately and route highlight disappears.
- Data stale: show timestamp and stale state. Do not present old data as live.

## 8. Anti-Patterns

- No pure black.
- No neon glow piles.
- No purple or blue AI gradient interface.
- No curved bracket connectors.
- No visible trophy wrapper panel.
- No fake seed numbering beside countries.
- No static hard-coded bracket endpoints.
- No single global credit label for multi-stage additive votes.
- No placeholder vote data mixed with live data without an explicit label.
- No sidebars without real navigation value.
- No explanatory marketing text inside the product surface.
