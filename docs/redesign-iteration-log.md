# Renaiss World Cup Redesign Iteration Log

## Round 01 - Information Architecture
1. Removed the one-page landing stack.
2. Replaced anchor-scroll navigation with a command-room view switch.
3. Made Vote Room the default first screen.
4. Split Draw, Ledger, and Rules into separate workspaces.
5. Kept round switching global across workspaces.
6. Moved ticket source details out of the voting surface.
7. Kept draw status away from vote controls.
8. Made mobile use one active workspace at a time.
9. Removed marketing section sequencing from the product surface.
10. Audit: the page now behaves as an app, not a long landing page.

## Round 02 - Visual Language
1. Restored graphite canvas as the primary background.
2. Restored trophy gold as the only strong accent.
3. Reduced the blue hero asset with grayscale, sepia, and dark overlays.
4. Removed the oversized hero headline.
5. Replaced large rounded cards with compact 8px control surfaces.
6. Added low-contrast structural grid texture.
7. Kept flags as content color, not UI chrome.
8. Removed purple/blue SaaS gradient styling.
9. Used mono numerals for tickets and IDs.
10. Audit: the look is closer to a premium tournament cockpit.

## Round 03 - First Screen
1. First screen now shows active navigation, round switcher, match list, match theater, and ticket console.
2. The hero image supports the active match instead of taking over the page.
3. Current round balance is visible in the masthead.
4. Match cards became compact rows.
5. Wallet status moved to the header pill.
6. Vote controls live beside the match.
7. The selected match owns the center of the screen.
8. Ticket controls no longer force vertical page travel.
9. The main workspace has a fixed desktop viewport.
10. Audit: desktop no longer depends on scrolling to understand the product.

## Round 04 - Voting Interaction
1. Round selection changes the match list.
2. Match selection changes only the theater and ticket console.
3. Team selection happens inside the match theater.
4. Preview allocation writes local preview state only.
5. Preview allocations are wallet-scoped.
6. Duplicate preview allocation per match is blocked.
7. Locked, scheduled, and official-final matches disable allocation.
8. Ticket range is shown in the console.
9. After-preview balance is calculated without double subtraction.
10. Audit: the current voting flow is clear without pretending to be official.

## Round 05 - Draw Desk
1. Draw status moved to its own workspace.
2. Each round has an independent draw row.
3. The selected round controls the draw stage.
4. Twenty prize slots are visible as numbered cells.
5. Eligible entries, round pool, chance, and pending entries are split.
6. Draw pipeline has Result, Eligible, Snapshot, Reveal.
7. No fake winner names are rendered.
8. Reveal contract boundary remains explicit.
9. Correct-pick-only logic is preserved.
10. Audit: draw feels operational instead of decorative.

## Round 06 - Ledger Room
1. Chain summary source is now a dedicated workspace.
2. Ledger hash is visible but constrained.
3. Pack weights are a real table.
4. Wallet selection remains functional.
5. Raw-to-final ticket recalculation is shown.
6. SBT multiplier is surfaced next to the wallet.
7. Round reset balance is clear.
8. API key ownership is stated as server-side.
9. Configured ledger API issues are not hidden.
10. Audit: fallback/snapshot state stays explicit.

## Round 07 - Rules Room
1. Rules changed from prose blocks to an audit flow.
2. Ticket source, reset, cutoff, result, and draw are ordered.
3. Backend cutoff enforcement is called out.
4. FIFA official-final trigger is called out.
5. Wrong predictions do not become draw entries.
6. Wallet connect boundary is visible.
7. Vote write boundary is visible.
8. Vote record boundary is visible.
9. Draw reveal boundary is visible.
10. Audit: rules are scannable without bloating the main screen.

## Round 08 - Semantic Structure
1. Main shell uses `main`.
2. Command navigation uses `menu` inside the sticky pill header.
3. Workspace uses `section`.
4. Match media uses `figure` and `figcaption`.
5. Metrics use `dl`, `dt`, and `dd`.
6. Lists use `ol`, `li`, and `menu`.
7. Ticket input uses `fieldset`, `legend`, and `output`.
8. Ledger weights use `table`.
9. Generic `div` use was removed from the new control-room layer.
10. Audit: the new UI is easier to maintain and inspect.

## Round 09 - Responsive Behavior
1. Desktop keeps the app shell fixed to one viewport.
2. Tablet moves the ticket console beneath the theater.
3. Mobile keeps the pill header and lets the command menu occupy its own row.
4. Mobile uses horizontal round switching.
5. Mobile permits workspace scrolling only where necessary.
6. Team buttons stack cleanly on narrow screens.
7. Prize slots change from ten columns to five.
8. Typography uses fixed/rem sizing, not viewport text scaling.
9. Main controls keep stable heights.
10. Audit: mobile is usable without horizontal overflow.

## Round 10 - Final Taste Pass
1. Removed the old header/hero/section page rhythm.
2. Kept only one strong visual image.
3. Reduced border noise.
4. Prevented cards inside cards.
5. Kept accent color sparse.
6. Kept labels short and product-like.
7. Preserved all chain-ticket math.
8. Preserved all out-of-scope integration boundaries.
9. Kept React state centralized and UI components separated.
10. Audit: current direction is a premium app surface instead of an MVP page.

## Round 11 - Pill Header Alignment
1. Replaced the rail-first layout with a RenaissTicket-style pill header.
2. Split brand, navigation, and wallet status into separate glass pills.
3. Audit: the first impression now matches the requested header language.

## Round 12 - Accent Cleanup
1. Removed blue and cyan UI language from the current theme.
2. Kept graphite, off-white, champagne gold, muted green, and soft red only.
3. Audit: the palette no longer reads as a generic blue Web3 dashboard.

## Round 13 - Header Density
1. Kept the header under 50px on desktop.
2. Removed descriptive nav subtext from each command.
3. Audit: navigation feels like a control bar, not a marketing menu.

## Round 14 - Mobile Header
1. Moved mobile navigation into a second pill row.
2. Kept wallet and brand visible at the top.
3. Audit: mobile avoids hamburger ambiguity without horizontal overflow.

## Round 15 - Masthead Balance
1. Reduced the main headline scale and weight.
2. Moved current-round balances into compact pills beside the title.
3. Audit: the top area is lighter and more operational.

## Round 16 - Draw Entry Visibility
1. Added active-round accumulated draw entries to the masthead.
2. Calculated it from eligible plus pending entries for the active round.
3. Audit: users can see current draw accumulation without opening Draw Desk.

## Round 17 - Assumed Preview Data
1. Seeded preview allocations for the active round.
2. Kept the seed marked as assumed preview data, not official chain state.
3. Audit: the UI demonstrates accumulated draw entries without pretending votes are live.

## Round 18 - Round Switch Simplification
1. Removed full card borders from round selection.
2. Converted the active round into a soft pill on divider rails.
3. Audit: round navigation now reads lighter and less boxed.

## Round 19 - Match List Reduction
1. Removed rectangular row boxes from match selection.
2. Replaced selected state with a left gold status line.
3. Audit: match rows scan like an app table instead of stacked cards.

## Round 20 - Panel Shadow Removal
1. Removed heavy panel shadows from the control-room surfaces.
2. Replaced most panel frames with top dividers and low-alpha surfaces.
3. Audit: the page breathes more and no longer stacks heavy containers.

## Round 21 - Theater Weight
1. Reduced the match theater frame from full border to structural divider.
2. Kept the match image as the visual anchor.
3. Audit: the theater still has focus without adding another card.

## Round 22 - Team Pick Shape
1. Converted team pick controls to elongated pill forms.
2. Kept flags and team labels stable within fixed-height controls.
3. Audit: the voting action now relates to the header shape language.

