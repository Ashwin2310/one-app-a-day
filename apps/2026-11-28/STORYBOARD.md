# Hearthsplit: Storyboard

**Story.** Priya, Tom, Ade and Mei have just signed for a four-bed flat at 3,200 a month. One room is a bright loft, one opens onto the garden, one has its own bathroom and one is a box room above the stairs. Someone suggests "just split it four ways" and Mei, who will clearly end up in the box room, goes quiet. Priya opens Hearthsplit. Everyone types in how they would divide the rent across the rooms. A few seconds later the floor plan shows who gets which room and what they pay. A table below proves that nobody would trade their deal for anyone else's. Mei pays 650 instead of 800, everyone can see why, and the group chat moves on to arguing about the bins.

## Frames

| # | Screen (what the user sees) | User action | What happens / why it matters |
|---|---|---|---|
| 1 | First load: dark warm header "Hearthsplit", a solved four-room floor plan in four colours with prices on each room, a big "0 people envious" badge, and the setup panel on the left with sample bids | Looks | The value is visible at once: a real split is already worked out and proven fair with sample data |
| 2 | Compare card: Equal split shows "3 envious", By area "2 envious", Hearthsplit "0 envious", with per-person prices in each column | Reads | The "aha": the obvious splits create resentment and this one does not |
| 3 | Bid matrix: rows = people, columns = rooms, row-sum chip green when it equals the rent | Raises Priya's Loft bid | Solve runs on every input. If the row no longer sums to the rent the chip turns amber with a "Fit" button |
| 4 | Row chip amber, "Fit" button | Presses Fit | The row is scaled proportionally to sum to the rent (rounded, remainder on the largest bid), and prices and plan update |
| 5 | Envy proof matrix: each cell shows how much better off the person is with their own deal than with that room at its price; own room highlighted, all ≥ 0 green | Hovers or focuses a cell | Tooltip / caption explains the number, so the proof can be checked by hand |
| 6 | Household panel: rent, currency, people and rooms with area | Adds a housemate (+ room) | A new person and room appear with bids prefilled as an even split; the floor plan re-tiles to 5 rooms |
| 7 | Receipts: "Mei · Box room · pays 650 · valued it at 550 + is 100 ahead…" | Presses "Copy agreement" | Plain-text agreement copied; a toast confirms. This is the success moment to share |

## Main screen wireframe

```
+--------------------------------------------------------------------------------+
| ⌂ Hearthsplit   Envy-free rent splitting                [Copy agreement] [Reset]|
+------------------------------------+-------------------------------------------+
| HOUSEHOLD                          |  FLOOR PLAN (SVG)            ( 0 envious ) |
| Rent [ 3200 ]  Currency [ £ ]      |  +-----------+--------+                   |
| People: Priya Tom Ade Mei  [+ add] |  |  Loft     | Garden |                   |
| Rooms:  Loft 22m² Garden 18m² ...  |  |  Priya    |  Tom   |                   |
|                                    |  |  £1,150   | £950   |                   |
| BIDS (each row sums to rent)       |  +------+----+--------+                   |
|        Loft Garden Ensuite Box  Σ  |  | Box  |  Ensuite    |                   |
| Priya  1100  900    800   400  ✓   |  | Mei  |  Ade £1,050 |                   |
| Tom    1000 1000    750   450  ✓   |  +------+-------------+                   |
| Ade     900  800   1100   400  ✓   |  COMPARE  Equal | By area | Hearthsplit    |
| Mei    1050  750    850   550  ✓   |  ENVY PROOF matrix                        |
|                                    |  RECEIPTS (one card per person)           |
+------------------------------------+-------------------------------------------+
| How it works (4 short steps)                                                   |
+--------------------------------------------------------------------------------+
```

At 360px the two columns stack (results first, then setup). The bid and envy tables scroll horizontally inside their own cards, never the page.

## Visual direction

