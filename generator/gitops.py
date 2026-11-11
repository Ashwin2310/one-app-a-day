"""Commit and push with the local git (uses the machine's existing GitHub login)."""
from __future__ import annotations

import subprocess
from pathlib import Path

from .config import BRANCH, PipelineError

TIMEOUT_SECONDS = 120


def _git(root: Path, *args: str) -> str:
    try:
        done = subprocess.run(["git", *args], cwd=root, capture_output=True, text=True,
                              timeout=TIMEOUT_SECONDS, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise PipelineError(f"git {args[0]} could not run: {exc}") from exc
    if done.returncode != 0:
        raise PipelineError(f"git {' '.join(args)} failed: {done.stderr.strip() or done.stdout.strip()}")
    return done.stdout.strip()


def sync(root: Path) -> None:
    """Bring the local checkout up to date before building."""
    _git(root, "pull", "--rebase", "--quiet", "origin", BRANCH)


def commit_and_push(root: Path, paths: list[str], message: str) -> str:
    _git(root, "add", "--", *paths)
    _git(root, "commit", "--quiet", "-m", message)
    _git(root, "push", "--quiet", "origin", BRANCH)
    return _git(root, "rev-parse", "--short", "HEAD")
