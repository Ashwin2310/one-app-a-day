# Pursepace: Storyboard

**Story.** Maya is paid on the 1st. It is the 13th, she is standing in a shop holding a pair of
headphones, and her banking app can only tell her what she has already spent. She does not want
a spreadsheet; she wants to know whether buying this still gets her to payday. She opens
Pursepace, sees one number ("safe to spend today"), drags a slider to the price, and reads that
the purchase costs her about four a day for the rest of the cycle. She buys it without guilt, or
puts it back without regret, and either way she stops guessing.

## Frames

| # | Screen (what the user sees) | User action | What happens / why it matters |
|---|---|---|---|
| 1 | First load with a sample pay cycle 12 days in: dark green hero card with a large "safe to spend today" amount, meter, three stats; runway chart beside it | None | The app is impressive and understandable in seconds: one number, one chart, real-looking data |
| 2 | Quick-add box under the hero with a live preview line | Types `18 lunch` | Preview shows "18.00 · Food · today" before committing, so the parser is trusted |
| 3 | Hero number drops, meter fills, chart and log update, toast with Undo | Presses Enter | Instant feedback: logging takes three seconds, and a mistake is one tap to undo |
| 4 | "Can I afford it?" card with slider and verdict | Drags slider from 20 to 150 | Verdict moves from "fits in today" to "borrows from later days" with the per-day cost; this is the decision moment |
| 5 | Runway chart: even-pace dashed line, actual line, projection to payday, forecast sentence | Reads it | Shows where the cycle lands at the current pace, or the date money runs dry |
| 6 | Day-by-day strip of coloured cells and the streak stat | Taps a past day | Detail line shows that day's allowance versus spend; overspend days are visible at a glance |
| 7 | Plan dialog: income, savings, dates, currency, bills list, live "flexible per day" summary | Edits a bill, saves | Daily allowance re-paces immediately; the user's own numbers replace the sample |
| 8 | Hero reflects the user's real cycle | Logs real spending daily | The "aha": underspending today visibly raises tomorrow's allowance |

## Main screen wireframe

```
+--------------------------------------------------------------------------+
| (o) Pursepace        Nov 1 -> Dec 1 · day 13 of 30              [ Plan ]  |
+-----------------------------------+--------------------------------------+
| SAFE TO SPEND TODAY               | Runway to payday                     |
|  $49.69                           |  $|\ .                               |
|  [=====-----------] 4.50 of 54.19 |   | \  ' .  even pace                |
|  18 days | 6 streak | $970 left   |   |  \___     ' .                    |
|                                   |   |      \___ today ' .  - - -> +386 |
| [ 12.50 lunch      ][Auto][date]+ |   +-------------------------------   |
|  -> 12.50 · Food · today          |  At this pace you land with $386.    |
+-----------------------------------+--------------------------------------+
| Can I afford it?   | Where it went        | Day by day                   |
|  [ 120 ] ---o----- |  Groceries ####  124 |  [#][#][!][ ][#][!][#]...    |
|  Borrows from later|  Food      ###   110 |  Tap a day for detail        |
|  -3.90/day x 17    |  Fun       ##     47 |                              |
+--------------------+----------------------+------------------------------+
| Spending log                                                             |
|  Today · 4.50 of 54.19          coffee            Food        4.50  [x]  |
|  Yesterday · 26.10 of 51.40     groceries ...                            |
+--------------------------------------------------------------------------+
```

At 360px everything becomes a single column in the same order; the quick-add form stacks its
fields, the three stats stay on one row with smaller type, and the chart redraws to the
container width so labels stay legible.

## Visual direction

- **Palette:** paper `#f4efe6`, card `#fffdf8`, ink `#1d2a24`, muted `#55635b`, line `#e2d9c8`,
  forest `#17382b` (hero), green `#1f7a54`, mint `#bfe6cf`, amber `#b8770f`, red `#bf3f27`,
  coral accent `#e2674a`.
- **Typography:** `ui-serif, Georgia` for the wordmark and headings, `system-ui` for everything
  else, tabular numerals for all money.
- **Motion and feel:** calm ledger-at-the-kitchen-table. Meter and bars ease their width over
  300ms, toast slides up; nothing bounces. Reduced-motion users get no transitions.

## Data and logic

State (one object in `localStorage["pursepace.v1"]`):

```
{ v: 1, currency: "$",
  cycle: { start: "YYYY-MM-DD", payday: "YYYY-MM-DD", income: 3400, savings: 400 },
  bills: [{ id, name, amount }],
  expenses: [{ id, date, amount, note, cat }] }
```

- `compute(state, today)` derives everything: `flexible = income - bills - savings`; for each
  day `i` of the `N`-day cycle, `allowance_i = (flexible - spentBefore_i) / (N - i)`; today's
  `left = allowance - spentToday`; streak = consecutive completed days at or under allowance;
  pace = total spent / elapsed days; `projectedEnd = remaining - pace * daysRemaining`; if
  negative, the run-dry day is where the projection crosses zero.
- `whatIf(calc, x)`: fits today if `x <= left`; otherwise borrows, with new daily allowance
  `(remaining - x) / (daysLeft - 1)`; otherwise exceeds the cycle.
- `parseQuick(text)`: first number is the amount, "yesterday" shifts the date, remaining words
  are the note, category guessed from a keyword table.
- State changes are pure functions (`addExpense`, `removeExpense`, `applyPlan`, `newCycle`)
  returning new objects; the previous state reference is kept for Undo.
- `sanitizeState(raw)` validates stored and imported data.

## Edge cases

- **Empty input:** quick add with no number shows an inline error and logs nothing.
- **Huge input:** amounts capped at 1,000,000, notes at 60 characters, cycle at 366 days.
- **Invalid input:** payday on or before start, or bills plus savings above income, block Save
  with a clear message; a bad import file is rejected with a toast and state is untouched.
- **No spending yet:** chart shows a flat projection, categories show an empty-state line.
- **Past payday:** a banner offers "Start new cycle"; maths clamps to the last day.
- **Reset:** "Load sample" and "Start new cycle" both need a second confirming click.
- **Mobile:** single column, no horizontal scroll at 360px, tap targets at least 40px.
- **Keyboard-only:** every control reachable by Tab, visible focus ring, Enter submits quick
  add, Esc closes the Plan dialog, day cells are buttons.

## Definition of done

- [ ] First load shows sample cycle with hero number, meter, stats, chart, categories, strip, log
- [ ] Quick add parses amount, note, "yesterday" and category, with live preview and validation
- [ ] Hero, chart, categories, strip and log all update after add, delete and undo
- [ ] Rolling allowance: each day's allowance depends on spending before it
- [ ] Runway chart draws even pace, actual, projection, today marker and run-dry warning
- [ ] "Can I afford it?" gives three verdicts and can log the purchase
- [ ] Day strip cells are buttons that show per-day detail; streak stat is correct
- [ ] Plan dialog edits income, savings, dates, currency and bills with validation
- [ ] Export, import (validated), load sample and new cycle work
- [ ] Data persists in localStorage across reloads
- [ ] No horizontal scroll at 360px; focus states visible; no console errors; no network requests
