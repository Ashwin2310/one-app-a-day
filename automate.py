#!/usr/bin/env python3
"""Daily App Generator: run hourly; on a 1-in-24 roll, build and publish one app.

Phase 1  Claude brainstorms an idea in today's category (problem-solving / design / utility).
Phase 2  Claude builds it as index.html + style.css + script.js.
Phase 3  Screenshot, README write-up, gallery page; one commit to apps/YYYY-MM-DD/.
Phase 4  (optional) Share it on LinkedIn.
"""
from __future__ import annotations

import json
import logging
import random
import sys
from datetime import datetime, timezone

from generator import claude_client, linkedin, prompts, repo as gh, screenshot
from generator.config import (
    APP_MAX_TOKENS, APPS_DIR, BRANCH, CATEGORIES, IDEA_MAX_TOKENS, MANIFEST_PATH, MODEL,
    ROLL_SIDES, PipelineError, env, env_flag,
)
from generator.docs import app_readme, gallery_html, root_readme
from generator.parsing import parse_files, parse_idea

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("daily-app")


def should_run() -> bool:
    if env_flag("FORCE_RUN"):
        log.info("FORCE_RUN=true: skipping the dice roll.")
        return True
    roll = random.SystemRandom().randint(1, ROLL_SIDES)
    log.info("Rolled %d/%d.%s", roll, ROLL_SIDES, "" if roll == 1 else " Not today's slot; exiting.")
    return roll == 1


def pick_category(manifest: list[dict]) -> str:
    """FORCE_CATEGORY wins; otherwise rotate problem-solving -> design -> utility."""
    forced = env("FORCE_CATEGORY")
    if forced in CATEGORIES:
        return forced
    names = list(CATEGORIES)
    return names[len(manifest) % len(names)]


def build_payload(today: str, category: str, idea: dict, app: dict[str, str],
                  png: bytes | None, manifest: list[dict], pages_base: str) -> tuple[dict, dict]:
    folder = f"{APPS_DIR}/{today}/"
    entry = {"day": len(manifest) + 1, "date": today, "title": idea["title"], "tagline": idea["tagline"],
             "category": category, "path": folder, "has_screenshot": png is not None, "model": MODEL}
    new_manifest = [*manifest, entry]
    files: dict[str, str | bytes] = {
        **{f"{folder}{name}": body for name, body in app.items()},
        f"{folder}README.md": app_readme(idea, entry, pages_base + folder),
        f"{folder}idea.json": json.dumps(idea, indent=2) + "\n",
        MANIFEST_PATH: json.dumps(new_manifest, indent=2) + "\n",
        "README.md": root_readme(new_manifest, pages_base),
        "index.html": gallery_html(new_manifest),
        ".nojekyll": "",
    }
    return ({**files, f"{folder}screenshot.png": png} if png else files), entry


def share_on_linkedin(idea: dict, entry: dict, demo_url: str, writeup_url: str, png: bytes | None) -> int:
    if env_flag("SKIP_LINKEDIN") or not linkedin.is_configured():
        log.info("LinkedIn not configured or skipped for this run; not posting.")
        return 0
    try:
        post_id = linkedin.publish(idea, entry, demo_url, writeup_url, png)
    except linkedin.LinkedInError as exc:
        log.error("App was published, but the LinkedIn post failed: %s", exc)
        return 1
    log.info("Posted to LinkedIn: %s", post_id)
    return 0


def run() -> int:
    if not should_run():
        return 0
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    repo = gh.open_repo()
    if gh.path_exists(repo, f"{APPS_DIR}/{today}"):
        log.info("%s/%s already exists; today's app is done.", APPS_DIR, today)
        return 0

    manifest = gh.load_manifest(repo)
    category = pick_category(manifest)
    client = claude_client.make_client()

    log.info("Phase 1: idea (%s) with %s", category, MODEL)
    idea_text = claude_client.ask(client, prompts.IDEA_SYSTEM_PROMPT,
                                  prompts.idea_user_prompt(category, [e.get("title", "") for e in manifest]),
                                  IDEA_MAX_TOKENS)
    idea = parse_idea(idea_text)
    log.info("Idea: %s - %s", idea["title"], idea["tagline"])

    log.info("Phase 2: building the app")
    app = parse_files(claude_client.ask(client, prompts.APP_SYSTEM_PROMPT,
                                        prompts.app_user_prompt(category, idea), APP_MAX_TOKENS))

    log.info("Phase 3: screenshot, write-up and commit")
    png = screenshot.capture(app)
    pages_base = gh.pages_base_url(repo.full_name)
    files, entry = build_payload(today, category, idea, app, png, manifest, pages_base)
    sha = gh.commit_files(repo, files, f"feat: day {entry['day']} - {idea['title']}")
    demo_url = pages_base + entry["path"]
    writeup_url = f"https://github.com/{repo.full_name}/tree/{BRANCH}/{entry['path']}"
    log.info("Committed %s. Demo: %s", sha[:7], demo_url)

    log.info("Phase 4: LinkedIn")
    return share_on_linkedin(idea, entry, demo_url, writeup_url, png)


def main() -> None:
    try:
        sys.exit(run())
    except PipelineError as exc:
        log.error("Pipeline failed: %s", exc)
        sys.exit(1)
    except Exception:  # noqa: BLE001 - last-resort guard so CI shows the traceback
        log.exception("Unexpected error")
        sys.exit(1)


if __name__ == "__main__":
    main()
