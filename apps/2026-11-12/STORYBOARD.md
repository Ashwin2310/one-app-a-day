# Hazeloom: Storyboard

**Story.** Maya is a front-end developer shipping a landing page tonight. The hero needs a soft, colourful background, the kind every modern product site has, but CSS has no mesh gradient and her last attempt at stacking radial-gradients came out muddy grey in the middle. She opens Hazeloom and a vivid gradient is already on screen. She drags two points, shuffles the palette once, turns on grain, checks that her white headline passes contrast, and copies the CSS straight into her stylesheet. Two minutes, no design tool, and it looks expensive.

## Frames

| # | Screen (what the user sees) | User action | What happens / why it matters |
|---|---|---|---|
| 1 | Full-bleed "Aurora" mesh gradient with five glowing colour handles, a sample headline floating on it, control panel on the right | Opens the page | Impressive in under a second: a finished, beautiful gradient is the demo |
| 2 | Same canvas, one handle highlighted with its colour swatch and spread slider in the panel | Drags a handle across the canvas | Blend follows the pointer live at 60 fps; OKLab keeps the midpoints vivid |
| 3 | Canvas with a new point at the double-click spot | Double-clicks the canvas (or presses "Add point") | A sixth colour joins the mesh; picks a harmonious colour automatically |
| 4 | New palette and layout | Presses "Shuffle" or a preset chip | Instant exploration; every result is attractive because hues are drawn from harmonic rules |
| 5 | Swirled, grainy gradient in 9:16 frame | Moves Swirl and Grain sliders, chooses "Story 9:16" | Organic liquid shapes, banding hidden; the frame resizes for the target platform |
| 6 | Headline overlay with badge "AA 6.2:1 · white text" | Toggles headline preview | Hazeloom samples the gradient under the text and picks the readable colour |
| 7 | Toast "CSS copied" and code box with layered radial-gradients | Clicks "Copy CSS" / "PNG" / "SVG" | The aha: the exact background is in the clipboard or downloaded, ready to ship |

## Main screen wireframe

```
+--------------------------------------------------------------------------+
| ◐ Hazeloom   mesh gradient studio                  [Animate] [Shuffle]   |
+-----------------------------------------------------+--------------------+
|                                                     | PRESETS            |
|      ●                                              | (chip)(chip)(chip) |
|               Make it glow.            ●            | FRAME 16:9 1:1 ... |
|                                                     | POINTS  ● ● ● ● ●  |
|          ●                    ●                     |  colour [#ff6a88]  |
|                                     ●               |  spread  ───●──    |
|                                                     | Softness ───●──    |
|   [AA 6.2:1 · white]                                | Swirl    ─●────    |
|                                                     | Grain    ──●───    |
+-----------------------------------------------------+ [x] Headline       |
|  drag points · double-click to add · arrows move    | EXPORT             |
|                                                     | [Copy CSS][SVG][PNG]|
|                                                     | <css code box>     |
+-----------------------------------------------------+--------------------+
```

At 360px the panel stacks under the canvas, the canvas fills the width at the chosen ratio, and chip rows wrap.

## Visual direction

- Palette: ink background `#0d0e14`, panel `#151722`, raised `#1d2030`, border `#2a2e42`, text `#eef0f8`, muted `#9aa0b8`, accent `#b8a4ff`, success `#5ee6a8`, danger `#ff7a8a`.
- Typography: system UI stack (`ui-sans-serif, system-ui, -apple-system, Segoe UI`) for UI; `ui-monospace, SFMono-Regular, Menlo` for code and values. Headline preview uses heavy weight 800, tight tracking.
- Motion: handles scale and glow on hover/drag; slider changes re-render instantly; drift animation moves points on slow Lissajous paths; toasts slide up. Respect `prefers-reduced-motion` (animation off by default).
- Feel: a dark, calm studio where the gradient is the only loud thing on screen.

## Data and logic

- State: `{ points: [{id, x, y, color, spread}], softness, swirl, grain, ratio, headline, selectedId, seed }`, x/y in 0..1. State is replaced, never mutated (`update(state, patch)` returns a new object), and saved to localStorage.
- Key functions: `renderField(state, w, h, time)` → ImageData; `blendOklab(weights, labs)`; `paint()` draws field + grain to the visible canvas; `exportPNG(width)`; `buildCSS(state)`; `buildSVG(state)`; `measureContrast()`; `randomPalette(seed)`.
- Technique: for each pixel, optionally warp the coordinate with `x += swirl·sin(y·k + t)`, compute weight `w_i = 1 / (d_i²/spread_i² + ε)^softness`, normalise, mix the points' OKLab coordinates, convert back to sRGB. Rendered at ~240 px wide, upscaled with smoothing. Grain is a seeded noise tile composited with `overlay`. Contrast: sample average luminance under the headline box, compare white vs near-black using WCAG 2.x relative luminance.

## Edge cases

- Empty input: minimum two points enforced; deleting the last two is blocked with a toast.
- Huge input: maximum 10 points; "Add" disables at the cap. PNG export capped at 3840 px.
- Invalid input: bad localStorage JSON falls back to the default preset; colours are validated as `#rrggbb`.
- Reset: "Reset" restores the Aurora preset.
- Mobile: touch dragging via pointer events with `touch-action: none` on the canvas only; panel stacks below; no horizontal scroll at 360px.
- Keyboard-only: handles are buttons; Tab to focus, arrows move (Shift = bigger step), Delete removes, Enter selects. All controls have labels and visible focus rings.

## Definition of done

- [ ] First load shows a vivid gradient with handles and headline, no blank states
- [ ] Dragging, adding (double-click and button), deleting and recolouring points all work
- [ ] Presets, Shuffle, Reset, Animate work
- [ ] Softness, Swirl, Grain and spread sliders update live
- [ ] Aspect ratio chips resize the frame
- [ ] Headline toggle with correct contrast badge and auto text colour
- [ ] Copy CSS, download SVG and PNG all work; CSS is shown in a code box
- [ ] State persists across reloads
- [ ] Keyboard operable with visible focus; reduced motion respected
- [ ] No horizontal scroll at 360px; `publish.py check` prints CHECK OK with no warnings
