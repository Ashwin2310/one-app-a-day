# Huestair: Storyboard

**Story.** Priya is a front-end developer setting up the theme for a new product. Marketing has handed her one hex code, `#5B5BD6`, and she needs 50 to 950 shades of it, a neutral grey that does not look dead next to it, and status colours for alerts. Her last attempt, lightening and darkening in HSL, produced a murky 800, a 300 that looked identical to the 200, and button text that failed contrast in review. She opens Huestair, pastes the hex, flips the curve to contrast-even, sees every ramp and a real UI rebuild instantly, checks which pairs pass AA in the matrix, and copies a Tailwind block. Ten minutes of guessing becomes one confident paste.

## Frames

| # | Screen (what the user sees) | User action | What happens / why it matters |
|---|---|---|---|
| 1 | First load: six full-width colour ramps (brand indigo, accent, neutral, success, warning, danger), a lightness and chroma chart, a light and dark UI preview and a contrast matrix, all filled from a sample brand | Looks | Impressive immediately, and proves the idea: one colour became a whole system |
| 2 | Left panel: Brand hex field with colour picker, harmony select, curve select and sliders | Pastes `#0F9D8A` into Brand | Every ramp, the chart, the matrix and the preview rebuild live in under a frame |
| 3 | Curve segmented control: Linear / Eased / Contrast-even | Chooses Contrast-even | Lightness steps re-space; the chart's L line bends and the neighbour-contrast readout becomes constant (e.g. 1.36 : 1 everywhere) |
| 4 | A swatch is clicked; the inspector bar shows hex, OKLCH, RGB, contrast on white and black with AA/AAA badges | Clicks brand 600, presses Copy hex | Value copied with a toast; arrow keys move to neighbouring swatches |
| 5 | Contrast matrix for the chosen ramp: every step against every step, cells showing "Aa" in the foreground step on the background step, with ratio and pass marks | Switches the matrix ramp to Neutral | Instantly see which text and surface pairs are safe |
| 6 | UI preview with Light / Dark toggle: a card, buttons, a badge, an input and three alerts, all coloured only by the palette | Toggles Dark | Confirms the palette works on both themes before writing any code |
| 7 | Export dialog with tabs CSS / Tailwind / Tokens JSON / SVG, hex or oklch option, Copy and Download buttons | Opens Export, picks Tailwind, copies | Success moment: a ready block for the project, matching exactly what was on screen |

## Main screen wireframe

```
+--------------------------------------------------------------------------------------+
| HUESTAIR  one colour -> an accessible palette        [Surprise] [Share link] [Export] |
+----------------------+---------------------------------------------------------------+
| BRAND  [#] [5B5BD6 ] | brand    |50|100|200|300|400|500|600|700|800|900|950|  [x]    |
| Harmony [Complement] | accent   |  |   |   |   |   |   |   |   |   |   |   |         |
| CURVE [Lin|Ease|Even]| neutral  |  |   |   |   |   |   |   |   |   |   |   |         |
| Lightest  ----o---   | success  |  |   |   |   |   |   |   |   |   |   |   |         |
| Darkest   --o-----   | warning  |  |   |   |   |   |   |   |   |   |   |   |         |
| Chroma    -----o--   | danger   |  |   |   |   |   |   |   |   |   |   |   |  [+ ramp]|
| Hue drift ---o----   |---------------------------------------------------------------|
| Neutral tint --o---  | Inspector: brand-600  #4646C4  oklch(...)  5.9:1 AA [Copy]    |
| [x] Pin base colour  |---------------------------------------------------------------|
|                      | L / C chart (SVG)          | Preview  [Light|Dark]            |
| Ramps list           |  L line + C per ramp       |  card, buttons, input, alerts    |
|  name  hex  role [x] |----------------------------+----------------------------------|
|                      | Contrast matrix [ramp v]  11x11 cells "Aa 4.6"               |
+----------------------+---------------------------------------------------------------+
```

At 360px the controls panel stacks above the ramps, swatch labels shrink to the step number only, the chart, preview and matrix stack in one column, and the matrix scrolls sideways inside its own box so the page never scrolls horizontally.

## Visual direction