## Round 23 - Ticket Console De-boxing
1. Removed the fieldset box around ticket amount.
2. Kept numeric controls, slider, and balance in place.
3. Audit: the ticket console feels like a tool panel rather than a nested card.

## Round 24 - Console Note Treatment
1. Removed alert-style boxes from console notes.
2. Used a quiet left rule for boundary messaging.
3. Audit: disabled wallet/write states remain clear without visual shouting.

## Round 25 - Draw List Treatment
1. Removed boxed draw rows.
2. Matched draw selection to the match-list left-rule behavior.
3. Audit: Vote Room and Draw Desk now share one interaction grammar.

## Round 26 - Prize Slot Tone
1. Replaced small square prize cells with soft pill markers.
2. Kept active prize slots gold with an inset outline.
3. Audit: the draw surface feels more premium and less spreadsheet-like.

## Round 27 - Typography Weight
1. Lowered major headings from heavy display weight to lighter app weight.
2. Kept labels compact and uppercase only where they function as section markers.
3. Audit: the screen reads less loud while retaining hierarchy.

## Round 28 - Border Audit
1. Reserved full 1px borders for header pills, form controls, and primary commands.
2. Replaced structural borders with divider lines.
3. Audit: borders now indicate interaction or separation, not decoration.

## Round 29 - Desktop Viewport
1. Preserved the one-screen command-room layout.
2. Let internal lists scroll instead of forcing page-level scanning.
3. Audit: desktop still works like an app after removing card frames.

## Round 30 - Tablet Layout
1. Kept the ticket console below or beside the theater depending on width.
2. Prevented the new header from conflicting with the workspace grid.
3. Audit: the lighter layout survives intermediate widths.

## Round 31 - Narrow Viewport
1. Verified 390px mobile width with no horizontal overflow.
2. Confirmed all four header commands remain visible.
3. Audit: the pill header is practical, not just desktop decoration.

## Round 32 - Navigation Feedback
1. Verified Vote, Draw, Ledger, and Rules command switches.
2. Preserved the active dark pill state.
3. Audit: the header works as the real app navigation.

## Round 33 - Content Priority
1. Kept current match, active round, remaining tickets, and draw entries in the first viewport.
2. Removed lower-page dependency for campaign comprehension.
3. Audit: users can act without scrolling through a campaign site.

## Round 34 - Data Boundary
1. Kept live wallet voting, vote recording, and wallet connection out of scope.
2. Kept preview allocations visually separate from official-final eligibility.
3. Audit: no fallback is being presented as production voting.

## Round 35 - Ledger Confidence
1. Preserved ledger source, hash, pack weights, and wallet recalculation.
2. Kept fallback or issue messaging explicit in the Ledger Room.
3. Audit: the premium surface does not hide source boundaries.

## Round 36 - Rules Compression
1. Kept rules in a dedicated room instead of loading the vote screen with prose.
2. Maintained cutoff, final result, eligibility, and draw boundaries.
3. Audit: rules are available without making the app feel like documentation.

## Round 37 - Asset Discipline
1. Kept the hero image as the match-stage atmosphere.
2. Avoided adding decorative blobs or generic gradients.
3. Audit: visual interest comes from campaign imagery and product state.

## Round 38 - Shape System
1. Used pills for global navigation, balances, and high-intent vote controls.
2. Used flat rows and dividers for scan-heavy operational data.
3. Audit: shape now maps to function instead of being uniformly card-based.

## Round 39 - Moodboard Validation
1. Generated a 12-tile Creative Production moodboard with single visual references.
2. Regenerated the failed audit-flow tile instead of using a placeholder.
3. Audit: the style direction has concrete references beyond the code.

## Round 40 - Final Verification Pass
1. Rebuilt the Vite app after the pill-header and de-boxing edits.
2. Verified desktop reload, mobile width, and command navigation.
3. Audit: the current build matches the requested direction and remains runnable locally.

## Round 41 - Product Requirements Recheck
1. Re-read the MVP requirement PDF for Home, Schedule, Vote, Draw, Rules, and Milestone.
2. Identified that Home and Milestone were not wired into the active app shell.
3. Audit: the next pass must satisfy the actual requirement surface, not only the vote room.

## Round 42 - Navigation Contract
1. Changed the primary nav to Home / Schedule / Vote / Draw / Rules.
2. Removed Ledger from the primary nav path so the header matches the requirement document.
3. Audit: ledger evidence remains inside source and rules surfaces instead of being the first app route.

## Round 43 - Home First
1. Made Home the default active view.
2. Added a real first-screen hero instead of dropping users into Vote.
3. Audit: the first impression is now campaign-led instead of tool-only.

## Round 44 - Hero Visual Asset
1. Reused the existing World Cup hero bitmap as the main visual anchor.
2. Kept the copy layered over the image rather than splitting it into a card column.
3. Audit: the hero follows the product-page rule that the first viewport must carry the campaign.

## Round 45 - Logo Spectrum
1. Used the Renaiss logo as the source for mint, amber, rose, and violet light accents.
2. Added prismatic light bands rather than a one-color dashboard wash.
3. Audit: color now comes from the brand mark, not a generic theme.

## Round 46 - Glass Header
1. Reworked header surfaces into transparent glass with blur, saturation, highlights, and inset shadows.
2. Kept the header pill shapes but removed the flat milky look.
3. Audit: the header now has more material depth.

## Round 47 - PillNav Behavior
1. Preserved a pill-navigation interaction grammar from React Bits PillNav.
2. Added a bright active capsule with hover highlight and shine pass.
3. Audit: nav state is visible without relying on plain boxes.

## Round 48 - Button Microinteractions
1. Added shared glare sweeps for buttons and action pills.
2. Added active press compression for tactile feedback.
3. Audit: buttons no longer feel static.

## Round 49 - Magnet Interaction
1. Added a source-copied Magnet wrapper for hero CTAs.
2. Scoped pointer movement cleanup to each wrapped element.
3. Audit: the effect is an enhancement and does not replace accessible buttons.

## Round 50 - Hero CTA Hierarchy
1. Added Start voting as the primary hero action.
2. Added View schedule as a secondary action.
3. Audit: the first screen gives users a clear next step.

## Round 51 - Hero Metrics
1. Added available wallet tickets, current-round entries, and estimated chance to the hero glass card.
2. Used animated CountUp for numeric surfaces.
3. Audit: the campaign state is visible immediately.

## Round 52 - Milestone Surface
1. Wired milestone data into the active UI.
2. Added a progress bar, current metric, next target, unlocked list, and locked future milestones.
3. Audit: the missing milestone requirement is now represented.

## Round 53 - Milestone API Boundary
1. Labeled milestone progress as backend metric driven.
2. Avoided pretending the browser estimates official campaign volume.
3. Audit: preview state remains separate from production truth.

## Round 54 - Prize Pool Communication
1. Showed unlocked prize additions.
2. Preserved locked future milestones with clear disabled styling.
3. Audit: users can see what has been added and what remains locked.

## Round 55 - Schedule Room
1. Added a dedicated schedule view.
2. Each match shows matchup, venue, kickoff, cutoff, status, and pool entries.
3. Audit: the requirement for Match Schedule now has its own screen.

## Round 56 - Voteable State
1. Marked open and closing-soon matches as voteable.
2. Added direct Vote this match actions from Schedule.
3. Audit: users can tell which matches can still be acted on.

## Round 57 - Locked State
1. Locked, scheduled, and official-final matches keep visible audit information.
2. Their action buttons are disabled and labeled with the reason.
3. Audit: disabled states are clearer and not hidden.

## Round 58 - Vote Legend
1. Added a match-state legend to Vote.
2. Separated Can vote, Closing, Locked, and Final with distinct treatments.
3. Audit: users do not need to infer states from tiny dots.

