# Daily task playbook

You are building today's app for **One App a Day** (https://github.com/Ashwin2310/one-app-a-day).
Work in `/Users/ashwin/daily-app-generator`. Do every step yourself, without asking questions:
this runs unattended. Use `.venv/bin/python` for all Python.

## 1. Plan

Run `.venv/bin/python publish.py plan`. It pulls the latest code and prints JSON with
`date`, `folder`, `day`, `category`, `category_brief`, `avoid_titles`, `already_published`.

- If `already_published` is true, stop: today is done. Report "Already published today".
- Otherwise remember `folder` (e.g. `apps/2026-11-11/`) and `category`.

## 2. Idea

Brainstorm 5 candidate ideas that fit `category_brief`, then pick the single best one by:
a real, specific problem; impressive within 10 seconds of opening; buildable well in one page;
clearly different from every title in `avoid_titles`.

Hard constraints for the app: plain HTML, CSS and vanilla JavaScript; no frameworks, CDNs,
web fonts, images, external APIs or network requests of any kind; localStorage is fine.
Use an original name, never an existing product's name or branding.

Write `<folder>/idea.json` with exactly these keys:

```json
{
  "title": "short, catchy, original app name",
  "tagline": "one line, under 90 characters",
  "problem": "2-3 sentences: the concrete problem, who has it, why existing options fall short",
  "audience": "one sentence: who this is for",
  "solution": "2-3 sentences: how this app solves it",
  "how_it_works": ["3-6 steps explaining the approach / algorithm / technique"],
  "features": ["4-7 user-facing features"],
  "tech_highlights": ["3-5 notable implementation details"],
  "try_it": ["3-5 steps a first-time visitor should follow"],
  "linkedin_hook": "one punchy opening sentence for a LinkedIn post"
}
```

## 3. Storyboard (before writing any code)

Write `<folder>/STORYBOARD.md`, the end-to-end plan of the experience:

1. `# <Title>: Storyboard` and a one-paragraph **Story**: who the user is, the moment they
   hit the problem, and how they feel after using the app.
2. `## Frames`: a table with 5-8 rows, columns `# | Screen (what the user sees) | User action | What happens / why it matters`.
   Start at first load (which must already look impressive with sample data or a live demo
   state) and end at the "aha" / success moment.
3. `## Main screen wireframe`: an ASCII sketch in a code block of the layout at desktop width,
   plus one line on how it reflows at 360px.
4. `## Visual direction`: palette (hex codes), typography (system fonts), motion and feel.
5. `## Data and logic`: the state shape, key functions, and the algorithm / technique in plain words.
6. `## Edge cases`: empty input, huge input, invalid input, reset, mobile, keyboard-only use.
7. `## Definition of done`: a checklist the build must satisfy.

## 4. Build

Write `<folder>/index.html`, `<folder>/style.css`, `<folder>/script.js` that implement the
storyboard completely:

- index.html has `<title>`, `<meta name="description">`, `<meta name="viewport">`, links
  `style.css` with `<link rel="stylesheet" href="style.css">` and loads
  `<script src="script.js" defer></script>`. No inline `<style>` or `<script>` blocks.
- Polished, distinctive design that matches the storyboard's visual direction. The first screen
  looks great immediately, because a screenshot is taken right after load.
- Responsive down to 360px (no horizontal scroll), accessible (labels, focus states, contrast,
  keyboard use), and every feature in idea.json actually works. No TODOs or placeholders.

## 5. Test and fix

Run `.venv/bin/python publish.py check <folder>`. It loads the app in headless Chromium,
reports JS errors, failed requests and mobile overflow. Fix every error and warning and run
it again until it prints `CHECK OK` with no warnings. Then re-read the storyboard's
"Definition of done" and confirm each item against the code; fix anything missing and
re-run the check.

## 6. Publish

Run `.venv/bin/python publish.py publish <folder>`. It writes the app README (problem,
solution, how it works, features, storyboard link, screenshot), updates the gallery and root
README, commits, pushes to GitHub, and posts to LinkedIn if a token is configured.

- If it prints an ERROR, fix the cause and run it again.
- If git push fails because of authentication, stop and report it; do not change git config.

## 7. Report

Finish with 3 lines: the app title and category, the live demo URL printed by publish, and
whether LinkedIn was posted, skipped or failed (with the reason).
