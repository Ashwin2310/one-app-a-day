"""Share the day's app on LinkedIn through the official Posts API (optional).

Needs LINKEDIN_ACCESS_TOKEN with scopes: openid, profile, w_member_social.
Tokens from LinkedIn's token generator last 60 days, then must be regenerated.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timezone

import requests

from .config import env

log = logging.getLogger("daily-app")

API = "https://api.linkedin.com"
TIMEOUT_SECONDS = 30
HASHTAGS = ("buildinpublic", "webdev", "javascript", "100DaysOfCode")
# Characters LinkedIn's "little text" commentary format treats as markup.
RESERVED = re.compile(r"([\\|{}@\[\]()<>#*_~])")


class LinkedInError(Exception):
    """LinkedIn rejected or could not receive the post."""


def is_configured() -> bool:
    return bool(env("LINKEDIN_ACCESS_TOKEN"))


def api_version(now: datetime | None = None) -> str:
    """LinkedIn wants a 'YYYYMM' version header; default to two months ago (always live)."""
    override = env("LINKEDIN_API_VERSION")
    if override:
        return override
    now = now or datetime.now(timezone.utc)
    total = now.year * 12 + (now.month - 1) - 2
    return f"{total // 12}{total % 12 + 1:02d}"


def escape(text: str) -> str:
    return RESERVED.sub(r"\\\1", text)


def build_commentary(idea: dict, entry: dict, demo_url: str, writeup_url: str) -> str:
    tags = " ".join("{hashtag|\\#|" + tag + "}" for tag in HASHTAGS)
    body = (
        f"{idea['linkedin_hook']}\n\n"
        f"Day {entry['day']} of building one web app every day with AI: {idea['title']}\n"
        f"{idea['tagline']}\n\n"
        f"The problem: {idea['problem']}\n\n"
        f"How it solves it: {idea['solution']}\n\n"
        f"Try it live: {demo_url}\n"
        f"Write-up and code: {writeup_url}\n\n"
    )
    return escape(body) + tags


def _headers(token: str, json_body: bool = True) -> dict[str, str]:
    headers = {
        "Authorization": f"Bearer {token}",
        "LinkedIn-Version": api_version(),
        "X-Restli-Protocol-Version": "2.0.0",
    }
    return {**headers, "Content-Type": "application/json"} if json_body else headers


def _check(resp: requests.Response, action: str) -> requests.Response:
    if resp.ok:
        return resp
    hints = {
        401: "token is invalid or expired (they last 60 days). Generate a new one.",
        403: "token lacks w_member_social. Add 'Share on LinkedIn' and regenerate the token.",
        426: "LinkedIn-Version is no longer supported. Set LINKEDIN_API_VERSION.",
    }
    hint = hints.get(resp.status_code, resp.text[:300])
    raise LinkedInError(f"{action} failed ({resp.status_code}): {hint}")


def _request(method: str, url: str, action: str, **kwargs) -> requests.Response:
    try:
        resp = requests.request(method, url, timeout=TIMEOUT_SECONDS, **kwargs)
    except requests.RequestException as exc:
        raise LinkedInError(f"{action} failed: could not reach LinkedIn ({exc})") from exc
    return _check(resp, action)


def person_urn(token: str) -> str:
    configured = env("LINKEDIN_PERSON_URN")
    if configured:
        return configured
    resp = _request("GET", f"{API}/v2/userinfo", "Looking up your LinkedIn ID",
                    headers={"Authorization": f"Bearer {token}"})
    return f"urn:li:person:{resp.json()['sub']}"


def upload_image(token: str, author: str, png: bytes) -> str | None:
    """Upload the screenshot; returns an image URN or None (post still goes out without it)."""
    try:
        init = _request("POST", f"{API}/rest/images?action=initializeUpload", "Image upload setup",
                        headers=_headers(token), json={"initializeUploadRequest": {"owner": author}})
        value = init.json()["value"]
        _request("PUT", value["uploadUrl"], "Image upload",
                 headers={"Authorization": f"Bearer {token}"}, data=png)
        return value["image"]
    except (LinkedInError, KeyError, ValueError) as exc:
        log.warning("LinkedIn image upload skipped: %s", exc)
        return None


def publish(idea: dict, entry: dict, demo_url: str, writeup_url: str, png: bytes | None) -> str:
    """Create a public LinkedIn post with a link card; returns the post URN."""
    token = env("LINKEDIN_ACCESS_TOKEN")
    author = person_urn(token)
    image = upload_image(token, author, png) if png else None
    article = {"source": demo_url, "title": idea["title"], "description": idea["tagline"]}
    body = {
        "author": author,
        "commentary": build_commentary(idea, entry, demo_url, writeup_url),
        "visibility": env("LINKEDIN_VISIBILITY", "PUBLIC"),
        "distribution": {"feedDistribution": "MAIN_FEED", "targetEntities": [],
                         "thirdPartyDistributionChannels": []},
        "content": {"article": {**article, **({"thumbnail": image} if image else {})}},
        "lifecycleState": "PUBLISHED",
        "isReshareDisabledByAuthor": False,
    }
    resp = _request("POST", f"{API}/rest/posts", "Publishing LinkedIn post", headers=_headers(token), json=body)
    return resp.headers.get("x-restli-id", "(id not returned)")
