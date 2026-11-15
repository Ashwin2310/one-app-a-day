# Kerfwise: Storyboard

**Story.** Maya is building three kitchen base cabinets this weekend. She has a cut list of 34 parts on a
notepad and is standing in the timber yard trying to decide whether to buy three sheets of 18 mm birch
plywood or four, at 62 a sheet. Sketching rectangles on paper is slow, forgets the 3 mm the blade eats on
every cut, and produces layouts she cannot actually saw. She opens Kerfwise on her phone, sees her parts
packed onto sheets, learns that three sheets is the proven minimum, and walks to the saw with a numbered
list of cuts. She feels certain instead of hopeful.

## Frames

| # | Screen (what the user sees) | User action | What happens / why it matters |
|---|---|---|---|
| 1 | First load: sample kitchen job in the left panel, sheet diagrams on the right rearranging as the search runs, stats counting up | None | Within a second the layout settles. The app proves itself before the user types anything. |
| 2 | Stat row: sheets used with a "minimum possible" badge, yield, waste, cost, largest offcut | Reads | Answers the buying question (how many sheets, how much money) immediately. |
| 3 | Stock card: sheet length, width, kerf, edge trim, price | Changes kerf 3 to 10 | Layout re-solves after a short debounce; yield drops. Shows the blade width is really modelled. |
| 4 | Parts table: label, length, width, qty, rotate, delete | Unticks Rotate on a part | Those parts keep their grain direction; diagrams update. Hovering a row highlights its pieces. |
| 5 | Bulk paste box | Pastes "Shelf, 800, 300, 4" lines, presses Add parts | Rows are appended, bad lines are counted and reported, layout re-solves. |
| 6 | Sheet diagrams | Clicks sheet 2 | Sheet is selected; the cut sequence card lists its numbered saw steps. |
| 7 | Cut sequence card with Previous / Next cut | Presses Next cut repeatedly | The active cut lights up orange on the diagram, earlier cuts stay drawn, the step names the piece to pick up and the fence setting. This is the "aha": the plan is cuttable. |
| 8 | Toolbar | Presses Export CSV / Copy list / Print | Takes the plan to the workshop. A toast confirms. |

## Main screen wireframe

```
+--------------------------------------------------------------------------------------+
| (o) Kerfwise   Fewest sheets, real saw cuts      [Sample v] [Optimise] [CSV][Copy][Print] |
+---------------------------+----------------------------------------------------------+
| STOCK SHEET               | [3 sheets ][ 86% yield ][ 1.2 m2 waste ][ 186 cost ][offcut] |
| Length  Width  Kerf       | Tried 5,210 layouts in 0.65 s  [=========progress======]    |
| Trim    Price             +----------------------------+-----------------------------+
+---------------------------+ Sheet 1 - 93% used         | Sheet 2 - 91% used          |
| PARTS (34 pieces)         | +------+------+-----+----+ | +-------+-------+------+    |
| Label   L    W   Qty R  x | | Side | Side | Back|////| | | Door  | Door  | Shelf|    |
| Side    720  560  6  v  x | +------+------+-----+----+ | +-------+-------+------+    |
| Bottom  564  560  3  v  x | +----------------------------+---------------------------+
| ...                       | Sheet 3 - 71% used         | CUT SEQUENCE - Sheet 1       |
| [+ Add part]              | +-----+-----+///////////+  | [Prev] Step 3 of 21 [Next]   |
| > Bulk paste              | |     |     |//offcut///|  | 1. Rip 2440x1220 at 720      |
| [Reset]                   | +-----+-----+///////////+  | 2. Cross-cut strip at 560    |
+---------------------------+----------------------------+-----------------------------+
```

At 360px everything stacks in one column: header, toolbar (wrapping), stock, parts, stats (2 per row),
sheets (one per row, full width), cut sequence.

## Visual direction

- Feel: a drafting table in a tidy workshop. Warm paper, pencil-dark ink, one saw-blade orange accent.
- Palette: paper `#F3EEE4`, card `#FFFDF8`, ink `#1E2A30`, muted ink `#5A6870`, line `#D9CFBD`,
  accent orange `#D9481F`, teal `#17696B`, plywood `#EAD7AE`, offcut hatch `#B9A57A`.
  Parts are filled with twelve soft hues at one lightness so dark labels always read.
- Typography: system UI stack for text; `ui-monospace` stack with tabular numbers for dimensions.
- Motion: diagrams morph live during the search; a thin progress bar fills over 650 ms; sheets fade in.
  `prefers-reduced-motion` removes the fades.

## Data and logic

State (saved to localStorage as `kerfwise.v1`):

```
{ stock: { l, w, kerf, trim, price },          // strings as typed
  parts: [ { label, l, w, qty, rot } ] }        // l/w/qty strings, rot boolean
```

Key functions:

- `buildJob()` validates stock and rows, expands quantities into items, separates parts that cannot fit.
- `pack(items, order, fit, split, S)` guillotine packer: first sheet that fits, best free rectangle by the
  fit rule, then one straight split by the split rule; records the cuts it implies.
- `score()` / `cmp()` rank layouts: fewer sheets, then larger biggest offcut, then fewer cuts.
- `startSolve()` runs 120 deterministic strategies, then a seeded hill-climb over part order and rules in
  10 ms slices per animation frame until 650 ms have passed.
- `finalize()` turns the best bins into sheets, offcuts, cut steps and stats (including the area lower bound).
- `renderSheets()`, `renderSteps()`, `renderStats()`, `renderParts()` draw the UI.

Kerf: every part is treated as (w + kerf) x (h + kerf) and the sheet as (L + kerf) x (W + kerf), so two
neighbours are one blade apart and a part may still touch the far edge.

## Edge cases

- Empty list or all rows invalid: friendly empty state, stats show dashes, no errors.
- Huge input: quantity capped at 200 per row and 1,200 pieces in total, with a visible notice.
- Invalid input (blank, zero, negative, text): field is outlined, row is skipped, a notice counts skipped rows.
- Part larger than the usable sheet in every allowed orientation: listed under "Does not fit", rest still packed.
- Invalid stock (zero size, trim eating the whole sheet): solve is paused with a clear message.
- Reset: restores the sample job and clears saved data.
- Mobile 360px: single column, no horizontal scroll, table columns shrink, inputs stay tappable.
- Keyboard only: all controls are native inputs/buttons with visible focus rings; sheets are buttons;
  status changes are announced through an aria-live region.

## Definition of done

- [ ] First load shows the kitchen sample fully packed with stats, without interaction.
- [ ] Changing any stock or part field re-solves automatically.
- [ ] Kerf, trim and rotation lock visibly change the layout and are respected (no overlaps, nothing off-sheet).
- [ ] "Minimum possible" badge appears only when sheets used equals the area lower bound.
- [ ] Clicking a sheet shows its cut sequence; Previous/Next highlight cuts on the diagram.
- [ ] Bulk paste adds rows and reports skipped lines.
- [ ] Export CSV, Copy list and Print work.
- [ ] Parts that do not fit and invalid rows are reported, never crash.
- [ ] State survives a reload; Reset restores the sample.
- [ ] No horizontal scroll at 360px; no console errors; no network requests.
