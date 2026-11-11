"""Offline tests: parsing, write-ups, payload, LinkedIn formatting. No network calls."""
from __future__ import annotations

import json
from datetime import datetime, timezone

import pytest

import automate
from generator import linkedin, repo
from generator.config import PipelineError
from generator.docs import app_readme, gallery_html
from generator.parsing import parse_files, parse_idea

IDEA = {
    "title": "Route <Fox>", "tagline": "Find the fastest path (with A*)",
    "problem": "Mazes are hard.", "audience": "Students", "solution": "Visualise A*.",
    "how_it_works": ["Grid", "Heuristic"], "features": ["Walls", "Speed slider"],
    "tech_highlights": ["Binary heap"], "try_it": ["Draw walls", "Press Run"],
    "linkedin_hook": "What if pathfinding was fun?",
}


def test_parse_idea_accepts_fenced_json_and_rejects_missing_fields():
    assert parse_idea("```json\n" + json.dumps(IDEA) + "\n```")["title"] == "Route <Fox>"
    with pytest.raises(PipelineError, match="features"):
        parse_idea(json.dumps({**IDEA, "features": []}))
    with pytest.raises(PipelineError):
        parse_idea("no json here")


def test_parse_files_strips_fences_and_injects_links():
    reply = "[FILE: index.html]\n```html\n<html><head></head><body></body></html>\n```\n" \
            "[FILE: style.css]\nbody{}\n[FILE: script.js]\nlet a=1\n"
    files = parse_files(reply)
    assert 'href="style.css"' in files["index.html"] and 'src="script.js"' in files["index.html"]
    assert files["style.css"] == "body{}\n"
    with pytest.raises(PipelineError, match="script.js"):
        parse_files("[FILE: index.html]\nx\n[FILE: style.css]\ny\n")


def test_payload_contains_app_docs_gallery_and_manifest():
    app = {"index.html": "<html></html>\n", "style.css": "a{}\n", "script.js": "1\n"}
    files, entry = automate.build_payload("2026-11-10", "design", IDEA, app, b"PNG",
                                          [{"day": 1, "date": "2026-11-09", "title": "Old",
                                            "category": "utility", "path": "apps/2026-11-09/"}],
                                          "https://me.github.io/r/")
    assert entry["day"] == 2 and files["apps/2026-11-10/screenshot.png"] == b"PNG"
    assert len(json.loads(files["apps/manifest.json"])) == 2
    readme = files["apps/2026-11-10/README.md"]
    for heading in ("## The problem", "## The solution", "## How it works", "screenshot.png"):
        assert heading in readme
    assert "Route &lt;Fox&gt;" in files["index.html"]  # gallery escapes model text


def test_category_rotation_and_override(monkeypatch):
    monkeypatch.delenv("FORCE_CATEGORY", raising=False)
    assert [automate.pick_category([{}] * n) for n in range(4)] == \
        ["problem-solving", "design", "utility", "problem-solving"]
    monkeypatch.setenv("FORCE_CATEGORY", "utility")
    assert automate.pick_category([]) == "utility"


def test_pages_url():
    assert repo.pages_base_url("Me/one-app") == "https://me.github.io/one-app/"
    assert repo.pages_base_url("Me/me.github.io") == "https://me.github.io/"


def test_linkedin_escaping_hashtags_and_version(monkeypatch):
    monkeypatch.delenv("LINKEDIN_API_VERSION", raising=False)
    text = linkedin.build_commentary(IDEA, {"day": 3}, "https://x.io/a_b/", "https://g/c")
    assert "\\(with A\\*\\)" in text and "Route \\<Fox\\>" in text and "a\\_b" in text
    assert text.endswith("{hashtag|\\#|100DaysOfCode}")
    assert linkedin.api_version(datetime(2026, 1, 5, tzinfo=timezone.utc)) == "202511"
    assert linkedin.api_version(datetime(2026, 11, 5, tzinfo=timezone.utc)) == "202609"


def test_readme_without_screenshot():
    entry = {"day": 1, "date": "d", "category": "utility", "has_screenshot": False}
    assert "screenshot.png" not in app_readme(IDEA, entry, "u")
    assert "No preview" in gallery_html([{**entry, "title": "t", "path": "p/"}])
