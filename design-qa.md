# Renaiss World Cup Frontend QA

## Scope

- Reworked home into a full-bleed hero image experience.
- Replaced schedule with a trophy-centered tournament bracket arena.
- Rebuilt vote as grouped per-match voting cards instead of using the full bracket as the voting surface.
- Added a read-only round status rail plus a simulation stage selector.
- Added team detail panels with vote-ratio preview states.
- Wired schedule team details into the matching vote stage and team selection.
- Rebuilt the homepage milestone module as a reward-unlock instrument with threshold, amount, reward, slots, current value, remaining distance, and a metallic neon progress meter.
- Reworked the draw page into an open per-round progress map instead of the previous dense dashboard stack.
- Removed the `room-shell` max-height/hidden overflow behavior that made long pages feel stuck.

## References

- `/Users/gavin/Desktop/CleanShot 2026-06-15 at 00.19.22@2x.png`
- `/Users/gavin/Desktop/CleanShot 2026-06-15 at 00.19.27@2x.png`
- User direction: avoid AI-looking gradient trims, click-spark effects, and dense boxed dashboard layouts.
- User direction: milestone should clearly show which stage unlocks the corresponding reward amount and prize.

## Verification

- `npm run build`: passed.
- `npm run i18n:check`: passed: `zh-Hant, en · 595 keys · 299 static usages`.
- Desktop home: no horizontal overflow; milestone height 479.94px and bottom 887.95px in a 900px viewport.
- Mobile home: no horizontal overflow; milestone reward labels visible for all five thresholds.
- Desktop schedule: no horizontal overflow; trophy-centered arena remains visible with championship routes.
- Mobile schedule: no document horizontal overflow; arena uses an internal horizontal stage for bracket inspection.
- Desktop draw: no horizontal overflow; page scrollHeight 1651px with visible draw progress map and per-round rail.
- Mobile vote: no horizontal overflow; 8 grouped match sections are present.
- Interaction check: choosing a team enables the preview CTA; schedule detail "前往投票" opens the vote view with the selected match/team.

## Captures

- `/tmp/renaiss-final-home-desktop-r164.png`
- `/tmp/renaiss-final-home-mobile-r164.png`
- `/tmp/renaiss-final-schedule-desktop-r165.png`
- `/tmp/renaiss-final-schedule-panel-desktop-r165.png`
- `/tmp/renaiss-final-schedule-mobile-r165.png`
- `/tmp/renaiss-final-schedule-panel-mobile-r165.png`
- `/tmp/renaiss-final-vote-mobile-r165.png`
- `/tmp/renaiss-r167-vote-desktop.png`
- `/tmp/renaiss-r167-vote-mobile.png`
- `/tmp/renaiss-r168-vote-picked-desktop.png`
- `/tmp/renaiss-r168-schedule-to-vote-desktop.png`
- `/tmp/renaiss-r172-home-desktop.png`
- `/tmp/renaiss-r172-home-mobile.png`
- `/tmp/renaiss-r172-schedule-desktop.png`
- `/tmp/renaiss-r172-vote-mobile.png`
- `/tmp/renaiss-r172-draw-desktop.png`

## Final Result

passed

## Known Boundary

Wallet connection, real vote submission, on-chain vote-location recording, and draw contract execution remain intentionally unimplemented. The new bracket data and per-team detail totals are preview/demo data until wired to the live chain/API source.
