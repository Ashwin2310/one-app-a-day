"""Manifest bookkeeping and writing the generated site files to disk."""
from __future__ import annotations

import json
import shutil
from datetime import date
from pathlib import Path

from .config import APPS_DIR, CATEGORIES, MANIFEST_PATH, RECENT_TITLES, PipelineError
from .docs import app_readme, gallery_html, root_readme

PLAN_FILE = ".plan.json"
APP_FILES = ("idea.json", "STORYBOARD.md", "index.html", "style.css", "script.js")


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


def _folder_category(folder: Path) -> str | None:
    try:
        return json.loads((folder / PLAN_FILE).read_text(encoding="utf-8")).get("category")
    except (OSError, ValueError, AttributeError):
        return None


def find_draft(root: Path, manifest: list[dict], category: str, today_name: str) -> Path | None:
    """Oldest unpublished app folder that was started for this same category."""
    apps = root / APPS_DIR
    if not apps.is_dir():
        return None
    published = {str(e.get("path", "")).strip("/").split("/")[-1] for e in manifest}
    for folder in sorted(apps.iterdir()):
        if (folder.is_dir() and folder.name not in published and folder.name != today_name
                and (folder / "idea.json").exists() and _folder_category(folder) == category):
            return folder
    return None


def _prepare_folder(root: Path, manifest: list[dict], category: str, today: date) -> str | None:
    """Create today's folder, moving in an unfinished draft when one fits. Returns its old name."""
    target = root / APPS_DIR / today.isoformat()
    resumed = None
    if not (target / "idea.json").exists():
        leftovers = [f for f in target.iterdir() if f.name != PLAN_FILE] if target.exists() else []
        draft = None if leftovers else find_draft(root, manifest, category, target.name)
        if draft:
            if target.exists():
                shutil.rmtree(target)
            shutil.move(str(draft), str(target))
            resumed = draft.name
    target.mkdir(parents=True, exist_ok=True)
    (target / PLAN_FILE).write_text(json.dumps({"category": category, "date": today.isoformat()}) + "\n",
                                    encoding="utf-8")
    return resumed


def plan_today(root: Path, today: date) -> dict:
    """Everything the daily run needs to know before it starts brainstorming.

    Also prepares today's folder: if an earlier run stopped part-way through an app of the
    same category, that draft is moved in so today's run finishes it instead of starting over.
    """
    manifest = load_manifest(root)
    category = next_category(manifest)
    folder = f"{APPS_DIR}/{today.isoformat()}/"
    already = any(e.get("date") == today.isoformat() for e in manifest)
    resumed = None if already else _prepare_folder(root, manifest, category, today)
    idea_path = root / folder / "idea.json"
    title = None
    if resumed and idea_path.exists():
        title = json.loads(idea_path.read_text(encoding="utf-8")).get("title")
    return {
        "date": today.isoformat(),
        "folder": folder,
        "already_published": already,
        "day": len(manifest) + 1,
        "category": category,
        "category_brief": CATEGORIES[category],
        "avoid_titles": [e.get("title", "") for e in manifest][-RECENT_TITLES:],
        "resumed_from": resumed,
        "resumed_title": title,
        "existing_files": sorted(f for f in APP_FILES if (root / folder / f).exists()),
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
