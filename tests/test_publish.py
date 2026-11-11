"""Tests for the local publish tool. Uses real headless Chromium and a real local git remote."""
from __future__ import annotations

import json
import subprocess
from datetime import date, datetime, timezone
from pathlib import Path

import pytest
import requests

import publish
from generator import gitops, linkedin, smoke
from generator.config import PipelineError
from generator.docs import app_readme, gallery_html
from generator.parsing import parse_idea
from generator.site import load_manifest, next_category, plan_today

IDEA = {
    "title": "Route <Fox>", "tagline": "Find the fastest path (with A*)",
    "problem": "Mazes are hard.", "audience": "Students", "solution": "Visualise A*.",
    "how_it_works": ["Grid", "Heuristic"], "features": ["Walls", "Speed slider"],
    "tech_highlights": ["Binary heap"], "try_it": ["Draw walls", "Press Run"],
    "linkedin_hook": "What if pathfinding was fun?",
}
GOOD_HTML = ('<!doctype html><html><head><meta name="viewport" content="width=device-width">'
             '<link rel="stylesheet" href="style.css"></head><body><h1>Hi</h1>'
             '<script src="script.js" defer></script></body></html>')


def make_app(root: Path, day: str = "2026-11-11", js: str = "document.title='ok'") -> Path:
    folder = root / "apps" / day
    folder.mkdir(parents=True)
    (folder / "index.html").write_text(GOOD_HTML)
    (folder / "style.css").write_text("body{margin:0}")
    (folder / "script.js").write_text(js)
    (folder / "idea.json").write_text(json.dumps(IDEA))
    (folder / "STORYBOARD.md").write_text("# Storyboard\n")
    return folder


def git(cwd: Path, *args: str) -> str:
    return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True).stdout


@pytest.fixture
def repo(tmp_path, monkeypatch):
    """A working checkout of a local bare 'GitHub' remote."""
    remote, work = tmp_path / "remote.git", tmp_path / "work"
    git(tmp_path, "init", "-q", "--bare", "-b", "main", str(remote))
    git(tmp_path, "clone", "-q", str(remote), str(work))
    git(work, "config", "user.email", "t@example.com")
    git(work, "config", "user.name", "Test")
    (work / "seed.txt").write_text("seed")
    git(work, "add", ".")
    git(work, "commit", "-qm", "seed")
    git(work, "push", "-q", "origin", "main")
    monkeypatch.setattr(publish, "ROOT", work)
    monkeypatch.delenv("LINKEDIN_ACCESS_TOKEN", raising=False)
    return work, remote


def test_parse_idea_validation():
    assert parse_idea(json.dumps(IDEA))["title"] == "Route <Fox>"
    with pytest.raises(PipelineError, match="features"):
        parse_idea(json.dumps({**IDEA, "features": []}))
    with pytest.raises(PipelineError, match="not valid JSON"):
        parse_idea("{nope")
    with pytest.raises(PipelineError, match="object"):
        parse_idea("[]")


def test_plan_rotates_categories_and_flags_published(tmp_path):
    assert [next_category([{}] * n) for n in range(4)] == ["problem-solving", "design", "utility", "problem-solving"]
    (tmp_path / "apps").mkdir()
    (tmp_path / "apps/manifest.json").write_text(json.dumps([{"date": "2026-11-11", "title": "A"}]))
    plan = plan_today(tmp_path, date(2026, 11, 11))
    assert plan["already_published"] and plan["day"] == 2 and plan["category"] == "design"
    assert plan["avoid_titles"] == ["A"] and plan["folder"] == "apps/2026-11-11/"
    (tmp_path / "apps/manifest.json").write_text("{bad")
    with pytest.raises(PipelineError, match="corrupt"):
        load_manifest(tmp_path)


def test_validate_folder_errors(tmp_path):
    with pytest.raises(PipelineError, match="does not exist"):
        publish.validate_folder(tmp_path / "nope")
    folder = make_app(tmp_path)
    (folder / "STORYBOARD.md").write_text("  ")
    with pytest.raises(PipelineError, match="STORYBOARD.md"):
        publish.validate_folder(folder)
    (folder / "STORYBOARD.md").write_text("x")
    (folder / "index.html").write_text("<html></html>")
    with pytest.raises(PipelineError, match="style.css, script.js"):
        publish.validate_folder(folder)


