"""Read from and commit to the GitHub repository with PyGithub."""
from __future__ import annotations

import base64
import json
import logging

from github import Auth, Github, GithubException, InputGitTreeElement

from .config import BRANCH, COMMIT_ATTEMPTS, MANIFEST_PATH, PipelineError, env

log = logging.getLogger("daily-app")


def open_repo():
    token, name = env("PAT_TOKEN"), env("GITHUB_REPOSITORY")
    if not token:
        raise PipelineError("PAT_TOKEN is not set.")
    if not name:
        raise PipelineError("GITHUB_REPOSITORY is not set (expected 'owner/repo').")
    try:
        return Github(auth=Auth.Token(token)).get_repo(name)
    except GithubException as exc:
        raise PipelineError(f"Cannot open repo {name}: {exc.status} {exc.data}") from exc


def pages_base_url(repo_full_name: str) -> str:
    """Public GitHub Pages address for the repo, ending in '/'."""
    override = env("PAGES_BASE_URL")
    if override:
        return override.rstrip("/") + "/"
    owner, name = repo_full_name.split("/", 1)
    if name.lower() == f"{owner.lower()}.github.io":
        return f"https://{owner.lower()}.github.io/"
    return f"https://{owner.lower()}.github.io/{name}/"


def path_exists(repo, path: str) -> bool:
    try:
        repo.get_contents(path, ref=BRANCH)
        return True
    except GithubException as exc:
        if exc.status == 404:
            return False
        raise PipelineError(f"GitHub error checking {path}: {exc.status} {exc.data}") from exc


def load_manifest(repo) -> list[dict]:
    try:
        raw = repo.get_contents(MANIFEST_PATH, ref=BRANCH).decoded_content
    except GithubException as exc:
        if exc.status == 404:
            return []
        raise PipelineError(f"GitHub error reading manifest: {exc.status} {exc.data}") from exc
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        log.warning("%s is not valid JSON; starting a fresh manifest.", MANIFEST_PATH)
        return []
    return [e for e in data if isinstance(e, dict)] if isinstance(data, list) else []


def _tree_element(repo, path: str, content: str | bytes) -> InputGitTreeElement:
    if isinstance(content, bytes):
        blob = repo.create_git_blob(base64.b64encode(content).decode("ascii"), "base64")
        return InputGitTreeElement(path=path, mode="100644", type="blob", sha=blob.sha)
    return InputGitTreeElement(path=path, mode="100644", type="blob", content=content)


def commit_files(repo, files: dict[str, str | bytes], message: str) -> str:
    """Commit every file in one atomic commit on BRANCH; retry if the branch moved."""
    last_error: GithubException | None = None
    for attempt in range(1, COMMIT_ATTEMPTS + 1):
        try:
            elements = [_tree_element(repo, p, c) for p, c in files.items()]
            ref = repo.get_git_ref(f"heads/{BRANCH}")
            parent = repo.get_git_commit(ref.object.sha)
            tree = repo.create_git_tree(elements, base_tree=parent.tree)
            commit = repo.create_git_commit(message, tree, [parent])
            ref.edit(commit.sha)
            return commit.sha
        except GithubException as exc:
            last_error = exc
            log.warning("Commit attempt %d/%d failed: %s %s", attempt, COMMIT_ATTEMPTS, exc.status, exc.data)
            if exc.status in (401, 403, 404):
                break  # auth / permission / missing branch: retrying will not help
    status = last_error.status if last_error else "?"
    raise PipelineError(f"Could not commit to {BRANCH} ({status}). Check PAT_TOKEN has Contents: write.")
