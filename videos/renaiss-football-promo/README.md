# Renaiss Football Promo

28-second HyperFrames product promo for the Renaiss World Cup activity site.

## Files

- `index.html` is the HyperFrames entry file. The timeline is inlined because HyperFrames Studio's static guard requires the `window.__timelines` registration in the entry HTML.
- `styles.css` holds the visual system and scene layout.
- `timeline.js` is the readable source copy of the timeline. If it changes, inline it back into `index.html` with esbuild before validating.
- `narration-final.txt` and `narration-final.m4a` hold the final Traditional Chinese voiceover source and rendered narration.
- `assets/site-views/` contains the captured website screens used as video plates.
- `assets/crops/` contains focused product crops derived from the captured screens. Use these for schedule, vote, draw, prize, and winner detail shots instead of placing full-page captures where unrelated UI would appear.
- `assets/winner-reveal-keyed.mp4` is the render-safe reveal asset re-encoded from `assets/winner-reveal.mp4` at 30fps with regular keyframes.

## Validation

Run from this directory:

```sh
pnpm dlx hyperframes lint .
pnpm dlx hyperframes inspect . --samples 24
pnpm dlx hyperframes validate . --timeout 60000
pnpm dlx hyperframes snapshot . --at 1.5,5.5,10.5,15.5,20.5,25.5 --timeout 30000 --describe false
pnpm dlx hyperframes render --output renders/renaiss-football-promo.mp4 --quality standard
```
