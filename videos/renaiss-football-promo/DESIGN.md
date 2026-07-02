# Design System

## Overview

Renaiss World Cup is a dark cinematic sports-luxury experience built around the actual website flow: home, schedule, vote, draw, winners, and prize reveal. The page uses captured product screens, restrained black surfaces, gold data highlights, and small prism accents rather than bright solid panels. Layout is editorial and asymmetric: large contextual type, real site plates, then process overlays that explain how to participate and how winners are revealed. The motion language should feel like a premium product film, not a dashboard demo or a stretched hero loop.

## Colors

- **Primary Canvas**: `#080908` - deep black-green base used across the site.
- **Canvas Deep**: `#050606` - near-black for vignettes and fade-to-black moments.
- **Primary Ink**: `#F5F6F1` - warm off-white for major text.
- **Gold Highlight**: `#F0D18B` - premium prize, milestone, and number highlight.
- **Gold Base**: `#C9A05A` - secondary metallic linework and icon tone.
- **Mint Prism**: `#4FF0C5` - narrow progress and energy accent.
- **Rose Prism**: `#FF5FA2` - tiny chromatic glint only, never dominant.
- **Amber Prism**: `#F8C763` - supporting light streak accent.
- **Violet Prism**: `#9574FF` - secondary prism glint only.
- **Chrome Border**: `#D6D8D2` - soft silver for thin rules and hardware edges.

## Typography

- **Display/Body**: `RenaissDisplay` (embedded from local SFNS source). Heavy weights 760-940 for hero titles and score/prize figures; lighter weights for compact support copy.
- **Mono/Data**: `RenaissMono` (embedded from local SFNSMono source). Heavy weights 860-950 for numeric readouts, small labels, and milestone values.
- **Hierarchy**: hero type can reach 110-140px; scene headlines should sit between 70-104px; body text stays 24px+ for encoded readability; labels stay 17px+.

## Elevation

Depth comes from black glass panels, subtle chrome hairlines, inner highlights, and localized gold/blue bloom. Avoid heavy drop shadows and generic gray borders. Use nested bevels sparingly for prize and ticket surfaces, with large dark negative space around them so the UI feels machined rather than card-heavy.

## Components

- **Cinematic Trophy Field**: real captured home screen or trophy/prize media, used as open and close texture rather than the whole video.
- **Floating Glass Navigation**: pill-shaped command bar with dark translucent fill and chrome/gold accents.
- **Milestone Rail**: slim horizontal progress line with prism start glow, gold thresholds, and oversized ticket count.
- **Prize Readout Strip**: compact rounded stat panels showing round, per-match prize, match count, pool total, and winner slots.
- **Process Rail**: seven-step flow with icon medallions, thin arrows, and restrained glass cells.
- **Renaiss Logo Mark**: colorful vertical mark paired with sober white wordmark; use first and last beat.

## Do's and Don'ts

### Do's

- Use the real captured site views and real Renaiss logo in the first and last beat.
- Keep the palette mostly `#080908`, `#050606`, `#F5F6F1`, and `#F0D18B`; prism colors are narrow glints only.
- Use large numeric typography for real configured round values such as `五輪`, `16`, `US$1,500`, `US$2,500`, and `1 winner`.
- Let scenes breathe with slow camera motion, vignettes, and precise line animation.
- Treat glass panels like premium hardware: thin edge, inner highlight, controlled blur.
- If showing a winner board while production winners are pending, label it as a demo reveal.

### Don'ts

- Do not build a generic bento/card stack; avoid making every beat a framed panel.
- Do not use AI-looking purple gradient edges or loud neon halos.
- Do not overuse lucide icons as the hero visual; icons stay secondary.
- Do not use beige/gold luxury cliches as a whole background; the brand is dark chrome and trophy light.
- Do not fake live mechanics; use captured numbers and label anything fallback-derived.
- Do not imply a second card prize; the current winners page prize is `2014 日本隊皮卡丘 PSA 10`.
