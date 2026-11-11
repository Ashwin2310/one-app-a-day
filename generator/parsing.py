"""Validate idea.json, the structured description of each app."""
from __future__ import annotations

import json

from .config import PipelineError

IDEA_TEXT_FIELDS = ("title", "tagline", "problem", "audience", "solution", "linkedin_hook")
IDEA_LIST_FIELDS = ("how_it_works", "features", "tech_highlights", "try_it")
MAX_TEXT_CHARS = 600
MAX_LIST_ITEMS = 8


def parse_idea(text: str) -> dict:
    """Parse and validate idea JSON; returns a new, clean dict or raises PipelineError."""
    try:
        raw = json.loads(text)
    except json.JSONDecodeError as exc:
        raise PipelineError(f"idea.json is not valid JSON: {exc}") from exc
    if not isinstance(raw, dict):
        raise PipelineError("idea.json must be a JSON object.")

    texts = {k: str(raw.get(k) or "").strip()[:MAX_TEXT_CHARS] for k in IDEA_TEXT_FIELDS}
    lists = {
        k: [str(i).strip() for i in (raw.get(k) or []) if str(i).strip()][:MAX_LIST_ITEMS]
        if isinstance(raw.get(k), list) else []
        for k in IDEA_LIST_FIELDS
    }
    missing = [k for k, v in {**texts, **lists}.items() if not v]
    if missing:
        raise PipelineError(f"idea.json is missing or has empty fields: {', '.join(missing)}")
    return {**texts, **lists}
