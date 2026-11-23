# Rotamint: Storyboard

## Story
Priya runs a six-person clinic front desk. Every month she spends an evening in a spreadsheet, moving names around until nobody is on nights before an early morning, Sam's Fridays are free and the weekends feel fair. One swap breaks three other things. She opens Rotamint, sees a solved four-week rota already glowing on screen, changes one person's availability, presses Re-solve and watches the cost curve fall in two seconds. She leaves relieved, with a CSV in hand and proof the rota is fair.

## Frames
| # | Screen (what the user sees) | User action | What happens / why it matters |
|---|---|---|---|
| 1 | Dark dashboard: team cards left, 4-week rota grid centre, fairness bars right, sample team already solved | Opens page | Impressive first frame with real data; score badge reads "0 conflicts" |
| 2 | Hover over a person's chip | Mouse over | All of that person's shifts light up, others dim |
| 3 | Person card: weekday toggles and cap | Turns off Friday for someone | Rota is marked stale, Re-solve button pulses |
| 4 | Solver running: cost curve draws, temperature drops | Presses Re-solve | Rota reshuffles live, proving the algorithm works |
| 5 | Click a chip | Clicks an assignment | It pins (lock icon) and survives future solves |
| 6 | Time-off form on a card | Adds a date | Solver avoids that day; calendar cell shows an off marker for the person if forced |
| 7 | Rule report and fairness bars | Reads results | Shows spread of shifts, nights and weekends is within 1 |
| 8 | Export buttons | Clicks Export CSV | File downloads: success moment |

## Main screen wireframe
```
+-------------------------------------------------------------+
| Rotamint   [Re-solve] [People/shift 1-3] [Seed] [Export CSV]|
+-------------+---------------------------------+-------------+
| TEAM        | WEEK 1                          | FAIRNESS    |
| (card)      | Mon 23  [Day: Ana] [Night: Raj] | bars        |
| (card)      | Tue 24  ...                     | COST CURVE  |
| + Add       | ...                             | RULE REPORT |
+-------------+---------------------------------+-------------+
```
At 360px the three columns stack: toolbar, rota, stats, then team.

## Visual direction
Palette: background `#0E1320`, panel `#161D2F`, line `#26304A`, text `#E8ECF6`, muted `#8B97B5`, accent mint `#5EEAD4`, amber `#FBBF24`, danger `#FB7185`. System UI fonts, tabular numerals. Person colours are HSL hues. Soft glows on the score badge, smooth bar transitions, 150 ms chip highlight.

## Data and logic
State: `people[{id,name,hue,cap,avail[7],leave[]}]`, `rules{perShift,seed}`, `grid[slot][k]` person index, `pins[slot][k]`. Slot = day*2 + shift (0 Day, 1 Night), 28 days. Cost sums penalties (unavailable, duplicate, same-day double, night-to-day, streak over 5, weekly cap, fairness variance of shifts, nights, weekends). Annealing proposes reassign or swap on unpinned cells, accepts worse moves with exp(-delta/T), cools geometrically, keeps the best. Seeded PRNG.

## Edge cases
No people: message and disabled solve. Fewer people than needed per slot: warning, still solves. Blank name becomes "Person N". Invalid cap clamped 1-7. Duplicate leave dates ignored. Reset restores the sample team. Everything is a button or input, so keyboard works.

## Definition of done
- [ ] Loads solved with sample data, no console errors
- [ ] Add, remove, edit people; availability, cap, leave work
- [ ] Re-solve animates cost curve and respects pins
- [ ] Pin toggle by click or Enter
- [ ] Fairness bars and rule report update
- [ ] CSV export and copy text
- [ ] State persists in localStorage; reset works
- [ ] No horizontal scroll at 360px
