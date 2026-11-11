"""Shared settings for the local publish tool."""
from __future__ import annotations

import os
from pathlib import Path


class PipelineError(Exception):
    """A failure that should stop publishing and be shown to whoever is running it."""


def env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


def env_flag(name: str) -> bool:
    return env(name).lower() == "true"


ROOT = Path(__file__).resolve().parent.parent
APPS_DIR = "apps"
MANIFEST_PATH = f"{APPS_DIR}/manifest.json"
REQUIRED_FILES = ("index.html", "style.css", "script.js", "idea.json", "STORYBOARD.md")
BRANCH = env("TARGET_BRANCH", "main")
PAGES_BASE_URL = env("PAGES_BASE_URL", "https://ashwin2310.github.io/one-app-a-day/")
REPO_URL = env("REPO_URL", "https://github.com/Ashwin2310/one-app-a-day")
RECENT_TITLES = 60

# The three kinds of app, rotated one per day.
CATEGORIES: dict[str, str] = {
    "problem-solving": (
        "Problem solving / algorithms / in-browser AI: an interactive tool that solves a real "
        "problem with a clever algorithm or AI technique written from scratch in JavaScript "
        "(pathfinding visualisers, schedulers, optimisers, puzzle solvers, recommenders, text "
        "classifiers, clustering, rule-based assistants). No external AI APIs."
    ),
    "design": (
        "Design / creative coding: something visually stunning built with CSS, Canvas or SVG "
        "(generative art studios, animated pattern makers, palette or gradient designers, "
        "typography playgrounds). The user must be able to create, tweak and export or copy it."
    ),
    "utility": (
        "Utility / everyday productivity: an app people already use, plus clever extra features "
        "the usual version lacks (a to-do list with smart prioritisation, a calorie and macro "
        "tracker, a budget planner, a habit tracker with streak analytics). Saves to "
        "localStorage. Use an ORIGINAL name and branding, never an existing product's."
    ),
}