## Round 59 - Team Button Clarity
1. Team buttons now show Locked or Allocated when disabled.
2. Pick appears only when the match can actually accept preview allocation.
3. Audit: disabled team controls no longer look selectable.

## Round 60 - Status Copy
1. Changed Open to Open to vote.
2. Changed Locked to Voting locked and Scheduled to Not open yet.
3. Audit: status text now maps directly to user action.

## Round 61 - Glass Dashboard
1. Added glass dashboard KPI surfaces below the hero.
2. Used blur and transparent layers instead of opaque boxes.
3. Audit: the dashboard feels lighter and closer to the requested material style.

## Round 62 - Metallic Depth
1. Added inset highlights and dark bottom edges to glass panels.
2. Kept gold accent sparse for reward and prize information.
3. Audit: surfaces feel more metallic without turning into heavy cards.

## Round 63 - Border Glow
1. Reused BorderGlow for the hero state card.
2. Fed it brand-spectrum colors rather than unrelated purple-blue gradients.
3. Audit: the strongest glow is tied to the brand logo.

## Round 64 - Shiny Text
1. Added ShinyText to the hero headline's reset phrase.
2. Kept the text real and readable with CSS background clipping.
3. Audit: the text animation is visual polish, not a canvas-only substitution.

## Round 65 - Background Motion
1. Added slow prismatic spectrum drift behind the app shell.
2. Kept it subtle enough to avoid fighting foreground controls.
3. Audit: the page has motion without becoming noisy.

## Round 66 - Hero Image Contrast
1. Darkened the hero image for text contrast.
2. Added colored screen bands over the image.
3. Audit: the hero is readable and more premium.

## Round 67 - Header Transparency
1. Increased header transparency.
2. Added blur and saturation to make background light pass through.
3. Audit: the header no longer looks like a flat gray pill.

## Round 68 - Active Nav Capsule
1. Made the active nav pill bright and reflective.
2. Added shadow and inset highlight.
3. Audit: selected route now has a React Bits-like active state.

## Round 69 - Home Route State
1. Brand click now routes back to Home.
2. Header state updates when the home route is active.
3. Audit: Home behaves like a first-class route.

## Round 70 - Schedule Route State
1. Schedule route uses the same round selector as Vote.
2. Selecting a schedule match updates the shared selected match.
3. Audit: schedule and vote remain connected.

## Round 71 - Vote Handoff
1. Schedule cards can send users directly to Vote for an open match.
2. The selected match persists through the route change.
3. Audit: action flow is shorter.

## Round 72 - Match Audit Visibility
1. Locked matches remain visible with kickoff, cutoff, and pool information.
2. Official final matches remain visible with settled status.
3. Audit: users can inspect closed states.

## Round 73 - Home KPI Density
1. Kept home KPIs compact.
2. Avoided stacking large explanatory blocks under the hero.
3. Audit: the first screen still feels app-like.

## Round 74 - Milestone Density
1. Milestone future levels use small glass tiles.
2. Unlocked levels receive a subtle brand-spectrum lift.
3. Audit: milestone is visible without becoming a wall of cards.

## Round 75 - Mobile Navigation
1. Reduced mobile nav button widths for five primary routes.
2. Kept the command menu as a full-width row.
3. Audit: the header can fit the required nav on 390px.

## Round 76 - Mobile Hero
1. Hero layout collapses to one column.
2. CTAs stack full-width for thumb access.
3. Audit: Home remains usable on mobile.

## Round 77 - Mobile Milestone
1. Milestone levels collapse to one column.
2. The progress bar stays full width.
3. Audit: milestone does not cause horizontal overflow.

## Round 78 - Mobile Schedule
1. Schedule cards collapse to one column.
2. Tables are not used for match schedule on mobile.
3. Audit: schedule stays readable at 390px.

## Round 79 - Reduced Motion
1. Existing animation helpers respect reduced motion.
2. Magnet and CountUp avoid movement when reduced motion is requested.
3. Audit: animation remains accessible.

## Round 80 - Button Coverage
1. Header, hero, schedule, match, round, team, ticket, draw, and allocation buttons receive hover or press feedback.
2. Disabled buttons keep cursor and color differences.
3. Audit: interactive elements are no longer visually inert.

## Round 81 - Out-of-Scope Integrity
1. Wallet connection remains unimplemented by request.
2. Official vote write and vote record persistence remain unimplemented by request.
3. Audit: frontend preview does not fake chain actions.

## Round 82 - Draw Continuity
1. Home shows current-round accumulated entries.
2. Draw still shows eligible, pending, pool, chance, and reveal pipeline.
3. Audit: the new hero does not replace draw details.

## Round 83 - Ticket Continuity
1. Vote still calculates remaining round tickets.
2. Preview allocation still deducts from the active round only.
3. Audit: visual changes did not remove ticket behavior.

## Round 84 - Round Reset Story
1. Hero states that each round resets.
2. Rules still explain per-round reset.
3. Audit: the updated game rule is visible in the product story.

## Round 85 - Campaign Volume Story
1. Milestone current value uses the ledger total.
2. Next target and prize additions are exposed.
3. Audit: milestone progress is understandable.

## Round 86 - Source Confidence
1. Home KPI names the ledger source.
2. Rules preserve backend and audit boundaries.
3. Audit: design polish does not hide source truth.

## Round 87 - Visual Restraint
1. Avoided adding decorative bokeh or unrelated gradients.
2. Used light bars, glass, and metal as the visual system.
3. Audit: motion and color remain tied to the brand request.

## Round 88 - Component Separation
1. Kept HomeRoom, ScheduleRoom, Magnet, VoteRoom, DrawRoom, and RulesRoom separate.
2. Avoided moving all logic into one page file.
3. Audit: the implementation remains maintainable.

## Round 89 - Data Separation
1. Kept campaign runtime helpers in data files.
2. Kept UI state in App and display components.
3. Audit: design work did not collapse data boundaries.

## Round 90 - PDF Coverage Check
1. Header nav now includes Home, Schedule, Vote, Draw, and Rules.
2. Milestone bar, schedule, vote, draw, and rules are visible.
3. Audit: the primary frontend requirements are represented.

## Round 91 - Acceptance Criteria Mapping
1. Preview allocation still requires confirm action before deduction.
2. Cutoff/locked states disable allocation in preview.
3. Audit: the frontend demonstrates core acceptance flows without backend writes.

## Round 92 - Locked Match Selection
1. Locked matches can be selected for inspection.
2. Their team actions remain disabled.
3. Audit: audit visibility and action safety coexist.

## Round 93 - Official Final Selection
1. Official-final matches can show settled status.
2. Correct preview allocations contribute to eligible entries.
3. Audit: result-settled behavior remains inspectable.

## Round 94 - Hero Hierarchy
1. Brand, headline, explanation, actions, and state card are ordered.
2. The next dashboard band remains visible below the hero.
3. Audit: first viewport has narrative and product state.

## Round 95 - Header Hierarchy
1. Brand, route nav, and wallet status are visually distinct.
2. Wallet state stays compact and secondary.
3. Audit: the header no longer overwhelms the hero.

## Round 96 - Schedule Hierarchy
1. Match cards emphasize action availability first.
2. Times and pool entries sit below as supporting data.
3. Audit: users can choose quickly.

## Round 97 - Milestone Hierarchy
1. Current value and next target sit above individual milestones.
2. Unlocked count appears in the milestone header.
3. Audit: the progress story reads top-down.

## Round 98 - Animation Audit
1. Entry animations remain on list rows.
2. Hover glare and magnet effects are scoped to controls.
3. Audit: animation is assigned to interaction points, not random decoration.

