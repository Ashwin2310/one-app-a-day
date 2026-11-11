"""Open the app in headless Chromium: collect JS errors, check mobile fit, take a screenshot."""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

DESKTOP = {"width": 1280, "height": 800}
MOBILE = {"width": 360, "height": 740}
SETTLE_MS = 2000
LOAD_TIMEOUT_MS = 20000
OVERFLOW_TOLERANCE_PX = 4


@dataclass(frozen=True)
class SmokeResult:
    errors: tuple[str, ...] = ()
    warnings: tuple[str, ...] = ()
    screenshot: bytes | None = None

    @property
    def ok(self) -> bool:
        return not self.errors


@dataclass
class _Log:
    lines: list[str] = field(default_factory=list)


def _open(browser, url: str, viewport: dict, log: _Log):
    page = browser.new_page(viewport=viewport)
    page.on("pageerror", lambda err: log.lines.append(f"Uncaught JS error: {err}"))
    page.on("console", lambda m: log.lines.append(f"console.error: {m.text}") if m.type == "error" else None)
    page.on("requestfailed", lambda r: log.lines.append(f"Failed to load: {r.url}"))
    page.goto(url, timeout=LOAD_TIMEOUT_MS)
    page.wait_for_timeout(SETTLE_MS)
    return page


def run(folder: Path) -> SmokeResult:
    """Never raises: problems come back as errors/warnings."""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return SmokeResult(errors=("Playwright is not installed (.venv/bin/pip install -r requirements.txt).",))
    url = (folder / "index.html").resolve().as_uri()
    log = _Log()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            desktop = _open(browser, url, DESKTOP, log)
            png = desktop.screenshot(type="png")
            mobile = _open(browser, url, MOBILE, log)
            width = mobile.evaluate("document.documentElement.scrollWidth")
            browser.close()
    except Exception as exc:  # noqa: BLE001 - report, don't crash
        return SmokeResult(errors=(f"Could not open the app in a browser: {exc}",))
    warnings = (f"Page is {width}px wide on a 360px phone (horizontal scroll).",) \
        if width > MOBILE["width"] + OVERFLOW_TOLERANCE_PX else ()
    return SmokeResult(errors=tuple(dict.fromkeys(log.lines)), warnings=warnings, screenshot=png)
