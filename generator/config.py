"""Settings, read once from environment variables (all optional except the secrets)."""
from __future__ import annotations

import os


class PipelineError(Exception):
    """A failure that should stop the run and mark the GitHub Actions job red."""


def env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


def env_flag(name: str) -> bool:
    return env(name).lower() == "true"


MODEL = env("ANTHROPIC_MODEL", "claude-sonnet-5-5")
BRANCH = env("TARGET_BRANCH", "main")
ROLL_SIDES = 24
APPS_DIR = "apps"
MANIFEST_PATH = f"{APPS_DIR}/manifest.json"
REQUIRED_FILES = ("index.html", "style.css", "script.js")
RECENT_IDEAS_IN_PROMPT = 60
IDEA_MAX_TOKENS = 3000
APP_MAX_TOKENS = 32000
API_TIMEOUT_SECONDS = 600.0
API_MAX_RETRIES = 4
COMMIT_ATTEMPTS = 3

# The three kinds of app the generator rotates through, one per day.
CATEGORIES: dict[str, str] = {
    "problem-solving": (
        "Problem solving / algorithms / in-browser AI. An interactive tool that solves a real "
        "problem with a clever algorithm or AI technique implemented from scratch in JavaScript: "
        "e.g. pathfinding visualisers, schedulers, optimisers, puzzle solvers, recommendation "
        "engines, text classifiers, clustering, rule-based assistants. No external AI APIs."
    ),
    "design": (
        "Design / creative coding. Something visually stunning built with CSS, Canvas or SVG: "
        "e.g. generative art studios, animated pattern makers, palette or gradient designers, "
        "typography playgrounds, interactive 3D-looking CSS scenes. Must let the user create, "
        "tweak and export or copy their design."
    ),
    "utility": (
        "Utility / everyday productivity. A practical app that people already use, but with "
        "clever extra features the usual version lacks: e.g. a to-do list with smart "
        "prioritisation, a calorie and macro tracker, a budget planner, a habit tracker with "
        "streak analytics. Saves data in localStorage. Use an ORIGINAL name and branding, "
        "never the name or logo of an existing product."
    ),
}
