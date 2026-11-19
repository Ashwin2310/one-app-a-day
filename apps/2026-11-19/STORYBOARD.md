# Shortloop: Storyboard

**Story.** Maya has seven stops on Saturday: pharmacy, post office, hardware store, bakery, dry cleaner, library, a friend's place. She lists them in the order they occurred to her and the route criss-crosses town twice. She opens Shortloop, sees her tangled loop already drawn, taps Optimize, and watches crossings vanish while the saved distance counter climbs. She leaves with a shorter, ordered list and the feeling of having beaten the map.

## Frames

| # | Screen (what the user sees) | User action | What happens / why it matters |
|---|---|---|---|
| 1 | Dark city-grid map with 9 sample stops joined by a tangled red-ish loop; stats show distance and 0% saved | Opens the page | Looks impressive at once: a clearly bad route invites fixing |
| 2 | Same map, toolbar with Optimize, speed, distance mode, travel mode | Presses Optimize | Route turns from tangled to clean live; best distance falls, saved % rises |
| 3 | Solver finished, badge "Local optimum, 5 crossings removed", itinerary list ordered | Reads the result | Before/after numbers prove the value |
| 4 | Map with a new stop dot appearing with a pop | Clicks empty map | Stop is added; route is marked stale and a re-solve hint shows |
| 5 | A dragged stop follows the pointer, edges stretch | Drags a stop | Route lengths update live; savings recomputed against baseline |
| 6 | Mode chip toggled to Street grid; route redrawn with right-angle legs | Toggles distance mode | Same stops, different best order |
| 7 | Itinerary card with numbered stops, total distance and time | Presses Copy itinerary | Plain text on clipboard; toast confirms |

## Main screen wireframe

```
+--------------------------------------------------------------+
| Shortloop   tagline                       [Sample][Random][Clear]|
+--------------------------------------+-----------------------+
|                                      |  Distance   Saved     |
|        CANVAS MAP (grid city)        |  12.4 km    -31%      |
|        stops + route                 |  Time  38 min         |
|                                      |  [Optimize] speed ---- |
|                                      |  Distance: Line|Grid   |
|                                      |  Travel: walk bike car |
|                                      |  Round trip [x]        |
|                                      |  1. Home (start)       |
|                                      |  2. Bakery   ...       |
|                                      |  [Copy itinerary]      |
+--------------------------------------+-----------------------+
```
At 360px the panel stacks under the map, which keeps a 4:5 aspect ratio and full width.

## Visual direction

Palette: background `#0b1020`, panel `#121a30`, grid `#1d2845`, accent route `#38e8c6`, baseline route `#ff6b81` (dashed), highlight `#ffd166`, text `#e8ecf8`, muted `#8e9ac0`. System font stack, tabular numbers for stats. Motion: stops pop in, the route has a flowing dash, improvements pulse a soft glow; reduced-motion disables flow.

## Data and logic

State: `{stops:[{id,name,x,y}], startId, round, metric:'line'|'grid', travel:'walk'|'bike'|'car', baselineOrder, order, solver}`. Coordinates are normalised 0..1. `dist(a,b)` by metric; `routeLength(order)` sums legs (plus return if round trip; start is fixed at index 0). Solver: nearest-neighbour seed, then loop of 2-opt passes (reverse segment i..j if delta<0) followed by Or-opt (move segment of 1-3 stops), run in time slices until a full pass makes no gain. Baseline is the click order starting at the start stop.

## Edge cases

Empty map: friendly empty state, Optimize disabled. One or two stops: nothing to optimise, message shown. Maximum 60 stops, extra clicks ignored with a toast. Duplicate positions work (zero distance). Reset/clear confirms through undo-free simple clear. Mobile: touch drag via pointer events. Keyboard: every stop in the list has rename, set-start and remove buttons; Random and Sample buttons add stops without a pointer.

## Definition of done

- [ ] First load shows a sample tangled route with no interaction
- [ ] Optimize animates and ends with measurably shorter distance
- [ ] Add, drag, rename, remove, set start all work
- [ ] Line/grid and walk/bike/car switches update numbers
- [ ] Round trip toggle works
- [ ] Copy itinerary works with toast
- [ ] State persists in localStorage
- [ ] No horizontal scroll at 360px; no console errors
