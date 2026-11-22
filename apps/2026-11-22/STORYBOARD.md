# Dueweave: Storyboard

**Story.** Priya is a freelance developer with eleven open tasks, three client deadlines this week and a
habit of ordering her to-do list by gut feeling. On Tuesday morning she realises the invoice export she
promised for Wednesday needs five hours and her Tuesday is already full: the list never told her. She
types her tasks into Dueweave as plain lines, and within seconds sees her week laid out hour by hour,
with the invoice task flagged "late by 1h 30m" and pulled to the front. She trims her working day plan,
the badge turns amber, then green. She closes the tab knowing exactly what to do next and that nothing
is quietly slipping.

## Frames

| # | Screen (what the user sees) | User action | What happens / why it matters |
|---|---|---|---|
| 1 | First load: header, Up next card, quick-add bar, ranked task list with coloured risk badges, five-day timeline filled with coloured blocks (sample tasks dated relative to now) | None | Looks alive and useful instantly; the value (a planned week plus warnings) is visible before any input |
| 2 | Quick-add bar with chips under it: title, 3h, due tomorrow 14:00, high, #home | Types "Tax forms 3h !high by tomorrow 2pm #home" | Live parse shows the app understood each part before committing, so the syntax teaches itself |
| 3 | New task appears ranked near the top; timeline reflows; another task turns amber "Tight" | Presses Enter | Adding work shows its knock-on cost to the rest of the week immediately |
| 4 | Expanded "Why this rank?" panel: slack 2h 10m, due in 1d 4h, high importance, score bar | Clicks "Why this rank?" on a task | The ranking is explainable, so the user trusts it rather than fighting it |
| 5 | Hours panel open: day start / end selects and weekends toggle | Sets 10 to 16 | Less capacity, the plan recomputes and the Overbooked banner appears when deadlines cannot all fit |
| 6 | Edit dialog with title, minutes, importance, deadline, tag | Clicks a task title, shortens 300 to 180 min, saves | Late badge clears; the user fixes risk by changing scope, not by hoping |
| 7 | Task struck through, toast "Marked done · Undo" | Ticks a checkbox | Next task moves into Up next; undo protects against mis-clicks |
| 8 | Every badge green, banner "All deadlines on track" | — | Aha: the week fits, and the user knows it for certain |

## Main screen wireframe

```
+---------------------------------------------------------------------------------+
| (o) Dueweave        12 tasks · 23h planned · 1 late      [Hours 9-17] [Copy] [⋯] |
+---------------------------------------------------------------------------------+
| UP NEXT  ▸ Invoice export for Acme           Tue 9:00-11:30   Late by 1h 30m     |
|          why: due Wed 12:00 · slack -1h 30m · high importance                     |
+---------------------------------------------------------------------------------+
| [ + Prep slides 90m !high by thu 3pm #work                              ] [Add]  |
|   (Prep slides) (1h 30m) (Thu 15:00) (high) (#work)                              |
+-------------------------------------------+-------------------------------------+
| [All] [#work] [#home] [#client]            |  Tue      Wed      Thu    Fri   Mon |
| 1 [ ] Invoice export  5h  Wed 12:00 LATE   |  9 |███|  |███|   |██|   |  |  |█| |
|       ████████████ 100   Why this rank? ▾ |    |███|  |   |   |██|   |██|  |█| |
| 2 [ ] Tax forms       3h  Thu 14:00 TIGHT  | 12 |▒▒▒|  |▓▓▓|   |  |   |██|  | | |
| 3 [ ] Review PR #42   30m no due   OK      |    |▒▒▒|  |▓▓▓|   |░░|   |  |  | | |
| ...                                        | 17 +---+  +---+   +--+   +--+  +-+ |
|  ▸ Done (2)                                |  load 100%  88%   63%    40%   10% |
+-------------------------------------------+-------------------------------------+
```

At 360px the two columns stack (Up next, quick add, list, then plan) and the timeline turns into an
agenda: each day is a heading with its blocks listed as "9:00-11:30 · Invoice export".

## Visual direction

