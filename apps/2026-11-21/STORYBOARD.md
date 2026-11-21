# Ridgeprint: Storyboard

**Story.** Priya is designing a poster for a trail-running club and wants topographic lines behind the headline. The stock files she finds are blurry JPEGs in the wrong brown, and tracing one by hand would take an afternoon. She opens Ridgeprint and a warm survey-paper mountain range is already on screen. She shuffles the seed until the ridges feel right, drags a brush to push a peak up exactly where the logo will sit, switches to the club's navy-and-coral palette and exports an SVG. In Illustrator every contour is one clean path per level. She feels like she made a map, not downloaded one.

## Frames

| # | Screen (what the user sees) | User action | What happens / why it matters |
|---|---|---|---|
| 1 | A full survey-style topographic map (cream paper, brown ink, heavier index lines) fills the stage; side panel with sliders; stats show levels, paths and points | Opens the page | Impressive with zero input: it already looks like a finished print |
| 2 | Terrain reshapes instantly; seed number changes | Presses Shuffle seed or drags Scale / Detail / Ridge | Live, reproducible exploration: every seed is a new landscape |
| 3 | A soft brush ring follows the cursor; elevation readout shows height and contour number | Hovers the map | The user understands the map is real data they can read |
| 4 | Contours swell into a new peak (or sink into a valley) under the pointer | Drags with Raise or Carve | Direct sculpting: the user places hills where their layout needs them; Undo reverts a stroke |
| 5 | Map turns navy with pale lines, or into filled elevation bands from deep to bright | Picks a palette, toggles Filled bands, edits colours | Brand-matching in seconds, both line art and banded styles |
| 6 | Frame changes to 1:1, 4:5 or 9:16 and the terrain refits | Picks an aspect | Output matches the poster, post or story it is for |
| 7 | Toast "SVG saved: 38 paths, 112 KB"; file downloads | Presses Export SVG / PNG / Copy CSS / Copy link | Aha: a clean, layered vector file or a shareable link that rebuilds the exact design |

## Main screen wireframe

```
+--------------------------------------------------------------------------+
| RIDGEPRINT  sculpt a terrain...      [Copy link][Copy CSS][PNG][Export SVG]|
+-----------------------------------------------------+--------------------+
|                                                     | TERRAIN            |
|   +---------------------------------------------+   | Seed [1234][Shuffle]|
|   |                                             |   | Scale  ------o---  |
|   |     CANVAS: contour map (aspect frame)      |   | Detail ----o-----  |
|   |        ((( brush ring )))                   |   | Ridge  --o-------  |
|   |                                             |   | CONTOURS           |
|   +---------------------------------------------+   | Levels / Weight    |
|   Elev 1,480 m · contour 14     38 paths · 9.2k pts | Index [off 4 5 10] |
|                                                     | [x] Filled bands   |
|                                                     | COLOUR swatches x6 |
|                                                     | paper ink low high |
|                                                     | SCULPT Raise|Carve |
|                                                     | Size  Strength     |
|                                                     | [Undo] [Flatten]   |
|                                                     | FRAME 16:9 1:1 ... |
+-----------------------------------------------------+--------------------+
```
At 360px the panel stacks below the stage; the stage spans full width at the chosen aspect and the export buttons wrap into a two-column grid.

## Visual direction

UI: graphite `#12110e` background, panel `#1c1a16`, border `#2e2a22`, text `#efe9dc`, muted `#a89f8d`, amber accent `#e8a23a`, focus ring `#ffd27a`. Map palettes: Survey (`#f2ead8` paper, `#7a5a2f` ink), Blueprint (`#0e2a4a` / `#cfe3ff`), Nightglow (`#0a0e16` / `#73f0c4`), Ember bands (`#24103f` to `#ff9a5c`), Moss (`#16241a` / `#c6e59a`), Ink (`#fbfbf8` / `#141414`). Typography: system UI sans for controls, `ui-serif`/Georgia for the wordmark, tabular numbers for stats. Motion: no gratuitous animation; terrain redraws in the same frame a slider moves, optional slow Drift mode pans the noise; brush ring scales with size; toasts slide up. `prefers-reduced-motion` disables drift and toast motion.

## Data and logic

State: `{seed, scale, detail, ridge, sharp, levels, weight, index, fill, smooth, palette, colors:{paper,ink,low,high}, aspect, tool, size, strength, strokes:[[{x,y,r,a}]], drift}`; brush dabs are stored in normalised 0..1 coordinates so they survive aspect changes.
Key functions: `buildField()` makes a padded height grid; `traceLevel(field, level)` runs marching squares; `stitch()` joins segments into rings; `chaikin()` smooths; `render()` draws to canvas; `toSVG()` serialises; `encodeState()/decodeState()` for links and storage.
Technique: heights come from fractal value noise (seeded mulberry32 hash per lattice point, smoothstep interpolation, octaves halving in amplitude), blended toward ridged noise and raised to a sharpness power, plus Gaussian bumps from brush dabs. The grid gets a one-cell border of -1 outside the visible frame so every contour closes into a ring. Marching squares indexes each cell by which corners are above the level, interpolates the crossing point on each edge, and resolves the two saddle cases using the cell-centre average. Segments are keyed by the grid edge they cross, so stitching is an exact lookup: walk from edge to edge until the ring closes. Filled bands paint each level's rings with the even-odd rule in ascending order, so depressions stay as holes.

## Edge cases

- Empty input: there is no empty state; the map always has a terrain. Flatten removes all sculpting; levels have a minimum of 4.
- Huge input: brush dabs are capped (2,000) with a toast; grid size is fixed so render time stays bounded; CSS export warns when the data URI is large.
- Invalid input: seed field accepts only integers 0..999999 and falls back to the previous value; a corrupt share link or storage value is ignored and defaults load.
- Reset: Reset design restores defaults (with the seed kept) and clears strokes; Undo reverts the last stroke (also Ctrl/Cmd+Z).
- Mobile: pointer events for touch painting; the canvas uses `touch-action: none` only while a sculpt tool is active, and a "Look" tool lets the page scroll normally.
- Keyboard-only: every control is a native input/button with a label and visible focus; Shuffle, Undo, exports and palettes are buttons; R/C/L switch tools when the map has focus, and arrow keys move a keyboard brush that Enter applies.

## Definition of done

- [ ] First load renders a complete, attractive contour map with index lines and no interaction
- [ ] Seed, scale, detail, ridge, sharpness, levels, weight, index and smoothing all update the map live
- [ ] Raise and Carve painting works with mouse and touch; Undo, Flatten and Reset work
- [ ] Six palettes, four colour pickers and Filled bands mode work
- [ ] Aspect presets 16:9, 1:1, 4:5, 9:16 refit the frame
- [ ] Export SVG (grouped, one path per level), PNG at 2x, Copy CSS and Copy link all work, with toasts
- [ ] Share link and localStorage restore the exact design; corrupt data is ignored
- [ ] Elevation readout on hover; stats show paths and points
- [ ] No horizontal scroll at 360px, no console errors, visible focus states
