#!/usr/bin/env python3
"""Local publish tool for One App a Day.

  python publish.py plan                 today's date, folder, day number, category, titles to avoid
  python publish.py check  apps/DATE     validate files + headless-browser smoke test (no changes)
  python publish.py publish apps/DATE    check, then README + screenshot + gallery, commit, push,
                                         and post to LinkedIn if LINKEDIN_ACCESS_TOKEN is set
Flags: --no-push (write files but don't commit/push), --category NAME (override rotation).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date
from pathlib import Path

from generator import gitops, linkedin, smoke
from generator.config import (
    CATEGORIES, PAGES_BASE_URL, REPO_URL, REQUIRED_FILES, ROOT, BRANCH, PipelineError, env,
)
from generator.parsing import parse_idea
from generator.site import build_entry, load_manifest, next_category, plan_today, write_site


def load_dotenv(path: Path) -> None:
    """Read KEY=VALUE lines from .env into the environment (existing values win)."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        key, sep, value = line.strip().partition("=")
        if sep and key and not key.startswith("#"):
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def validate_folder(folder: Path) -> dict:
    """Required files exist and are non-empty, assets are linked; returns the parsed idea."""
    if not folder.is_dir():
        raise PipelineError(f"{folder} does not exist.")
    empty = [n for n in REQUIRED_FILES if not (folder / n).is_file() or not (folder / n).read_text(encoding="utf-8").strip()]
    if empty:
        raise PipelineError(f"Missing or empty files in {folder}: {', '.join(empty)}")
    html = (folder / "index.html").read_text(encoding="utf-8")
    unlinked = [n for n in ("style.css", "script.js") if n not in html]
    if unlinked:
        raise PipelineError(f"index.html does not load: {', '.join(unlinked)}")
    return parse_idea((folder / "idea.json").read_text(encoding="utf-8"))


def check(folder: Path) -> smoke.SmokeResult:
    validate_folder(folder)
    result = smoke.run(folder)
    for w in result.warnings:
        print(f"WARNING: {w}")
    if not result.ok:
        raise PipelineError("Smoke test failed:\n  " + "\n  ".join(result.errors))
    print(f"CHECK OK: {folder.name} loads with no errors.")
    return result


def publish(folder: Path, push: bool, category: str | None) -> int:
    result = check(folder)
    idea = validate_folder(folder)
    manifest = load_manifest(ROOT)
    if any(e.get("date") == folder.name for e in manifest):
        raise PipelineError(f"{folder.name} is already published.")
    entry = build_entry(manifest, folder.name, category or next_category(manifest), idea, result.screenshot is not None)
    write_site(ROOT, manifest, entry, idea, result.screenshot, PAGES_BASE_URL)
    demo_url, writeup_url = PAGES_BASE_URL + entry["path"], f"{REPO_URL}/tree/{BRANCH}/{entry['path']}"
    if not push:
        print(f"Wrote site files (not pushed). Demo will be {demo_url}")
        return 0
    paths = [entry["path"], "apps/manifest.json", "README.md", "index.html", ".nojekyll"]
    sha = gitops.commit_and_push(ROOT, paths, f"feat: day {entry['day']} - {idea['title']}")
    print(f"PUBLISHED {sha}: {demo_url}\nWrite-up: {writeup_url}")
    return post_linkedin(idea, entry, demo_url, writeup_url, result.screenshot)


def post_linkedin(idea: dict, entry: dict, demo_url: str, writeup_url: str, png: bytes | None) -> int:
    if not linkedin.is_configured():
        print("LinkedIn: no LINKEDIN_ACCESS_TOKEN in .env, skipping.")
        return 0
    try:
        print(f"LinkedIn: posted {linkedin.publish(idea, entry, demo_url, writeup_url, png)}")
        return 0
    except linkedin.LinkedInError as exc:
        print(f"LinkedIn post FAILED (app is still published): {exc}")
        return 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["plan", "check", "publish"])
    parser.add_argument("folder", nargs="?")
    parser.add_argument("--no-push", action="store_true")
    parser.add_argument("--category", choices=list(CATEGORIES))
    args = parser.parse_args(argv)
    load_dotenv(ROOT / ".env")
    try:
        if args.command == "plan":
            if env("SKIP_SYNC").lower() != "true":
                gitops.sync(ROOT)
            print(json.dumps(plan_today(ROOT, date.today()), indent=2))
            return 0
        if not args.folder:
            raise PipelineError(f"'{args.command}' needs a folder, e.g. apps/{date.today().isoformat()}")
        folder = (ROOT / args.folder).resolve()
        if args.command == "check":
            check(folder)
            return 0
        return publish(folder, push=not args.no_push, category=args.category)
    except PipelineError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