- Palette: ink background `#0E1315`, panel `#151C1F`, raised `#1B2428`, line `#26332F`, text `#E7EEEA`,
  muted `#93A59F`, mint accent `#5BE3B0` (on track, primary actions), amber `#FFB547` (tight),
  coral `#FF6B6B` (late), violet `#A497FF` (focus ring / Up next glow). Tag colours from a fixed set:
  `#5BE3B0`, `#7CC4FF`, `#FFB547`, `#F78FD0`, `#A497FF`, `#9BE26B`.
- Typography: system UI stack (`ui-sans-serif, -apple-system, Segoe UI, Roboto`) for text, `ui-monospace`
  for times and durations, tabular numerals. Brand mark is a woven SVG drawn inline.
- Motion: 160 ms ease-out for hover, list rows fade/slide 6 px on re-render of a newly added task, toast
  slides up. All motion disabled under `prefers-reduced-motion`.
- Feel: calm, dense, trustworthy: like a well-made terminal planner, never a toy.

## Data and logic

State (saved as JSON under `dueweave.v1`):

```
{ tasks: [{ id, title, minutes, importance: 1|2|3, due: ISO string|null, tag: string|null,
            done: boolean, doneAt: ISO|null, createdAt: ISO }],
  settings: { dayStart: 9, dayEnd: 17, weekends: false },
  filter: 'all' | tag }
```

Key functions:

- `parseQuickAdd(text, now)` → `{title, minutes, importance, due, tag}`: tokenises durations
  (`90m`, `1.5h`, `1h30m`), importance (`!`, `!high`, `!low`), dates (`today`, `tomorrow`, weekday names,
  `in 3d`, `dec 5`, `5 dec`), times (`5pm`, `17:00`) and `#tag`; the rest is the title.
- `buildSlots(now, settings, days)`: free intervals from now within working hours.
- `freeMinutesBetween(slots, a, b)`: capacity between two instants.
- `computeSlack(tasks, slots, now)`: earliest-deadline-first cumulative work vs capacity per task.
- `scoreTask(task, slack, now)`: importance weight × (0.5 + urgency(slack) + age) × quick-win boost,
  returns score plus the explanation parts.
- `placeTasks(order, slots)`: packs tasks into slots, splitting at slot ends; returns chunks and finish times.
- `planWeek(state, now)`: score order, then up to 60 repair moves pulling each late but feasible task in
  front of the first earlier-placed task with a later or no deadline; returns ranked tasks, chunks, risk.
- `render()`: draws header stats, Up next, chips, list, timeline from the plan. Pure from state.

## Edge cases

- Empty input: Add does nothing and the field shakes once with an "Type a task first" hint; a line that is
  only tokens (e.g. "2h") gets the title "Untitled task".
- Huge input: titles capped at 120 chars, minutes clamped 5 to 1440, horizon 21 days; anything that does
  not fit shows "Not scheduled in the next 3 weeks".
- Invalid input: unknown tokens stay in the title; past deadlines are kept and show "late"; corrupt
  localStorage falls back to sample data.
- Empty list: friendly empty state with three example lines that can be clicked to add.
- Reset: menu offers "Load sample tasks" and "Clear all" (with confirm).
- Mobile: single column, agenda timeline, 44 px tap targets, no horizontal scroll at 360px.
- Keyboard-only: everything is a real button / input / checkbox / dialog; visible focus rings; Enter adds,
  Escape closes dialog and panels, the edit dialog traps focus via `<dialog>`.

## Definition of done

- [ ] First load shows sample tasks, an Up next card, risk badges and a filled five-day timeline.
- [ ] Quick add parses duration, importance, deadline, time and tag, previewed live as chips.
- [ ] Tasks are ranked by the score; "Why this rank?" shows the real factors.
- [ ] Timeline packs tasks into working hours, splitting across days; load % per day shown.
- [ ] Late / tight / on track badges and the overbooked banner reflect the plan; repair pass runs.
- [ ] Edit dialog, delete, complete with undo, tag filters, hours and weekends settings all work.
- [ ] Copy plan copies readable text; state persists in localStorage across reloads.
- [ ] Responsive to 360px with no horizontal scroll; keyboard and screen-reader friendly; no console errors.
