# Brewlapse: Storyboard

**Story.** Priya is a product designer who sleeps badly on weekdays. It is 3:40 pm, the afternoon slump has hit, and she is standing at the office coffee machine wondering whether one more cold brew will cost her the night. She opens Brewlapse: her morning coffee and lunchtime espresso are already on a glowing curve, the mint sleep line sits low across the chart, and a card says *Last call for Cold brew: 13:55*. She hovers Cold brew and the ghost curve still sits well above the sleep line at bedtime. She takes a green tea instead, sees *Sleep-safe from 22:30*, and walks back to her desk knowing she will sleep.

## Frames

| # | Screen (what the user sees) | User action | What happens / why it matters |
|---|---|---|---|
| 1 | First load: header, four stat cards (In you now, Sleep-safe, Last call, Today), a glowing 24 h caffeine curve with sample drinks, a mint threshold line, a bedtime moon and a pulsing "now" marker | Nothing | Seeded sample history means the app already shows its point in the first second |
| 2 | Drink shelf of nine preset chips with mg values | Hovers or focuses "Cold brew" | Dashed ghost curve appears; a hint reads "+X mg at bedtime, sleep-safe moves to 01:20". She sees the cost before paying it |
| 3 | Same | Taps "Green tea" | Drink is logged now; curve, stats and log animate to the new state; a toast confirms with Undo |
| 4 | Chart | Drags or arrow-keys across the chart | A cursor line and readout show "18:20 · 112 mg" at any moment of the day |
| 5 | Today's log list | Changes a drink's time or deletes one | Everything recalculates instantly; mistakes are cheap to fix |
| 6 | Settings drawer: bedtime, half-life slider, threshold, daily limit | Moves half-life from 5 h to 8 h | Curve flattens and stretches, sleep-safe moves later: a personal model, not a generic one |
| 7 | Week strip with seven days, bars for totals and dots for bedtime level | Taps Tuesday | Chart and log switch to Tuesday; insight sentence explains the week |
| 8 | Last call card turns green with a time, or red with "Skip it today" | Reads it | The "aha": a single, concrete answer to "can I have another one?" |

## Main screen wireframe

```
+--------------------------------------------------------------------------+
| (o) Brewlapse   caffeine, timed to your sleep        [Export] [Settings] |
+--------------------------------------------------------------------------+
| IN YOU NOW   | SLEEP-SAFE    | LAST CALL (Filter v) | TODAY             |
|  142 mg      |  from 22:35   |  14:10               |  285 / 400 mg ███░ |
+--------------------------------------------------------------------------+
|  mg                                                         )  bedtime   |
| 200 |          .--.                                         |            |
| 100 |   .-----'    '---.__   ghost - - - -                  |            |
|  50 |--/----------------------'---.______----- sleep line --|------      |
|   0 +--o------o-------o------|now|------------------------------------   |
|     05   08   11   14   17   20   23   02   05                          |
+--------------------------------------------------------------------------+
| ADD A DRINK      when [ now ]                                            |
| [Espresso 63] [Filter 95] [Latte 126] [Cold brew 155] [Black tea 47] ... |
| custom: [name______] [mg__] [Add]                                        |
+-------------------------------------+------------------------------------+
| TODAY'S LOG                         | THIS WEEK                          |
| 07:30 Filter coffee  95 mg [time][x]| M  T  W  T  F  S  S  (bars + dots) |
| 10:15 Espresso       63 mg [time][x]| insight sentence                   |
+-------------------------------------+------------------------------------+
```

At 360px the stat cards become a 2×2 grid, the chart keeps full width with fewer axis labels, drink chips wrap, and the log and week panels stack.

## Visual direction

- **Palette:** espresso background `#15100D`, surface `#211913`, raised `#2C221B`, line `#3A2E25`, crema accent `#E8B67A`, deep crema `#C98B4A`, sleep mint `#7FD1B9`, warning amber `#F2C14E`, over-limit coral `#F07167`, text `#F5EEE7`, muted `#B3A496`.
- **Typography:** system UI stack (`-apple-system, Segoe UI, Roboto, sans-serif`), `ui-rounded` for big numbers where available, tabular numerals on every figure.
- **Motion and feel:** warm, calm, a little cosy, like a café at dusk. The curve has a soft crema gradient fill and glow; the now marker pulses gently; the ghost curve fades in at 150 ms; cards cross-fade values. Respects `prefers-reduced-motion`.

## Data and logic

- **State:** `{settings: {bedtime: '23:00', halfLife: 5, threshold: 50, limit: 400}, drinks: [{id, name, mg, ts}], customs: [{id, name, mg}], viewDay: dayKey|null, lastCallPick: presetId}` saved to localStorage under `brewlapse.v1`.
- **Day window:** each day runs 05:00 to 05:00 next day so late-night drinks belong to the evening they were drunk.
- **Model:** for a dose D taken at time t0, the amount at t is `D · ka/(ka−ke) · (e^(−ke·Δ) − e^(−ka·Δ))` for Δ ≥ 0, with `ke = ln2 / halfLife` and `ka = 5 /h` (peak about 44 minutes). The body level is the sum over every logged drink, so yesterday evening carries into this morning.
- **Key functions:** `levelAt(drinks, t)`, `sleepSafeTime(drinks, from)`, `lastCall(drinks, dose, now, bed)`, `nightPeak(drinks, bed)`, `dayStats(dayKey)`, `render()`.
- **Sleep-safe:** scan forward in 5-minute steps from max(now, last drink) up to 36 h; the answer is the step after the final sample above threshold.
- **Last call:** for each 5-minute slot T between now and bedtime, add the dose at T and compute the peak level from bedtime to bedtime+8 h; keep the latest T whose peak stays under threshold.

## Edge cases

- **Empty:** no drinks today means a flat line, "0 mg", "Sleep-safe now", Last call shows the latest slot (or "any time before bed").
- **Huge input:** custom mg is clamped to 1–1000; the chart's y-axis auto-scales to the highest point (minimum 200 mg); the log scrolls.
- **Invalid input:** empty names, non-numbers or a time outside the day are rejected with an inline message; corrupted storage falls back to defaults.
- **Reset:** Settings has "Reset all data" (with confirm) and "Load sample week".
- **Past bedtime / no slot:** Last call reads "Skip it today" in coral with the reason.
- **Mobile:** 2×2 stats, wrapping chips, chart scrubbing by touch drag; no horizontal scroll at 360px.
- **Keyboard-only:** every control is a native button or input; the chart is focusable and moves its cursor with arrow keys (Shift for 1 h); settings drawer closes on Escape and returns focus.

## Definition of done

- [ ] First load shows a populated curve, four filled stat cards and a seven-day strip.
- [ ] Tapping a preset logs it (now, or at the chosen time) and updates every number and the chart.
- [ ] Hovering or focusing a preset shows a ghost curve and a bedtime impact hint.
- [ ] Sleep-safe and Last call are computed by the model and change with settings.
- [ ] Log rows can be retimed and deleted; Undo works after logging.
- [ ] Custom drinks can be added and removed and persist.
- [ ] Week strip day tap switches the viewed day; insight sentence reflects the week.
- [ ] Settings persist; reset and sample load work; CSV export downloads.
- [ ] Chart scrubs with pointer, touch and arrow keys.
- [ ] No horizontal scroll at 360px; visible focus states; reduced motion respected.
- [ ] `publish.py check` prints CHECK OK with no warnings.