## Round 99 - Build Audit
1. Rebuilt the app after adding Home, Schedule, Magnet, and new styles.
2. Verified the bundle compiles with the updated route set.
3. Audit: the code is runnable after the 100-round pass.

## Round 100 - Current Best Pass
1. The app now starts with a premium hero and brand-spectrum glass language.
2. Milestone, schedule states, vote states, draw entries, and route navigation are visible.
3. Audit: this pass moves the product toward the requested high-end campaign experience.

## Round 101 - MVP Bracket Scope
1. Re-checked the requirements PDF against the active data model.
2. Identified Round of 32 as missing from the frontend runtime.
3. Audit: the app needed five MVP rounds, not four.

## Round 102 - Round of 32 Data
1. Added Round of 32 to the campaign round definitions.
2. Added 16 sample Round of 32 matches with kickoff, cutoff, status, pool, and result fields.
3. Audit: Schedule, Vote, and Draw can now represent the full opening knockout round.

## Round 103 - Country Asset Coverage
1. Added real flag assets for the new sample countries.
2. Added localized team labels for the expanded bracket.
3. Audit: no placeholder flags or text-only country assets were introduced.

## Round 104 - Five-Round Responsive QA
1. Updated the round switch to support 32 / 16 / 8 / 4 / final.
2. Verified fresh desktop load starts at Round of 32.
3. Audit: 390px checks pass across Home, Schedule, Vote, Draw, and Rules.

## Round 105 - Ticket Input Completeness
1. Added a numeric ticket input alongside the range control.
2. Added direct minus/plus controls and quick amount pills.
3. Audit: the Vote UI now satisfies the ticket stepper/input requirement more explicitly.

## Round 106 - Allocation Summary
1. Added a current-round preview allocation summary in the Vote console.
2. Each allocation shows team, match, ticket count, and pending/eligible/lost state.
3. Audit: pending allocation state is visible without pretending official vote records exist.

## Round 107 - Team Vote Row Polish
1. Reworked country voting actions into wide glass rows with square flags, local team names, vote badges, compact totals, and fixed plus/lock affordances.
2. Matched the user-provided row direction while preserving disabled and allocated states.
3. Audit: desktop and 390px checks show no horizontal overflow.

## Round 108 - Milestone Config Boundary
1. Added a normalized milestone summary contract for `VITE_MILESTONE_SUMMARY_URL`.
2. Home milestone now distinguishes live admin config, bundled preview config, and API issue states.
3. Audit: milestone visibility no longer hides whether the table came from backend/admin config or bundled preview data.

## Round 109 - Vote State Clarity
1. Added a selected-match state banner for open, closing, scheduled, locked, final, and already allocated matches.
2. Converted match-list status text into colored glass pills for faster scanning.
3. Audit: users can distinguish inspection-only matches from actionable vote windows before choosing a team.

## Round 110 - Pill Header Refinement
1. Reworked the command navigation into a more stable PillNav-style active capsule using shared CSS variables.
2. Added spectrum light, glass depth, metallic highlight, and smoother active-index movement.
3. Audit: the header is closer to the requested transparent Renaiss-ticket pill language instead of a flat tab bar.

## Round 111 - Reference Vote Card Match
1. Tuned country voting actions toward the supplied horizontal row reference: square flag, strong local name, gold ticket badge, right-aligned vote total, and glass plus control.
2. Added hover, selected, allocated, locked, and final-winner visual states without changing wallet or official vote behavior.
3. Audit: the country control now reads as a premium vote card instead of a generic circular option.

## Round 112 - Hero Milestone Ladder
1. Promoted milestone progress into the hero glass card so the next prize layer is visible before scrolling.
2. Rebuilt the home milestone section as a chroma Prize Ladder with current metric, remaining target, unlocked count, source status, and clearer locked/unlocked/next states.
3. Audit: milestone is now a primary homepage campaign object instead of a secondary dashboard detail.

## Round 113 - Round Draw Desk
1. Reworked Draw into a per-round desk with explicit eligible, pending, locked, snapshot, and revealed states.
2. Added animated prize slots, richer round pool rows, draw hero metrics, lost-entry visibility, and clearer pipeline steps.
3. Audit: the draw area now communicates per-round winner pools without generating fake winners or implying the draw contract is connected.

## Round 114 - Reference Country Vote Cards
1. Tuned the primary vote cards closer to the supplied horizontal reference: longer glass row, square flag, strong country label, right-side vote total, and fixed action control.
2. Upgraded the legacy `MatchVotePanel` team options to the same card system so country voting does not fall back to the old compact option style.
3. Audit: locked, selected, and available states still remain visually distinct without adding wallet or official vote write behavior.

## Round 115 - Vote Card Viewport Placement
1. Moved the country vote card stack to the top anchor of the match visual so the first team card is visible in the current in-app browser width.
2. Kept the image treatment behind the cards while avoiding a bottom-cropped primary action state.
3. Audit: the vote choice now appears as a real match action, not a control hidden below the fold.

## Round 116 - Schedule Command Cards
1. Rebuilt Schedule as compact match command cards with a round state summary, chroma status beams, team vote bars, kickoff/cutoff/pool facts, and explicit action states.
2. Shortened the Schedule headline and tuned mobile state chips so the first actionable match appears earlier without horizontal page overflow.
3. Audit: current viewport and 390px checks pass with open actions enabled, locked actions disabled, and no wallet or vote-write behavior added.

## Round 117 - Vote Card And Rules Density
1. Tuned the primary country vote cards to the provided horizontal reference with a darker glass row, larger flag, gold ticket badge, right-aligned vote total, and fixed plus/lock action control.
2. Rebalanced the Rules control surface so lifecycle, eligibility, round cards, and integration boundaries stay visible with internal scroll where needed.
3. Audit: build passes; 1280px and 390px checks show no horizontal page overflow for Vote or Rules, and the in-app browser is left open on Vote.

## Round 118 - Hero State Dock
1. Added a premium glass `HomeStateDock` overlapping the hero edge so voteable matches, locked matches, round draw slots, and milestone progress are visible on the first screen.
2. Wired each dock card as a real action: open state goes to Vote, locked state goes to Schedule, draw state goes to Draw, and milestone scrolls to the Prize Ladder.
3. Audit: build passes; 1280px and 390px Home checks show no horizontal page overflow, and all four dock actions route to the expected surface.

## Round 119 - Country Vote Row Reference
1. Tuned the `TeamPick` vote button against the provided reference image with a darker long-form glass row, square flag frame, metal ticket badge, right-aligned compact vote total, and cleaner plus-ring control.
2. Added a precise accessible label for each country vote row so the whole card reads as one selectable match choice.
3. Audit: build passes; 1280px Vote card check shows 576x106 rows with no horizontal overflow, and 390px shows 291x100 rows with readable flag, badge, total, and action control.

## Round 120 - No Gradient Trim Preference
1. Removed the global click-spark interaction wrapper, deleted the `ClickSpark` component, and removed its CSS/keyframes so click burst effects cannot appear.
2. Added a documented no-gradient-trim CSS rule that disables colored bottom, side, and top accent lines across the header pill, round switch, vote cards, schedule cards, draw cards, milestone cards, and state banners.
3. Audit: build passes; in-app browser shows `clickSparkElements: 0`, neutral page backgrounds, no active pill underline, no vote-card side line, no room mast bottom line, and no match banner beam.

## Round 121 - Vote Match Card Index
1. Rebuilt the Vote match index rows as compact glass match cards with match id, state chip, two country flags, local team names, cutoff time, and venue.
2. Preserved the single-click match selection behavior while making open, closing, locked, final, and allocated matches readable before entering the main vote panel.
3. Audit: build passes; 1280px shows 16 match cards with 28x21 flags and no horizontal overflow, 390px shows 300x95 cards, M58 selection switches the theater to `Canada vs Denmark`, and click-spark remains `0`.

