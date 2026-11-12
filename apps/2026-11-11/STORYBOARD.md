# Tablewright: Storyboard

**Story.** Priya is six weeks from her wedding with 50 guests, 7 round tables and a stack of sticky notes. Her cousins must sit as couples, her college friends want to be together, and Uncle Victor and Aunt Marguerite (recently divorced) must never share a table. Every time she fixes one table she breaks another. She opens Tablewright, and in the time it takes to sip her coffee the floor plan rearranges itself: the red lines between separated couples and clashing relatives fade away, the Harmony score climbs to the high 90s, and the chart shows the search settling. She pins her grandparents next to the dance floor, solves again, exports the CSV for the venue and closes the laptop feeling relieved instead of guilty.

## Frames

| # | Screen (what the user sees) | User action | What happens / why it matters |
|---|---|---|---|
| 1 | Dark, elegant floor plan of 7 round tables with 50 coloured guest chips scattered randomly, red conflict lines everywhere, stats showing many conflicts | Nothing (first load) | The solver starts automatically: guests glide into place, red lines disappear, Harmony climbs from ~40 to ~97 within 1.6 s. Impressive in the first seconds. |
| 2 | Settled plan, stats bar (Harmony, Rules met, Hard conflicts, Swaps tried), convergence chart, "Conflicts 31 → 0" summary | Reads the chart and the table list below the plan | Proof the search did real work: cost curve drops steeply then flattens. |
| 3 | Same plan | Clicks "Shuffle" | Everyone scrambles, red lines return, chart resets. Shows the problem is hard. |
| 4 | Scrambled plan | Clicks "Solve" | Live annealing animation again; the user now understands the before/after. |
| 5 | Guest detail card (name, group, table/seat, each rule with ✓ or ✗) with the guest highlighted and their rule lines shown | Clicks a guest chip (mouse or Enter key) | Explains why a guest sits where they do. Pin button locks them; clicking another seat swaps them by hand. |
| 6 | Rules tab with guest pickers and rule type | Adds "Keep apart" between two table-mates, then Solve | The new rule shows as a red line until solved; respects pins. |
| 7 | Guests / Tables tabs | Pastes a new list, changes to 6 tables of 10 | Plan rebuilds and re-solves; tables are added automatically if seats run short. |
| 8 | Export row | Clicks "Download CSV" or "Copy list" | Gets a venue-ready seating chart. Aha: done in minutes, not evenings. |

## Main screen wireframe

```
+------------------------------------------------------------------------------+
| ◎ Tablewright        Harmony 97  | Rules 41/42 | Hard conflicts 0 | Swaps 300k|
+---------------------------+--------------------------------------------------+
| [Guests][Rules][Tables]   |   ( T1 )      ( T2 )      ( T3 )      ( T4 )     |
|  editor for active tab    |  o o o o     o o o o     o o o o     o o o o     |
|                           |                                                  |
| Thoroughness [Balanced v] |   ( T5 )      ( T6 )      ( T7 )                 |
| [ Solve ] [ Shuffle ]     |                                                  |
|                           |  legend: ● Bride's family ● Groom's family ...   |
| Selected guest card       +--------------------------------------------------+
|  name, rules ✓/✗, [Pin]   |  Convergence chart (cost vs swaps)  31 → 0       |
| Export: [CSV] [Copy]      +--------------------------------------------------+
| [Print] [Reset sample]    |  Table list: T1: names...  T2: names...          |
+---------------------------+--------------------------------------------------+
```

At 360px the sidebar stacks above the plan, the stats become a 2x2 grid, and the plan uses 2 tables per row (SVG scales to width).

## Visual direction

- Palette: ink background `#12141c`, panel `#1b1e29`, line `#2a2f3f`, text `#ecebe6`, muted `#9a9fb0`, gold accent `#e8b860`, sage success `#7fd1a8`, coral conflict `#ff6b6b`. Group colours: `#e8b860 #7fb2ff #ff8fa3 #7fd1a8 #c39bff #ffb27a #5fd3d3 #d6d97a`.
- Typography: headings in `"Iowan Old Style", "Palatino Linotype", Georgia, serif` for a wedding-stationery feel; UI text in `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`; numbers with `font-variant-numeric: tabular-nums`.
- Motion: guests glide with a 0.35 s ease transform; conflict lines fade; buttons have a soft lift. Respects `prefers-reduced-motion` (no glide, instant solve result).
- Feel: calm, premium, stationery-like, with a quiet gold glow on the table tops.

## Data and logic

- State: `{ guests: [{name, group}], rules: [{a, b, type: 'next'|'with'|'apart'}], tables, seatsPerTable, seats: [guestIndex|-1], pins: {name: seat}, thoroughness }`, persisted to localStorage (`tablewright.v1`).
- Solver arrays: `seatGuest: Int16Array(totalSeats)`, `pos: Int16Array(guests)`, `rels[g] = [{other, type, id}]`, `stamp: Int32Array(relCount)` for dedupe.
- Cost of a relation from two seats: `next` → different table 100, same table not adjacent 6; `with` → different table 15; `apart` → same table 100 (adjacent 150); `group` (auto, every pair sharing a group) → different table 2.
- `delta(s1, s2)`: sum costs of relations touching the two guests, swap, sum again, return difference.
- Simulated annealing: steps = clamp(5000 × guests, 60k, 900k) × thoroughness; temperature T = T0·(Tend/T0)^(k/steps) with T0 = 60, Tend = 0.05; accept if Δ ≤ 0 or rand < e^(−Δ/T); skip pinned seats; keep the best arrangement; run steps/96 per animation frame (~1.6 s).
- Harmony = 100 × (1 − cost / maxCost), where maxCost is every relation at its worst.

## Edge cases

- Empty guest list: plan shows empty tables and a friendly "Add guests in the Guests tab" message; Solve is disabled.
- Huge input: capped at 300 guests and 40 tables × 16 seats; extra lines are ignored with a toast.
- Invalid input: blank lines skipped, duplicate names get " (2)", rules pointing at removed guests are dropped with a toast, self-rules and duplicate rules rejected, numeric inputs clamped.
- Not enough seats: tables are added automatically and the user is told.
- Reset: "Reset sample" restores the demo wedding after an in-page confirmation step.
- Mobile: stacked layout, 2 tables per row, 44px touch targets, no horizontal scroll at 360px.
- Keyboard-only: every guest chip is focusable (Tab), Enter/Space selects or swaps, Escape clears selection, visible focus rings.

## Definition of done

- [ ] First load shows the sample wedding solving itself, finished within ~2 s.
- [ ] Solve, Shuffle, thoroughness selector work; pinned guests never move.
- [ ] Conflict lines are drawn for violated rules and disappear when satisfied.
- [ ] Stats bar, convergence chart and before→after summary update live.
- [ ] Guest card shows rules with ✓/✗, Pin/Unpin works, click-to-swap works with mouse and keyboard.
- [ ] Guests, Rules and Tables editors validate input and rebuild the plan.
- [ ] CSV download, copy list and print layout work.
- [ ] State autosaves and reloads from localStorage.
- [ ] No console errors, no network requests, no horizontal scroll at 360px, `publish.py check` prints CHECK OK.
