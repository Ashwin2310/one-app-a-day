"""End-to-end run() with fake Claude, GitHub and LinkedIn: no network, no real tokens."""
from __future__ import annotations

import json
from types import SimpleNamespace

import pytest
import requests
from github import GithubException

import automate
from generator import claude_client, linkedin, repo as gh

IDEA_JSON = json.dumps({
    "title": "Grid Fox", "tagline": "A* made visible", "problem": "p", "audience": "a",
    "solution": "s", "how_it_works": ["h"], "features": ["f"], "tech_highlights": ["t"],
    "try_it": ["x"], "linkedin_hook": "hook",
})
APP_REPLY = "[FILE: index.html]\n<html><head></head><body></body></html>\n" \
            "[FILE: style.css]\nbody{}\n[FILE: script.js]\nlet a=1\n"


class FakeStream:
    def __init__(self, text, stop="end_turn"):
        block = SimpleNamespace(type="text", text=text)
        self.msg = SimpleNamespace(content=[block], stop_reason=stop, usage=SimpleNamespace(output_tokens=9))

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def get_final_message(self):
        return self.msg


class FakeClient:
    def __init__(self, replies):
        self.replies = list(replies)
        self.messages = SimpleNamespace(stream=lambda **kw: FakeStream(self.replies.pop(0)))


class FakeRepo:
    full_name = "Me/one-app"

    def __init__(self, existing=()):
        self.existing, self.trees, self.ref_sha = set(existing), [], "base"

    def get_contents(self, path, ref):
        if path in self.existing:
            return SimpleNamespace(decoded_content=b"[]")
        raise GithubException(404, {"message": "Not Found"}, None)

    def create_git_blob(self, content, encoding):
        return SimpleNamespace(sha="blobsha")

    def get_git_ref(self, name):
        return SimpleNamespace(object=SimpleNamespace(sha=self.ref_sha),
                               edit=lambda sha: setattr(self, "ref_sha", sha))

    def get_git_commit(self, sha):
        return SimpleNamespace(tree="tree0", sha=sha)

    def create_git_tree(self, elements, base_tree):
        self.trees.append(elements)
        return "tree1"

    def create_git_commit(self, message, tree, parents):
        return SimpleNamespace(sha="newcommit123")


class FakeResp:
    def __init__(self, status=200, body=None, headers=None):
        self.status_code, self._body, self.headers = status, body or {}, headers or {}
        self.ok, self.text = status < 400, json.dumps(body or {})

    def json(self):
        return self._body


@pytest.fixture
def wired(monkeypatch):
    fake_repo = FakeRepo()
    monkeypatch.setenv("FORCE_RUN", "true")
    monkeypatch.delenv("FORCE_CATEGORY", raising=False)
    monkeypatch.delenv("SKIP_LINKEDIN", raising=False)
    monkeypatch.setattr(gh, "open_repo", lambda: fake_repo)
    monkeypatch.setattr(claude_client, "make_client", lambda: FakeClient([IDEA_JSON, APP_REPLY]))
    monkeypatch.setattr(automate.screenshot, "capture", lambda files: b"PNG")
    return fake_repo


def test_full_run_commits_and_posts(wired, monkeypatch):
    calls = []

    def fake_request(method, url, **kw):
        calls.append((method, url))
        if url.endswith("/v2/userinfo"):
            return FakeResp(body={"sub": "abc"})
        if "initializeUpload" in url:
            return FakeResp(body={"value": {"uploadUrl": "https://up", "image": "urn:li:image:1"}})
        if url.endswith("/rest/posts"):
            assert kw["json"]["content"]["article"]["thumbnail"] == "urn:li:image:1"
            assert kw["json"]["author"] == "urn:li:person:abc"
            return FakeResp(201, headers={"x-restli-id": "urn:li:share:9"})
        return FakeResp()

    monkeypatch.setenv("LINKEDIN_ACCESS_TOKEN", "t")
    monkeypatch.delenv("LINKEDIN_PERSON_URN", raising=False)
    monkeypatch.setattr(requests, "request", fake_request)
    assert automate.run() == 0
    paths = {e._InputGitTreeElement__path for e in wired.trees[0]}
    assert {"README.md", "index.html", "apps/manifest.json"} <= paths
    assert wired.ref_sha == "newcommit123"
    assert [m for m, _ in calls] == ["GET", "POST", "PUT", "POST"]


def test_expired_linkedin_token_fails_job_after_commit(wired, monkeypatch):
    monkeypatch.setenv("LINKEDIN_ACCESS_TOKEN", "t")
    monkeypatch.setenv("LINKEDIN_PERSON_URN", "urn:li:person:x")
    monkeypatch.setattr(requests, "request", lambda m, u, **kw: FakeResp(401))
    assert automate.run() == 1
    assert wired.ref_sha == "newcommit123"  # app still published


def test_skips_linkedin_when_not_configured(wired, monkeypatch):
    monkeypatch.delenv("LINKEDIN_ACCESS_TOKEN", raising=False)
    assert automate.run() == 0


def test_exits_when_today_already_exists(monkeypatch):
    from datetime import datetime, timezone
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    monkeypatch.setenv("FORCE_RUN", "true")
    monkeypatch.setattr(gh, "open_repo", lambda: FakeRepo(existing={f"apps/{today}"}))
    assert automate.run() == 0


def test_roll_exits_early(monkeypatch):
    monkeypatch.delenv("FORCE_RUN", raising=False)
    monkeypatch.setattr(automate.random.SystemRandom, "randint", lambda self, a, b: 7)
    assert automate.should_run() is False


def test_main_turns_pipeline_error_into_exit_1(monkeypatch):
    def boom():
        raise automate.PipelineError("x")
    monkeypatch.setattr(automate, "run", boom)
    with pytest.raises(SystemExit) as exc:
        automate.main()
    assert exc.value.code == 1


def test_claude_truncated_reply_is_an_error():
    client = SimpleNamespace(messages=SimpleNamespace(stream=lambda **kw: FakeStream("x", "max_tokens")))
    with pytest.raises(automate.PipelineError, match="cut off"):
        claude_client.ask(client, "s", "u", 10)


def test_missing_secrets_are_reported(monkeypatch):
    monkeypatch.delenv("PAT_TOKEN", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    with pytest.raises(automate.PipelineError, match="PAT_TOKEN"):
        gh.open_repo()
    with pytest.raises(automate.PipelineError, match="ANTHROPIC_API_KEY"):
        claude_client.make_client()


def test_linkedin_image_failure_still_posts(monkeypatch):
    monkeypatch.setattr(requests, "request", lambda m, u, **kw: FakeResp(500))
    assert linkedin.upload_image("t", "urn:li:person:x", b"PNG") is None
