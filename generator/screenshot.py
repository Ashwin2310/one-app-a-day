"""Take a PNG screenshot of the generated app with headless Chromium (optional, non-fatal)."""
from __future__ import annotations

import logging
import tempfile
from pathlib import Path

log = logging.getLogger("daily-app")

VIEWPORT = {"width": 1280, "height": 800}
SETTLE_MS = 2000
LOAD_TIMEOUT_MS = 20000


def capture(files: dict[str, str]) -> bytes | None:
    """Render the app from a temp folder and return PNG bytes, or None if anything fails."""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        log.warning("Playwright not installed; skipping screenshot.")
        return None
    try:
        with tempfile.TemporaryDirectory() as tmp:
            for name, content in files.items():
                (Path(tmp) / name).write_text(content, encoding="utf-8")
            with sync_playwright() as p:
                browser = p.chromium.launch()
                page = browser.new_page(viewport=VIEWPORT)
                page.on("pageerror", lambda err: log.warning("App JS error: %s", err))
                page.goto((Path(tmp) / "index.html").as_uri(), timeout=LOAD_TIMEOUT_MS)
                page.wait_for_timeout(SETTLE_MS)
                png = page.screenshot(type="png")
                browser.close()
        log.info("Screenshot captured (%d KB).", len(png) // 1024)
        return png
    except Exception as exc:  # noqa: BLE001 - a screenshot must never break the run
        log.warning("Screenshot failed, continuing without it: %s", exc)
        return None