def test_smoke_catches_js_errors_and_overflow(tmp_path):
    good = smoke.run(make_app(tmp_path, "2026-01-01"))
    assert good.ok and good.screenshot.startswith(b"\x89PNG") and not good.warnings
    bad = smoke.run(make_app(tmp_path, "2026-01-02", js="document.body.style.width='900px'; undefinedFn()"))
    assert not bad.ok and "undefinedFn" in bad.errors[0]
    assert bad.warnings and "360px" in bad.warnings[0]
    with pytest.raises(PipelineError, match="Smoke test failed"):
        publish.check(tmp_path / "apps/2026-01-02")


def test_publish_commits_and_pushes_everything(repo):
    work, remote = repo
    make_app(work)
    assert publish.main(["publish", "apps/2026-11-11"]) == 0
    files = git(remote, "ls-tree", "-r", "--name-only", "main").split()
    for f in ("apps/2026-11-11/README.md", "apps/2026-11-11/screenshot.png", "apps/2026-11-11/STORYBOARD.md",
              "apps/manifest.json", "README.md", "index.html", ".nojekyll"):
        assert f in files
    readme = (work / "apps/2026-11-11/README.md").read_text()
    assert "## The problem" in readme and "STORYBOARD.md" in readme
    assert "day 1 - Route <Fox>" in git(remote, "log", "-1", "--format=%s", "main")
    assert publish.main(["publish", "apps/2026-11-11"]) == 1  # already published


def test_publish_no_push_and_cli_errors(repo, capsys):
    work, remote = repo
    make_app(work)
    assert publish.main(["publish", "apps/2026-11-11", "--no-push", "--category", "utility"]) == 0
    assert json.loads((work / "apps/manifest.json").read_text())[0]["category"] == "utility"
    assert "apps/" not in git(remote, "ls-tree", "-r", "--name-only", "main")
    assert publish.main(["check"]) == 1
    assert "needs a folder" in capsys.readouterr().err


def test_plan_command_syncs(repo, capsys):
    assert publish.main(["plan"]) == 0
    assert json.loads(capsys.readouterr().out)["category"] == "problem-solving"


def test_push_failure_is_reported(repo):
    work, _ = repo
    git(work, "remote", "set-url", "origin", str(work / "missing.git"))
    make_app(work)
    assert publish.main(["publish", "apps/2026-11-11"]) == 1
    with pytest.raises(PipelineError, match="push"):
        gitops._git(work, "push", "origin", "main")


def test_dotenv_loader(tmp_path, monkeypatch):
    monkeypatch.delenv("ZZ_TEST", raising=False)
    (tmp_path / ".env").write_text("# comment\nZZ_TEST='abc'\nnoequals\n")
    publish.load_dotenv(tmp_path / ".env")
    import os
    assert os.environ["ZZ_TEST"] == "abc"


def test_linkedin_formatting_and_failure(monkeypatch):
    monkeypatch.delenv("LINKEDIN_API_VERSION", raising=False)
    text = linkedin.build_commentary(IDEA, {"day": 3}, "https://x.io/a_b/", "https://g/c")
    assert "\\(with A\\*\\)" in text and "Route \\<Fox\\>" in text and "a\\_b" in text
    assert text.endswith("{hashtag|\\#|100DaysOfCode}")
    assert linkedin.api_version(datetime(2026, 1, 5, tzinfo=timezone.utc)) == "202511"
    monkeypatch.setenv("LINKEDIN_ACCESS_TOKEN", "t")
    monkeypatch.setenv("LINKEDIN_PERSON_URN", "urn:li:person:x")

    class Resp:
        status_code, ok, text, headers = 401, False, "", {}
    monkeypatch.setattr(requests, "request", lambda *a, **k: Resp())
    assert publish.post_linkedin(IDEA, {"day": 1}, "u", "w", None) == 1


def test_docs_escape_and_storyboard_link():
    entry = {"day": 1, "date": "d", "category": "utility", "has_screenshot": False}
    assert "screenshot.png" not in app_readme(IDEA, entry, "u")
    page = gallery_html([{**entry, "title": "<b>x</b>", "path": "p/"}])
    assert "&lt;b&gt;" in page and "No preview" in page
