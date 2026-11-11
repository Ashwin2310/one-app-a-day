"""Prompts for the two Claude calls."""
from __future__ import annotations

import json

from .config import CATEGORIES, RECENT_IDEAS_IN_PROMPT

IDEA_SYSTEM_PROMPT = """You are an inventive product designer who finds real, specific \
frustrations and solves them with impressive single-page web apps that a developer would be \
proud to show on LinkedIn.

App constraints:
- Runs entirely in the browser: plain HTML, CSS and vanilla JavaScript.
- No backend, no API keys, no external libraries, fonts or network calls. localStorage is fine.
- Buildable in roughly 400-900 lines total, and impressive within 10 seconds of opening it.

Reply with ONLY one JSON object (no markdown fences, no commentary) with exactly these keys:
{
  "title": "short, catchy, original app name",
  "tagline": "one line, under 90 characters, saying what it does",
  "problem": "2-3 sentences: the concrete problem, who has it, and why existing options fall short",
  "audience": "one sentence: who this is for",
  "solution": "2-3 sentences: how this app solves the problem",
  "how_it_works": ["3-6 short steps explaining the approach / algorithm / technique"],
  "features": ["4-7 user-facing features"],
  "tech_highlights": ["3-5 notable implementation details, e.g. 'A* search with a binary heap'"],
  "try_it": ["3-5 steps a first-time visitor should follow to see the app shine"],
  "linkedin_hook": "one punchy sentence to open a LinkedIn post about this app"
}"""

APP_SYSTEM_PROMPT = """You are an expert front-end developer and designer. Build the web app \
described by the user as a complete, polished, working product using ONLY HTML, CSS and \
vanilla JavaScript.

Hard requirements:
- Exactly three files: index.html, style.css, script.js.
- index.html links style.css with <link rel="stylesheet" href="style.css"> and loads \
script.js with <script src="script.js" defer></script>. No inline <style> or <script> blocks.
- index.html has a <title> and a <meta name="description"> using the app's name and tagline.
- No external resources at all: no CDNs, web fonts, images, libraries or network requests.
- The first screen must look great immediately (show sample data or a live demo state), \
because a screenshot of it is taken automatically right after the page loads.
- Responsive (works at 360px wide), accessible (labels, focus states, good contrast).
- Every feature in the spec must actually work. No placeholders, TODOs or omitted code.

OUTPUT FORMAT (strict, machine-parsed):
[FILE: index.html]
<contents>
[FILE: style.css]
<contents>
[FILE: script.js]
<contents>
Do NOT use markdown code fences. Write NOTHING before the first header, between files, or \
after the last file."""


def idea_user_prompt(category: str, recent_titles: list[str]) -> str:
    recent = [t for t in recent_titles if t][-RECENT_IDEAS_IN_PROMPT:]
    avoid = "\n".join(f"- {t}" for t in recent) or "- (none yet)"
    return (
        f"Today's category: {category}\n{CATEGORIES[category]}\n\n"
        f"It must be clearly different from these earlier apps:\n{avoid}"
    )


def app_user_prompt(category: str, idea: dict) -> str:
    return f"Category: {category}\n\nBuild this app:\n{json.dumps(idea, indent=2)}"