## Round 122 - Ticket Console Allocation Desk
1. Rebuilt the Vote ticket console into wallet, round balance, allocation amount, live preview, and current-round summary cards so the user can read selection state before staging tickets.
2. Fixed the right-column height issue by using desktop internal scroll and mobile natural page flow, keeping the summary and preview button from collapsing.
3. Audit: build passes; 1280px and 390px checks show no horizontal overflow, no click-spark elements, Mexico selection moves preview to `Ready to preview`, and `Preview allocation` becomes enabled without adding wallet connect or official vote-write behavior.

## Round 123 - Hero Mission Control
1. Rebuilt the homepage hero around a `HeroCommandDeck` so wallet tickets, current-round vote windows, prize slots, draw chance, round reset lifecycle, and Prize Ladder are visible in the first screen.
2. Changed the hero H1 to the product name and scoped homepage open/locked/final counts to the active round instead of the whole tournament, making available versus locked choices clearer.
3. Audit: build passes; 1280px and 390px browser checks show no horizontal overflow, no click-spark elements, no active pill gradient underline, visible Prize Ladder, visible round reset flow, and a next-section dock hint on mobile.

## Round 124 - Clean Glass Pill Header
1. Reworked the command header into a stable PillNav-style glass capsule with equal-width cells, a neutral metal active capsule, and consistent brand and wallet glass treatment.
2. Replaced the unsupported active-index CSS math with data-index selectors so the active capsule aligns exactly after animation on desktop and mobile.
3. Audit: build passes; 1280px and 390px checks show no horizontal overflow, no click-spark elements, hidden gradient underline pseudo-elements have no background/filter, and the Vote capsule settles with `alignmentDelta: { x: 0, width: 0 }`.

## Round 125 - Neutral Motion Buttons
1. Replaced the global button sweep highlight with a restrained metal interaction system: hover brightness, focus ring, press compression, and reduced-motion protection.
2. Removed the `StarBorder` top/bottom beam output and stripped its unused animation CSS so the primary CTA no longer depends on disabled gradient-line markup.
3. Tuned hero CTA, confirm CTA, vote country rows, schedule actions, and home state cards away from colored trim lines while preserving clear hover, selected, locked, and disabled states.
4. Audit: build passes; in-app browser checks at 1280x900 and 390x844 show no horizontal overflow, `clickSparkElements: 0`, `starBeamElements: 0`, neutral page backgrounds, no button sweep pseudo-elements, no vote-row side rail, and no schedule-card beam.

## Round 126 - Schedule Decision Gates
1. Added a Schedule gate board with live, closing, preview placed, locked, final, and scheduled jump buttons so users can separate voteable matches from read-only states before scanning the list.
2. Sorted Schedule matches by decision priority: closing soon, open, preview placed, locked, final, then scheduled.
3. Removed the schedule match beam markup and changed Schedule state surfaces to neutral glass cards with state borders instead of colored gradient trim lines.
4. Audit: build passes; desktop Schedule shows six gate buttons, first card is `Vote before cutoff`, live gate enters Vote on `Canada vs Denmark`, and desktop/mobile checks show `overflowX: 0`, `clickSparkElements: 0`, and `scheduleBeamElements: 0`.

## Round 127 - Draw Readiness Desk
1. Added a Draw readiness deck for each selected round with official-final progress, eligible entries, pending entries, prize slots, and reveal-layer boundary.
2. Removed Draw side rail pseudo-elements, colored stage overlays, and active prize/pipeline chroma blends; Draw now uses neutral glass/metal surfaces with restrained state borders.
3. Replaced Sparkles icons across active and legacy campaign surfaces so no spark/ripple-like visual language remains in the DOM.
4. Audit: build passes; desktop 1280x900 and mobile 390x844 Draw checks show five readiness cards, no horizontal page overflow, `sparkOrRipple: 0`, and `draw-index::before` / `draw-stage::after` disabled at the source.

## Round 128 - First-Screen Milestone Command
1. Replaced the small hero milestone pill with a clickable Milestone Command strip showing unlocked layers, current metric, next target, remaining tickets, and a restrained progress meter.
2. Kept the Milestone Command visible on mobile and moved the mobile state dock upward so the hero still leaves a next-section hint in the first viewport.
3. Neutralized the complete Prize Ladder rail by removing active color beams, shine keyframes, StarBorder leftovers, and unused spark/star visual vocabulary.
4. Audit: build passes; 1280x900 and 390x844 Home checks show the milestone command visible in the first screen, next dock hint visible, no horizontal overflow, `sparkOrRipple: 0`, `starBorder: 0`, and the milestone command scrolls to the full Prize Ladder.

## Round 129 - Bilingual Language Module
1. Added a dedicated `src/app/i18n` language layer with `zh-Hant` and `en` dictionaries, a provider, persisted language selection, document language/title sync, and campaign copy helpers for rounds, teams, milestones, statuses, and source labels.
2. Migrated the control-room surfaces, including Home, Schedule, Vote, Draw, Rules, Ledger, and the confirm modal, off hardcoded UI strings so language additions can be handled in the dictionary instead of JSX.
3. Kept preview-only boundaries explicit in both languages: wallet connect, official vote write, vote record storage, and draw contract/reveal remain marked as not connected.
4. Audit: build passes; in-app browser checks verified Chinese and English nav, Home, Rules, and Vote copy, no raw translation keys, no console errors, and 390x844 header layout has visible language controls with no horizontal overflow.

## Round 130 - Unified Command Glass Bar
1. Consolidated the brand, navigation, language, and wallet controls into a single frosted command bar so the header reads as one premium pill surface instead of four separate floating capsules.
2. Flattened the internal header cells and kept the active navigation state as a neutral metal slab, avoiding colored bottom, top, or side trim lines.
3. Reframed the homepage state dock as one glass control tray with embedded action segments for open voting, locked matches, draw slots, and milestone progress.
4. Audit: build passes; 1280x900 and 390x844 checks show no horizontal overflow, `sparkOrRipple: 0`, milestone surfaces present, no active pill underline, and dock/header pseudo-elements report no colored trim backgrounds.

## Round 131 - Legacy Language Surface Cleanup
1. Removed the unused legacy component cluster that still carried old hardcoded English JSX copy: the previous bracket board, standalone hero, old vote panel, draw center, rules section, ledger dashboard, and their support components.
2. Kept the active `control-room` surfaces and shared animation/glass primitives intact; remaining inactive candidates are either i18n-ready or intentionally unmounted.
3. Audit: build passes after deletion, old component names no longer appear in imports, and active JSX text/ARIA scans do not show direct English UI strings outside the i18n dictionaries.

## Round 132 - Unified State Materials
1. Added shared state material tokens across Vote match rows, Vote state banners, Schedule gate buttons, and Schedule match cards so open, closing, locked, final, scheduled, and preview states read as one system.
2. Replaced the old side-beam dependency in the Vote state banner with broad glass-surface illumination, preserving color clarity without bottom, top, or side gradient trim lines.
3. Strengthened voteable versus read-only contrast through whole-surface glow, chip borders, icon color, opacity, and hover shadow rather than click/ripple effects.
4. Audit: build passes; in-app Vote/Schedule checks and 390x844 checks show no horizontal overflow, `rawKeys: false`, `sparkOrRipple: 0`, no console errors, and disabled/locked surfaces remain visibly separate from active vote surfaces.

