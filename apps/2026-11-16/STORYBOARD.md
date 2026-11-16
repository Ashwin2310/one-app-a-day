# Beatfield: Storyboard

## Story
Maya needs a cover image for a poster and wants something more alive than a flat gradient. She has seen moiré art but cannot hand-draw it. She opens Beatfield, sees glowing rings already drifting against each other, and within seconds she is dragging sliders and watching bands swing. She leaves with a crisp SVG that looks designed, and a link to the exact look.

## Frames
| # | Screen (what the user sees) | User action | What happens / why it matters |
|---|---|---|---|
| 1 | Square canvas animating the Halo preset beside a control panel | Open the page | Impressive within seconds, with no setup |
| 2 | Preset chips above the panel | Click "Weave" | Whole design swaps, showing the range |
| 3 | Layer tabs 1, 2, 3 with sliders | Drag Angle on layer 2 | Interference bands swing from a one-degree change: the aha |
| 4 | Pattern select, colour, thickness | Switch layer 3 to Dots and recolour | Layers are fully independent |
| 5 | Blend and background controls | Pick "Difference" | Colours invert where layers overlap |
| 6 | Randomise and Undo buttons | Click Randomise, then Undo | Safe exploration |
| 7 | Export buttons | Click Export SVG / PNG / Copy link | File downloads, link copied, toast confirms |

## Main screen wireframe
```
+----------------------------------------------------------+
| Beatfield   moire studio        [Randomise][Undo][Pause] |
+--------------------------+-------------------------------+
|                          | Presets: Halo Fabric Weave... |
|        CANVAS            | [Layer 1][Layer 2][Layer 3]   |
|        (square)          | Pattern / Colour / On         |
|                          | Spacing ----o----             |
|                          | Angle   --o------             |
|                          | ...sliders...                 |
|                          | Blend / Background            |
|                          | [SVG] [PNG] [Copy link] [Reset]|
+--------------------------+-------------------------------+
```
At 360px the canvas sits on top at full width and the panel flows beneath it in one column.

## Visual direction
- Palette: background #0a0c14, panel #12151f, text #e8ecf6, accent #7cf3d0, layer colours #ff5d8f, #5de1ff, #ffd36b.
- Type: system UI stack, tight uppercase labels, tabular numbers for readouts.
- Motion: slow continuous drift, soft toast fades. Feel is a dark instrument panel with glowing art.

## Data and logic
State: `{bg, blend, playing, layers:[{on,type,color,spacing,angle,thick,wave,ox,oy,drift}]}`.
`layerPath(layer)` returns one SVG path string for the pattern in local space. Canvas draws it with Path2D after rotate(angle) then translate(ox,oy); SVG export writes the same path inside a transformed group with mix-blend-mode. Drift adds degrees per second to the angle. State is saved in the URL hash as base64 JSON and clamped on load.

## Edge cases
- Invalid or tampered hash: ignored, default preset used.
- Very small spacing: clamped to a minimum, dots/grids have a larger minimum to protect performance.
- All layers off: background only, with a hint message.
- Reduced motion: starts paused.
- Resize and high DPI: canvas resizes via ResizeObserver.
- Keyboard: every control is native, Space toggles play, R randomises when no field is focused.
- Clipboard blocked: falls back to showing the link in the toast.

## Definition of done
- [ ] First load shows an animated design
- [ ] Six presets work
- [ ] Every slider updates the canvas live
- [ ] Layers can be toggled and changed to any of five patterns
- [ ] Randomise and Undo work
- [ ] SVG and PNG export download valid files
- [ ] Copy link restores the same design when opened
- [ ] No horizontal scroll at 360px
- [ ] No console errors or network requests
