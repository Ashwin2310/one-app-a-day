# Emberkeep: Storyboard

**Story.** Maya has restarted her reading streak five times because one missed night reset the counter to zero. She opens Emberkeep and sees a warm dashboard already full of history. She ticks today's habits, notices her 23 day streak survived last Thursday thanks to the grace day, and sees that Sundays are her weakest day. She feels motivated rather than judged.

## Frames

| # | Screen (what the user sees) | User action | What happens / why it matters |
|---|---|---|---|
| 1 | Dashboard with sample habits, today ring, heatmaps | Load page | Impressive immediately: real data, streaks, insights |
| 2 | Today list with checkboxes | Tick a habit | Ring animates, streak increments, counts update |
| 3 | A habit card with 20-week heatmap | Click a past cell | Day toggles; streak and stats recompute |
| 4 | Insights panel and weekday bars | Read / select a habit | Shows strongest and weakest day, 4-week trend |
| 5 | New habit dialog | Click New habit, fill name, colour, target | Habit is added with empty history |
| 6 | Habit menu | Edit or delete | Changes persist, deletion asks to confirm |
| 7 | Backup controls | Export / import / clear sample | JSON file downloaded or loaded; success message |

## Main screen wireframe

```
+--------------------------------------------------------------+
| EMBERKEEP                         [New habit] [Backup v]      |
+----------------------+---------------------------------------+
| (ring) 3/5 today     |  Habit: Read 20 pages   streak 23     |
| [x] Read             |  heatmap 20 weeks x 7 days            |
| [ ] Run              |  weekday bars  Mon..Sun               |
| [x] Meditate         |  insights text                        |
+----------------------+---------------------------------------+
```
At 360px the two columns stack: ring and list first, then detail.

## Visual direction

- Palette: background `#14100d`, surface `#1e1814`, line `#3a2f27`, text `#f4ebe1`, muted `#a8998a`, ember `#ff7a3d`, gold `#ffc857`.
- System fonts: Georgia for headings, system sans for body.
- Motion: ring sweep 0.5 s, soft glow on completion, respects reduced motion.

## Data and logic

State: `{habits:[{id,name,color,target,created}], log:{id:{YYYY-MM-DD:1}}, selected, sample}`. Functions: `dateKey`, `streakOf`, `weekdayStats`, `weekProgress`, `insights`, `render`. The streak walker forgives one miss per rolling 7 days and never counts today as a miss.

## Edge cases

- No habits: friendly empty state with a call to action.
- Empty or very long names: validated, max 40 characters.
- Invalid import JSON: error message, state unchanged.
- Reset: confirm before deleting everything.
- Mobile 360px: no horizontal scroll, heatmap scrolls inside its box.
- Keyboard: all controls are buttons or inputs with visible focus.

## Definition of done

- [ ] Sample data shows on first load
- [ ] Check-in toggles and persists
- [ ] Streak with grace day correct
- [ ] Heatmap click edits past days
- [ ] Weekday bars and insights
- [ ] Add / edit / delete habit
- [ ] Export / import / clear
- [ ] No overflow at 360px, no console errors