- **Palette (chrome):** ink background `#0D0E12`, surface `#15171D`, raised `#1C1F27`, line `#2A2E38`, text `#ECEEF3`, muted `#9AA0AE`, focus ring `#8EA2FF`. Accent elements (primary button, active segment) use the generated brand 400/500 so the tool itself takes on the user's colour.
- **Typography:** system UI stack (`system-ui, -apple-system, Segoe UI, Roboto, sans-serif`) for interface text; `ui-monospace, SFMono-Regular, Menlo, Consolas` for hex codes and ratios. Tight letter-spacing on the wordmark.
- **Motion and feel:** calm and precise. Swatches fade colour with a 160 ms background transition; the selected swatch lifts with a ring; toasts slide up for 1.6 s. Respects `prefers-reduced-motion`. The ramps are the hero: large, edge-to-edge, with small labels that switch between dark and light text based on contrast.

## Data and logic

State (saved to localStorage and the URL hash):

```
{ brand: '#5b5bd6', harmony: 'analogous', curve: 'even', lightest: 0.975, darkest: 0.2,
  chroma: 1, drift: 6, tint: 0.012, pin: true, previewDark: false, matrixRamp: 'brand',
  format: 'hex', extras: [{name, hex}], selected: {ramp, step} }
```

Key functions:

- `hexToOklch`, `oklchToRgb`, `inGamut`, `toGamut` (binary search on chroma), `rgbToHex`.
- `lightnessTargets(curve, lightest, darkest)` returns 11 L values. Contrast-even converts the two end lightnesses to luminance (`Y = L^3` for an achromatic OKLab colour), spaces `Y + 0.05` geometrically, and converts back with a cube root.
- `buildRamp(def, opts)` returns 11 steps `{step, hex, l, c, h, clipped, isBase}`; chroma uses a bell curve peaking at the base's nearest step; hue drifts linearly across it.
- `deriveRamps(state)` creates brand, harmony accent (complement / analogous / triadic / split rotate the hue), neutral (brand hue, chroma capped at `tint`), success, warning, danger (fixed hues, lightness and chroma matched to the brand), plus user extras.
- `contrast(hexA, hexB)` is the WCAG 2 ratio from relative luminance.
- Renderers: `renderRamps`, `renderInspector`, `renderChart`, `renderMatrix`, `renderPreview`, `renderExport`; all read the same computed palette.

## Edge cases

- **Empty or invalid hex:** the field is marked invalid with a message and the last good palette stays; 3-digit hex is expanded; `#` is optional.
- **Extreme colours:** pure black, white or greys have no hue; chroma 0 is handled and the hue falls back to 0 so ramps are clean greys. Very saturated colours are gamut-mapped and the swatch shows a small "mapped" dot.
- **Huge input:** extra ramps are capped at 6 and names at 16 characters, sanitised to `a-z0-9-` for export keys; duplicate names get a suffix.
- **Lightest below darkest:** sliders are clamped so lightest is always at least 0.2 above darkest.
- **Reset:** a Reset button restores defaults and clears storage; a corrupted hash or storage value falls back to defaults.
- **Mobile:** single column, no horizontal page scroll, matrix scrolls in its own container, tap targets at least 32 px.
- **Keyboard-only:** every control is a native input or button; swatches are a grid with arrow-key movement; Enter copies; the export dialog traps focus via `<dialog>` and closes on Escape; visible focus rings everywhere.
- **Clipboard blocked:** falls back to selecting a hidden textarea and `execCommand('copy')`, and says so if both fail.

## Definition of done

- [ ] First load shows six populated ramps, chart, preview and matrix with no interaction.
- [ ] Changing the brand hex or any slider rebuilds every view.
- [ ] Linear, Eased and Contrast-even curves all work; contrast-even gives a constant neighbour ratio readout.
- [ ] Pin base colour makes the exact brand hex appear in the brand ramp.
- [ ] All shades are inside sRGB; mapped shades are marked.
- [ ] Inspector shows hex, OKLCH, RGB and contrast on white and black with AA/AAA badges, and copies.
- [ ] Arrow keys move the swatch selection; Enter copies.
- [ ] Contrast matrix switches ramps and marks AA / AAA.
- [ ] Light and dark preview use only palette colours.
- [ ] Export CSS (hex and oklch), Tailwind, tokens JSON and SVG all copy and download.
- [ ] Add, rename and remove custom ramps; Surprise me; Share link; Reset; state persists on reload.
- [ ] Invalid hex is rejected gracefully.
- [ ] No horizontal scroll at 360 px; no console errors; no network requests.