## Round 133 - Compact Bilingual Command Density
1. Compressed the non-home command mast into a thinner app control surface with smaller status cards, tighter metal pills, and a lower round switch while preserving the no-gradient-trim rule.
2. Added mobile-specific command density: long mast body copy is hidden on small screens, round controls become compact horizontal chips, and Vote match rows now enter the first 390px viewport sooner.
3. Reworked the mobile Schedule summary and decision gates into a short status bar plus horizontal gate rail so live, closing, locked, final, and scheduled states are readable before the first match card.
4. Audit: build passes; in-app 390x844 Vote shows first match row at `y=537` with `overflowX: 0`, `rawKeys: false`, and `sparkOrRipple: 0`; mobile Schedule shows gate board at `y=563`, first match at `y=676`, no active nav underline pseudo-element, and no room mast trim pseudo-element.

## Round 134 - Magnetized Premium Controls
1. Upgraded the shared `Magnet` interaction primitive so it can safely render real disabled buttons without swallowing the `disabled` attribute or breaking accessible button semantics.
2. Applied restrained magnetic motion to the primary decision surfaces: header pill controls, language switch, round switch, Vote match rows, country vote rows, preview allocation CTA, Schedule gates, Schedule match actions, and Draw round selectors.
3. Added layout-preserving magnet CSS for grid and flex controls, keeping country vote rows, schedule gates, match rows, and draw selectors in their original layouts while adding hover pull, micro lift, and active compression.
4. Audit: build passes; in-app desktop Vote/Schedule/Draw checks show magnet classes on the expected controls, disabled buttons still disabled, `overflowX: 0`, `rawKeys: false`, and `sparkOrRipple: 0`; 390x844 Vote/Schedule checks keep grid layout intact with no horizontal overflow.

## Round 135 - Language Extraction Hardening
1. Added `src/app/i18n/entities.js` so team names and venue names are owned by the language module instead of being read directly from data rows.
2. Extended `useCampaignCopy` with `teamName`, `venueName`, `sourceLabel`, `dateTime`, `number`, and `compactVotes` helpers so UI components do not implement their own language branching.
3. Added missing Trophy and Advancement History translation keys and updated legacy reusable components to accept localized team-name helpers before they are mounted again.
4. Added `npm run i18n:check` to validate locale dictionary parity, static `t()` keys, team translations, and venue translations for future language additions.
5. Audit: `npm run i18n:check` and `npm run build` pass; in-app browser checks verified zh-Hant and en Schedule/Vote states with no raw keys, no horizontal overflow, Chinese venues such as `墨西哥城`, English venues such as `Mexico City`, Chinese compact votes such as `8.7萬`, and English compact votes such as `87.4K`.

## Round 136 - Mobile Vote Readability Pass
1. Reworked the mobile round switch so stage labels such as `32 強進 16 強` and `32 to 16` wrap naturally instead of truncating into clipped ellipses.
2. Expanded the mobile workspace signal cards into a horizontal glass rail with readable values and details, keeping locked, voteable, draw, and round state visible without compressing text.
3. Softened the round switch material toward transparent metal glass while preserving the existing no-gradient-trim rule; no new bottom, side, or top accent lines were introduced.
4. Audit: `npm run i18n:check` and `npm run build` pass; in-app mobile Vote checks show `overflowX: 0`, `rawKeys: []`, `sparkOrRipple: 0`, zh-Hant round labels have `strongOverflowX: 0`, en round labels have `strongOverflowX: 0`, and hidden trim pseudo-elements remain `content: none` / `display: none`.

## Round 137 - Match Command Plate
1. Added a localized Match Command Plate to the Vote theater with both teams, compact vote pools, match code, venue, kickoff, cutoff, and current match state in one premium glass/metal surface.
2. Kept the country vote rows as the primary action targets while making the surrounding match context more polished and easier to scan before allocating tickets.
3. Compressed the mobile command plate from a stacked 425px surface to a 228-232px two-team layout so it does not bury the actual vote buttons.
4. Audit: `npm run i18n:check` and `npm run build` pass; in-app browser checks at 1280x900 and 390x844 show zh-Hant and en plate copy, `overflowX: 0`, `rawKeys: []`, `sparkOrRipple: 0`, no team-name or badge overflow, and no Match Command Plate pseudo gradient trim.

## Round 138 - Hero Milestone Vault
1. Promoted the homepage milestone control into a Prize Ladder vault with all five milestone layers visible in the hero: unlocked, next, and locked states now appear before the full milestone section.
2. Added localized milestone state labels for the hero vault and kept milestone names sourced through the i18n entity/copy layer instead of hardcoded JSX.
3. Reduced the right-side hero command card glare and compressed the mobile Campaign Desk by removing the duplicate Prize Ladder block there, keeping the hero polished without burying the next-section dock.
4. Audit: `npm run i18n:check` and `npm run build` pass; in-app browser checks show desktop zh-Hant and en milestone vaults with five layers, `overflowX: 0`, `rawKeys: []`, `sparkOrRipple: 0`, no level overflow, no vault pseudo gradient trim, and 390x844 mobile keeps 70-72px of the state dock visible in the first viewport.

## Round 139 - Locale Pack Extraction
1. Split the bilingual language system into explicit locale packs: `src/app/i18n/locales/zh-Hant.js` and `src/app/i18n/locales/en.js` now own UI messages, team names, venue names, and locale metadata.
2. Reduced `translations.js` to translator utilities and `entities.js` to locale-pack projections, keeping the existing `t()` and campaign-copy APIs stable for the React components.
3. Added `locales/index.js` as the future language registration point so the next locale can be added as one pack plus one import instead of scattered dictionary edits.
4. Audit: `npm run i18n:check` and `npm run build` pass; in-app browser checks verified zh-Hant and en Home/Vote language switching, document `lang` and title updates, localized match/team/venue text, `rawKeyCount: 0`, and `overflowX: 0`.

## Round 140 - Vote Readiness Console
1. Added a localized Allocation Readiness surface inside the Vote ticket console with four explicit checks: match state, country pick, ticket readiness, and preview-only boundary.
2. Converted country pick cards to radio-backed label controls so selected country state is represented by native form state while preserving the premium glass card treatment.
3. Fixed the collapsed theater visual row and non-interactive country cards by giving the match visual a real minimum height and making its overlay mask ignore pointer events.
4. Audit: `npm run i18n:check` and `npm run build` pass; in-app browser checks show the country card hit target is the real input, selecting Mexico turns all readiness rows ready and enables the preview button, locked M59 shows locked readiness rows, 390x844 has `overflowX: 0`, no raw keys, no console warnings, and `sparkOrRipple: 0`.

## Round 141 - Hero Featured Match Control
1. Added a localized Featured Match control to the Home hero Campaign Desk so the first screen now calls out the most urgent match, both teams, vote pools, cutoff, venue, and voteable/read-only state.
2. Wired the Featured Match CTA through the existing match-selection path so opening it enters Vote with the featured match selected, without adding wallet connect, vote writes, vote-record storage, or draw execution.
3. Reordered and compressed the mobile Campaign Desk so the Featured Match appears earlier in the first viewport, then disabled the remaining header active-indicator pseudo layer to avoid any bottom-line treatment.
4. Audit: `npm run i18n:check` and `npm run build` pass; browser checks show zh-Hant and en Featured Match copy, CTA selects M58, `overflowX: 0`, no raw translation keys, `sparkOrRipple: 0`, and `.command-menu__indicator::before/::after` both report `content: none`.

## Round 142 - Mobile Hero Decision Fit
1. Reworked the mobile Home hero density so the Prize Ladder remains visible as a compact status vault while the full milestone ladder stays available through the dedicated milestone section.
2. Reduced mobile-only hero spacing, hero title scale, milestone vault height, and Campaign Desk minimum height so the Featured Match card and its CTA fit inside the first 390x844 viewport.
3. Raised the mobile Home state dock just enough to leave a next-section hint below the hero without overlapping the Featured Match control or adding any gradient trim treatment.
4. Audit: `npm run i18n:check` and `npm run build` pass; browser checks at 390x844 show Featured Match CTA fully visible, `dockVisiblePixels: 34.4`, `gapFeaturedToDock: 75.8`, `overflowX: 0`, no raw translation keys, and `sparkOrRipple: 0`.