- Palette: background `#15110E` (warm charcoal), panels `#1F1915`, lines `#3A3029`, text `#F4ECE3`, muted `#B5A595`, accent ember `#F2994A`, success `#6FCF97`, warning `#F2C94C`, danger `#EB5757`. Person colours: `#F2994A #56CCF2 #BB6BD9 #6FCF97 #F2C94C #EB5757 #9AA5FF #FF8FB1`.
- Typography: system UI stack (`-apple-system, Segoe UI, Roboto, sans-serif`) for body, tabular numbers for prices, and Georgia for the large heading to give it a homely editorial touch.
- Motion: the floor plan rooms ease their fill colour and price text on change (CSS transition on fill), the envy badge pulses once when it changes, and a toast slides up on copy. `prefers-reduced-motion` disables the motion.
- Feel: a calm, warm, kitchen-table tool: rounded 14px cards, soft shadows, generous spacing.

## Data and logic

- State: `{rent, currency, people:[{id,name}], rooms:[{id,name,area}], bids:number[person][room]}` persisted to `localStorage` key `hearthsplit:v1`.
- `assign(bids)` uses the Hungarian algorithm with potentials (minimising negated bids) and returns `roomOf[person]`.
- `envyFreePrices(bids, roomOf, rent)`: node i = room of person i. Constraint `p_i − p_j ≤ b_i(own) − b_i(room j)` gives an edge j→i of that weight. A source edge to i has weight `b_i(own)`. Bellman-Ford gives the maximal feasible `d`. Then `c = (Σd − rent)/n` and `p_i = d_i − c`. Every surplus `b_i(own) − p_i ≥ c`, and this maximises the minimum surplus. A negative cycle (impossible for a max-welfare assignment) raises an error shown in the UI.
- `envyMatrix(bids, roomOf, prices)`: cell[i][j] = surplus_i(own) − (b_i(j) − price(j)), and `envious(i)` = any cell < −0.5.
- Comparisons: equal split (rent/n each, rooms by same assignment) and by-area split (rent × area/Σarea), each run through the same envy check (people choose the best room for them given the prices, compared with the assigned room).
- `floorPlan(rooms, rect)`: recursive split of the area-sorted list into two halves of nearly equal total area, cut along the longer side, drawn as SVG rects.
- Rounding: prices are rounded to whole units with the remainder spread so they sum exactly to the rent.

## Edge cases

- Empty or non-numeric bid → treated as 0 and the cell marked invalid. Negative values are clamped to 0.
- Rent 0 or empty → message "Enter the total rent" and the solve is paused.
- Huge input → at most 8 people and rooms (the add button is disabled at 8) and bids capped at 10,000,000.
- Rows not summing to rent → amber chip and Fit button. Solving still works, with a banner explaining the bids should sum to the rent.
- Negative price possible with extreme bids → shown as a credit ("receives £x") with a note.
- Reset → restores the sample household after confirmation.
- Mobile → stacked layout, tables scroll inside cards, touch-sized inputs (≥ 40px).
- Keyboard-only → all controls are native inputs/buttons with visible focus rings, logical tab order, and an `aria-live` region announcing the envy count.

## Definition of done

- [ ] First load shows a solved sample flat with floor plan, prices, envy badge and comparison.
- [ ] Editing any bid, rent, area, name or currency re-solves live with no errors.
- [ ] Hungarian assignment maximises total winning bids. Prices sum exactly to the rent.
- [ ] Envy matrix shows no negative cells for Hearthsplit's result.
- [ ] Compare card counts envious people for equal and by-area splits.
- [ ] Add/remove housemate (2–8), Fit row, Fit all, Copy agreement, Reset all work.
- [ ] State persists across reloads via localStorage (guarded with try/catch).
- [ ] No horizontal page scroll at 360px. Focus states are visible and the app works by keyboard alone.
- [ ] No external requests, no inline scripts/styles, and `publish.py check` prints CHECK OK with no warnings.
