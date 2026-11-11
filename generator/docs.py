"""Write-ups: each app's README, the repo's root README and the live gallery page."""
from __future__ import annotations

import html

from .config import MODEL

CATEGORY_LABELS = {
    "problem-solving": "🧠 Problem solving / AI",
    "design": "🎨 Design",
    "utility": "🛠️ Utility",
}


def _bullets(items: list[str]) -> str:
    return "\n".join(f"- {item}" for item in items)


def _numbered(items: list[str]) -> str:
    return "\n".join(f"{i}. {item}" for i, item in enumerate(items, 1))


def app_readme(idea: dict, entry: dict, demo_url: str) -> str:
    label = CATEGORY_LABELS.get(entry["category"], entry["category"])
    shot = "![Screenshot](screenshot.png)\n\n" if entry.get("has_screenshot") else ""
    return f"""# {idea['title']}

> {idea['tagline']}

**[▶ Try the live demo]({demo_url})** · Category: {label} · Day {entry['day']} · {entry['date']}

{shot}## The problem

{idea['problem']}

**Who it's for:** {idea['audience']}

## The solution

{idea['solution']}

## How it works

{_numbered(idea['how_it_works'])}

## Features

{_bullets(idea['features'])}

## Under the hood

{_bullets(idea['tech_highlights'])}

Built with plain HTML, CSS and vanilla JavaScript: no frameworks, no build step, no backend.

## Try it yourself

{_numbered(idea['try_it'])}

## Run it locally

Download this folder and open `index.html` in any browser. That's it.

---

<sub>Part of a daily build series: one new app every day, generated with an AI pipeline \
({MODEL}) and published automatically.</sub>
"""


def root_readme(manifest: list[dict], pages_base: str) -> str:
    rows = "\n".join(
        f"| {e['day']} | {e['date']} | **{e['title']}**<br><sub>{e.get('tagline', '')}</sub> | "
        f"{CATEGORY_LABELS.get(e['category'], e['category'])} | "
        f"[Demo]({pages_base}{e['path']}) · [Write-up]({e['path']}README.md) |"
        for e in reversed(manifest)
    )
    return f"""# One App a Day

A new single-page web app every day: algorithms and in-browser AI, creative design tools, and \
everyday utilities with extra features. Each one comes with a write-up explaining the problem \
and how the app solves it.

**[Browse the live gallery]({pages_base})** · {len(manifest)} apps so far

| Day | Date | App | Category | Links |
|---:|---|---|---|---|
{rows}

## How this works

Every hour a GitHub Actions workflow rolls a 1-in-24 die. On a hit, Claude brainstorms a new \
idea in today's category, builds it as HTML/CSS/JS, writes the README, takes a screenshot, \
commits it under `apps/YYYY-MM-DD/`, and shares it on LinkedIn.
"""


def _card(entry: dict) -> str:
    title = html.escape(entry["title"])
    tagline = html.escape(entry.get("tagline", ""))
    label = html.escape(CATEGORY_LABELS.get(entry["category"], entry["category"]))
    href = html.escape(entry["path"])
    img = (
        f'<img src="{href}screenshot.png" alt="Screenshot of {title}" loading="lazy">'
        if entry.get("has_screenshot") else '<div class="noshot">No preview</div>'
    )
    return (
        f'<a class="card" href="{href}">{img}<div class="body"><span class="tag">{label}</span>'
        f"<h2>{title}</h2><p>{tagline}</p><small>Day {entry['day']} · {html.escape(entry['date'])}"
        "</small></div></a>"
    )


def gallery_html(manifest: list[dict]) -> str:
    cards = "\n".join(_card(e) for e in reversed(manifest))
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>One App a Day</title>
<meta name="description" content="A new web app every day, each with a write-up.">
<style>
:root{{--bg:#0d1117;--card:#161b22;--fg:#e6edf3;--muted:#8b949e;--accent:#58a6ff}}
*{{box-sizing:border-box}}body{{margin:0;font:16px/1.5 system-ui,sans-serif;background:var(--bg);color:var(--fg)}}
header{{padding:48px 16px 24px;text-align:center}}h1{{margin:0 0 8px;font-size:2.4rem}}
header p{{color:var(--muted);margin:0}}
main{{display:grid;gap:20px;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));padding:16px;max-width:1200px;margin:auto}}
.card{{background:var(--card);border-radius:12px;overflow:hidden;color:inherit;text-decoration:none;border:1px solid #30363d;transition:transform .15s}}
.card:hover{{transform:translateY(-3px);border-color:var(--accent)}}
.card img,.noshot{{width:100%;aspect-ratio:16/10;object-fit:cover;display:block;background:#21262d}}
.noshot{{display:grid;place-items:center;color:var(--muted)}}
.body{{padding:14px 16px 18px}}.tag{{font-size:.8rem;color:var(--accent)}}
h2{{margin:4px 0 6px;font-size:1.15rem}}p{{margin:0 0 8px;color:var(--muted)}}small{{color:var(--muted)}}
</style></head><body>
<header><h1>One App a Day</h1><p>{len(manifest)} apps · problem solving, design and utilities</p></header>
<main>
{cards}
</main></body></html>
"""