## Round 143 - Vote Pick Decision Lift
1. Moved the country vote cards directly after the selected match header so the actual vote decision appears before secondary match telemetry, instead of being buried below the command plate and status banner.
2. Tightened the vote theater image height and mobile header so the first country pick card is fully visible in the 390x844 first viewport while the second pick starts immediately below.
3. Refined the country pick material into a cleaner glass/metal long-card treatment with solid translucent badges, preserved radio-backed selection, and kept Magnet as the only React Bits interaction layer.
4. Audit: `npm run i18n:check` and `npm run build` pass; browser checks show desktop first pick moved from `y=831` to `y=521`, mobile first pick moved from `y=1187` to `y=746` and is fully visible, M59 locked picks remain disabled, selected pick checks the native radio, `overflowX: 0`, no raw translation keys, and `sparkOrRipple: 0`.

## Round 144 - Bilingual Round Draw Ledger
1. Added a localized per-round draw ledger to the Draw desk so each round now shows its own reset state, official-final count, prize slots, staged entries, estimated chance, and reveal-contract boundary.
2. Hardened the language layer for future locales: language switch aria/title text now comes from locale packs, milestone fallback labels are generated through `useCampaignCopy`, and the Chinese draw copy no longer exposes raw `entries` terminology to users.
3. Removed the remaining header pill pseudo highlight and solidified the active nav material so the language/header controls do not render bottom, top, or side gradient trim lines.
4. Audit: `npm run i18n:check` and `npm run build` pass; browser checks across zh-Hant/en desktop and 390x844 mobile show `rawKeys: []`, `overflowX: 0`, five round draw cards, one active draw round, localized document `lang`/title, and command/header pseudo-elements reporting `content: none`.

## Round 145 - Mobile Command Density Lift
1. Compressed the mobile non-home command mast into shorter glass/metal status chips while preserving the key round, voteable, locked, and draw-entry signals.
2. Reworked the mobile Draw round index into a horizontal pool rail with explicit eligible counts such as `0 符合` and `36 符合`, so users can understand per-round draw state before reaching the full ledger.
3. Kept the interaction treatment restrained: no click sparks, no ripples, no active pill underlines, and no new top, bottom, or side gradient trim lines.
4. Audit: `npm run i18n:check` and `npm run build` pass; browser checks across zh-Hant/en 390x844 show `rawKeys: []`, `overflowX: 0`, `sparkOrRipple: 0`, room mast height reduced from 196px to 158px, Vote first team pick moved from `y=746` to `y=677`, Draw index reduced to 121px, and Draw ledger moved from `y=947` to `y=811`; desktop Schedule/Vote/Draw smoke checks still show `overflowX: 0` and no raw keys.

## Round 146 - Mobile Schedule Decision Fit
1. Reworked the mobile Schedule command board into a compact two-column state strip plus short gate rail, so voteable, closing, locked, final, and pending states fit without clipped English labels.
2. Compressed Schedule match cards on mobile: the two national teams now sit in a 2-column flag card row, match facts use four compact chips, and the CTA is visible inside the first 390x844 viewport.
3. Added localized `matchStatusCompact` and Schedule gate short labels so future languages can control narrow UI copy from locale packs instead of JSX or CSS hacks.
4. Audit: `npm run i18n:check` and `npm run build` pass; browser checks across zh-Hant/en mobile and desktop show `rawKeys: []`, `overflowX: 0`, `sparkOrRipple: 0`, important text overflow `[]`, hidden mobile trim pseudo-elements, and mobile first Schedule card height reduced from ~386-402px to ~254-257px with the action button fully visible.

## Round 147 - Mobile Rules Readability
1. Repaired the mobile Rules room so lifecycle, eligibility, disconnected-boundary, and production-ops body copy is no longer clipped by desktop-oriented line clamps.
2. Compressed the Rules hero into a shorter operating map: metrics now sit in a compact horizontal status rail, bringing the lifecycle cards into the first mobile viewport.
3. Removed the remaining Rules panel bottom `::after` gradient trim lines, keeping the glass/metal surfaces but avoiding the forbidden top/bottom/side accent-line treatment.
4. Audit: `npm run i18n:check` and `npm run build` pass; browser checks across zh-Hant/en 390x844 Rules show `rawKeys: []`, `overflowX: 0`, `sparkOrRipple: 0`, clipped mobile rules text `0`, panel trim pseudo-elements `content: none`, and English Rules hero height reduced from ~453px to ~254px.

## Round 148 - Draw First-Screen Alignment
1. Fixed the mobile command navigation active state by disabling the sliding indicator on narrow viewports and letting the active command button render its own solid glass pill, so Draw no longer looks like Vote is selected.
2. Compressed the mobile Draw hero into a shorter state summary while keeping the round status, prize count, eligible, pending, pool, and chance metrics visible.
3. Pulled the per-round draw ledger into the first mobile viewport so users see the round-reset pool overview immediately after the active draw state, instead of only after a long hero block.
4. Audit: `npm run i18n:check` and `npm run build` pass; browser checks across zh-Hant/en mobile and desktop Draw show `rawKeys: []`, `overflowX: 0`, `sparkOrRipple: 0`, active nav `Draw`, command indicator hidden on mobile with no pseudo trim, English Draw hero reduced from ~333px to ~252px, and the round draw ledger visible in the first 390x844 viewport.

## Round 149 - Home First-Screen Density
1. Compressed the Home mobile hero and campaign desk so the first viewport now shows the hero, active match control card, and the full 2x2 action dock instead of only a thin dock edge.
2. Reworked the campaign desk metrics into four compact columns and tucked the reset lifecycle away on mobile while keeping the complete reset/draw/vote flows available in the dedicated product rooms.
3. Localized the Chinese Home hero and prize ladder labels more fully, including `Renaiss 世界盃預測` and `獎池里程碑`, while shortening the English vote-pool label for tight team cards.
4. Audit: `npm run i18n:check` and `npm run build` pass; browser checks across zh-Hant/en 390x844 and 1280x900 Home show `rawKeyCount: 0`, `overflowX: 0`, `sparkOrRipple: 0`, clipped Home text `[]`, mobile Home hero reduced from ~818-821px to ~622-657px, mobile dock visible height raised from ~31-34px to ~143-168px, and desktop dock hint visible at ~48-58px.

## Round 150 - Locale Boundary and Mobile Vote Shortcut
1. Tightened the i18n boundary for future languages: country `localName`, round display labels, round prizes, window labels, and bundled milestone display copy now resolve from locale packs instead of campaign data fallbacks.
2. Added a compact mobile vote shortcut after a country is selected, with ticket stepper, localized CTA, remaining-ticket preview, and the existing preview-confirm modal path; official wallet vote write and vote-record storage remain intentionally disconnected.
3. Refined Chinese product copy across Home, Schedule, Vote, Draw, Rules, and data-boundary states so core user-facing terms use clear Chinese labels rather than unexplained English operational terms.
4. Removed the active header pill bottom color line and button active press transform to match the no gradient trim / no click feedback constraint.
5. Audit: `npm run i18n:check` and `npm run build` pass; browser checks across zh-Hant/en 390x844 Home/Vote and 1440x920 Home show `rawKeyCount: 0`, `overflowX: 0`, `sparkOrRipple: 0`, localized `html.lang`/title, nav indicator `::before` content `none`, mobile vote tray height `54px`, tray overlap `0px`, clipped mobile tray text `[]`, and tray CTA opens the preview confirm modal.

