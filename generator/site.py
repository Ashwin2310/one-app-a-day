"""Manifest bookkeeping and writing the generated site files to disk."""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path

from .config import APPS_DIR, CATEGORIES, MANIFEST_PATH, RECENT_TITLES, PipelineError
from .docs import app_readme, gallery_html, root_readme


def load_manifest(root: Path) -> list[dict]:
    path = root / MANIFEST_PATH
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise PipelineError(f"{MANIFEST_PATH} is corrupt: {exc}") from exc
    return [e for e in data if isinstance(e, dict)] if isinstance(data, list) else []


def next_category(manifest: list[dict]) -> str:
    names = list(CATEGORIES)
    return names[len(manifest) % len(names)]


def plan_today(root: Path, today: date) -> dict:
    """Everything the daily run needs to know before it starts brainstorming."""
    manifest = load_manifest(root)
    category = next_category(manifest)
    folder = f"{APPS_DIR}/{today.isoformat()}/"
    return {
        "date": today.isoformat(),
        "folder": folder,
        "already_published": any(e.get("date") == today.isoformat() for e in manifest),
        "day": len(manifest) + 1,
        "category": category,
        "category_brief": CATEGORIES[category],
        "avoid_titles": [e.get("title", "") for e in manifest][-RECENT_TITLES:],
    }


def build_entry(manifest: list[dict], day_date: str, category: str, idea: dict, has_shot: bool) -> dict:
    return {
        "day": len(manifest) + 1, "date": day_date, "title": idea["title"],
        "tagline": idea["tagline"], "category": category,
        "path": f"{APPS_DIR}/{day_date}/", "has_screenshot": has_shot,
    }


def write_site(root: Path, manifest: list[dict], entry: dict, idea: dict,
               screenshot: bytes | None, pages_base: str) -> list[dict]:
    """Write the app README, screenshot, manifest, root README and gallery. Returns new manifest."""
    new_manifest = [*manifest, entry]
    folder = root / entry["path"]
    if screenshot:
        (folder / "screenshot.png").write_bytes(screenshot)
    (folder / "README.md").write_text(app_readme(idea, entry, pages_base + entry["path"]), encoding="utf-8")
    (root / MANIFEST_PATH).write_text(json.dumps(new_manifest, indent=2) + "\n", encoding="utf-8")
    (root / "README.md").write_text(root_readme(new_manifest, pages_base), encoding="utf-8")
    (root / "index.html").write_text(gallery_html(new_manifest), encoding="utf-8")
    (root / ".nojekyll").write_text("", encoding="utf-8")
    return new_manifest
