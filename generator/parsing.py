"""Turn Claude's raw text replies into validated Python data."""
from __future__ import annotations

import json
import logging
import re

from .config import REQUIRED_FILES, PipelineError

log = logging.getLogger("daily-app")

FILE_HEADER = re.compile(r"^\s*\[FILE:\s*([\w.\-]+)\s*\]\s*$", re.MULTILINE)
FENCE_LINE = re.compile(r"^\s*```[\w-]*\s*$")

IDEA_TEXT_FIELDS = ("title", "tagline", "problem", "audience", "solution", "linkedin_hook")
IDEA_LIST_FIELDS = ("how_it_works", "features", "tech_highlights", "try_it")
MAX_TEXT_CHARS = 600
MAX_LIST_ITEMS = 8


def strip_fences(body: str) -> str:
    """Drop stray markdown fence lines at the start/end of a block."""
    lines = body.strip("\n").splitlines()
    while lines and FENCE_LINE.match(lines[0]):
        lines = lines[1:]
    while lines and FENCE_LINE.match(lines[-1]):
        lines = lines[:-1]
    return "\n".join(lines).strip() + "\n"


def parse_idea(reply: str) -> dict:
    """Parse and validate the idea JSON; returns a new clean dict."""
    start, end = reply.find("{"), reply.rfind("}")
    if start == -1 or end <= start:
        raise PipelineError("Idea reply contained no JSON object.")
    try:
        raw = json.loads(reply[start:end + 1])
    except json.JSONDecodeError as exc:
        raise PipelineError(f"Idea reply was not valid JSON: {exc}") from exc
    if not isinstance(raw, dict):
        raise PipelineError("Idea JSON must be an object.")

    texts = {k: str(raw.get(k) or "").strip()[:MAX_TEXT_CHARS] for k in IDEA_TEXT_FIELDS}
    lists = {
        k: [str(item).strip() for item in raw.get(k) or [] if str(item).strip()][:MAX_LIST_ITEMS]
        for k in IDEA_LIST_FIELDS
    }
    missing = [k for k, v in {**texts, **lists}.items() if not v]
    if missing:
        raise PipelineError(f"Idea JSON is missing fields: {', '.join(missing)}")
    return {**texts, **lists}


def parse_files(reply: str) -> dict[str, str]:
    """Split '[FILE: name]' blocks into {name: contents}; require all three files."""
    headers = list(FILE_HEADER.finditer(reply))
    if not headers:
        raise PipelineError("No [FILE: ...] blocks found in Claude's reply.")
    files: dict[str, str] = {}
    for i, header in enumerate(headers):
        end = headers[i + 1].start() if i + 1 < len(headers) else len(reply)
        name = header.group(1).lower()
        if name in REQUIRED_FILES and name not in files:
            files = {**files, name: strip_fences(reply[header.end():end])}
    missing = [n for n in REQUIRED_FILES if not files.get(n, "").strip()]
    if missing:
        raise PipelineError(f"Reply is missing or has empty files: {', '.join(missing)}")
    return {**files, "index.html": ensure_asset_links(files["index.html"])}


def ensure_asset_links(html: str) -> str:
    """Return HTML that is guaranteed to load style.css and script.js."""
    result = html
    if "style.css" not in result:
        tag = '<link rel="stylesheet" href="style.css">\n'
        result = result.replace("</head>", tag + "</head>", 1) if "</head>" in result else tag + result
        log.warning("index.html did not link style.css; injected it.")
    if "script.js" not in result:
        tag = '<script src="script.js" defer></script>\n'
        result = result.replace("</body>", tag + "</body>", 1) if "</body>" in result else result + tag
        log.warning("index.html did not load script.js; injected it.")
    return result