## Round 151 - Inline Mobile Vote Composer
1. Removed the fixed bottom mobile vote tray and its layout padding so the Vote room no longer relies on a floating overlay after country selection.
2. Added a selected-team inline composer inside the match theater flow on mobile, with ticket stepper, localized preview CTA, remaining-ticket preview, and the same preview-confirm modal path.
3. Kept desktop behavior unchanged: the right-side ticket console remains the primary allocation surface and the inline composer is hidden outside the mobile breakpoint.
4. Tightened narrow English text fit by letting readiness detail text wrap, widening the mobile wallet address slot, and hiding the composer micro-status label at 390px instead of clipping it.
5. Audit: `npm run i18n:check` and `npm run build` pass; browser checks across zh-Hant/en 390x844 Vote show `rawKeyCount: 0`, `overflowX: 0`, `fixedTrayCount: 0`, `clickSparkOrRippleCount: 0`, clipped text `[]`, inline composer visible, and composer CTA opens the preview confirm modal. Desktop 1440x920 Vote shows the composer `display: none`, ticket console visible, `overflowX: 0`, no raw keys, and no fixed tray.

## Round 152 - Hero Glass Restraint
1. Reduced the Home hero command card's `BorderGlow` fill and radius so the control surface no longer reads as a large yellow-green bottom glow on desktop or mobile.
2. Reworked the hero command card material into quieter transparent glass with solid metal borders, a low-opacity neutral edge light, and no big decorative radial glow.
3. Fixed header wallet fit across breakpoints: desktop now has enough width for the compact address plus ticket count, while mobile keeps the language switch and wallet pill separated with `0px` overlap.
4. Let desktop match-row country names wrap to two lines, removing the visible truncation for longer localized country names such as `沙烏地阿拉伯`.
5. Audit: `npm run i18n:check` and `npm run build` pass; browser checks for zh-Hant Home at 390x844 and 1440x920 plus desktop Vote show `rawKeyCount: 0`, `overflowX: 0`, `clickSparkOrRippleCount: 0`, `fixedTrayCount: 0`, clipped text `[]`, mobile header language/wallet overlap `0px`, and hero command card glow reduced to `opacity: 0.035` with a `blur(12px)` filter.

## Round 153 - Semantic Rules Room
1. Replaced the Rules hero metrics and per-round rule stats with semantic `section`/`article` metric groups instead of `dl > div` wrappers.
2. Updated the Rules stat CSS hooks to named `.rules-hero__metric` and `.round-rule-card__stat` selectors so the structure is easier to maintain and does not depend on generic wrappers.
3. Let Rules stat values wrap naturally, fixing the desktop clipped draw-state label while preserving the compact mobile metric rail.
4. Audit: source checks show `RulesRoom.jsx` has `0` `<div>` tokens; `npm run i18n:check` and `npm run build` pass; browser checks across Rules desktop/mobile show `overflowX: 0`, `clickSparkOrRippleCount: 0`, and clipped text `[]`.

## Round 154 - Bracket Schedule And Active-Round Vote Desk
1. Converted the header language control from a two-button segmented toggle into a localized native dropdown, keeping the language layer ready for additional locale packs.
2. Rebuilt Schedule as a knockout bracket board with left/right country cards, central trophy, active-round state counts, advancing/allocated/eliminated/voteable states, and a 16-to-8 default simulation.
3. Rebuilt Vote as a concise active-round vote desk: current-round match rail, two large country vote cards, compact ticket composer, and wallet/allocation side panel, with locked and non-open windows clearly disabled.
4. Removed the shared room mast from Schedule and Vote so those pages open directly into the bracket or vote desk instead of burying the primary workflow under repeated summary cards.
5. Reduced generic markup in the work pages: `ScheduleRoom.jsx`, `VoteRoom.jsx`, and `RulesRoom.jsx` each report `0` `<div>` tokens.
6. Audit: `npm run i18n:check` and `npm run build` pass; Playwright checks across zh-Hant/en desktop and 390x844 mobile show `overflowX: 0`, `clickSpark: 0`, one language dropdown, Schedule/Vote DOM `div` count `0`, clipped text `[]`, and Schedule first match M73 visible in the bracket.

## Round 155 - Timeline Schedule And Single Milestone
1. Removed the duplicate Home Milestone table/rail and kept Milestone as one hero-level module instead of repeating the same ladder lower on the page.
2. Rebuilt Schedule into a timeline theater with central trophy, active match plates, state counts, next cutoff, and a horizontal match timeline that still follows the current per-round/per-match voting model.
3. Updated Vote allocation summaries to show match IDs and matchups, so preview allocations read as match decisions instead of anonymous country picks.
4. Renamed user-facing Price Ladder copy to Milestone in zh-Hant and en locale packs.
5. Audit: `npm run i18n:check` and `npm run build` pass; Playwright checks show `rawKeys: []`, `overflowX: 0`, `clickSpark: 0`, `homeDashboard: 0`, `milestoneRail: 0`, Schedule timeline items `8`, and Vote preview rows include `M74` / `M76` matchups.

## Round 156 - Sparse Premium Pass
1. Removed the Home wallet/KPI dashboard from the first screen so the page now focuses on hero, Milestone, featured match, and three lightweight action signals.
2. Converted the non-home round switch from boxed cards into a sparse timeline control with no active underline or decorative gradient trim.
3. Reworked the Vote match rail so each row prioritizes match number, matchup, state, venue, and cutoff before the country vote cards.
4. Relaxed mobile and bilingual text wrapping for round labels and allocation preview rows, including English wallet-preview copy.
5. Audit: `npm run i18n:check` and `npm run build` pass; final Playwright checks show `overflowX: 0`, `rawKeys: []`, `clickSpark: 0`, `homeDashboard: 0`, `milestoneRail: 0`, round-switch `::before` display `none`, and clipped text `[]` on the checked Home/Schedule/Vote desktop and mobile paths.

## Round 157 - Open Stage Rail
1. Replaced the round switch controls with an open stage rail inspired by the provided reference: stage label, large match count, concise state text, and a solid/dashed hairline progress mark.
2. Removed the remaining visual affordance of boxed stage controls: round buttons now report no border, no radius, transparent background, and no pseudo underline.
3. Added localized `roundRail` copy for stage units, remaining tickets, eligible entries, lost entries, and previewed entries so the rail stays language-module driven.
4. Added an ad-hoc memory note for the user's strong preference against card/panel/tile/boxed-container stacks in future frontend work.
5. Audit: `npm run i18n:check` and `npm run build` pass; Playwright checks across zh-Hant Schedule/Vote desktop and en Schedule mobile show `overflowX: 0`, `rawKeys: []`, `clickSpark: 0`, round rail button `border: none`, `radius: 0px`, transparent background, solid active line, dashed future lines, and clipped text `[]`.

## Round 158 - Open Vote Pitch
1. Removed the three large boxed Vote surfaces around the match list, central vote desk, and wallet preview; each outer section now reports no border, no radius, transparent background, and no shadow.
2. Reworked the match list into an open rail with separators instead of rounded match cards; selected state is carried by typography and a solid separator, not a filled card.
3. Kept the country vote buttons as intentional interactive targets while opening the surrounding pitch with the existing grid field background and wider editorial hierarchy.
4. Fixed the Vote heading scale and match-row layout so Chinese desktop and English mobile no longer clip or force long status labels into vertical text.
5. Audit: `npm run build` passes; Playwright checks on zh-Hant desktop and en mobile Vote show `overflowX: 0`, `rawKeys: []`, `clickSpark: 0`, outer Vote panels `border: none`, `radius: 0px`, transparent background, no shadow, match rows `radius: 0px`, and clipped text `[]`.
