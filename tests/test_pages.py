"""Page smoke test: serve web/, open every page in headless Chrome at desktop and phone width,
fail on console errors / page errors / horizontal scrolling, and save screenshots.

    python tests/test_pages.py        (first time: python -m playwright install chromium)

Screenshots go to tests/screenshots/.
"""
import functools
import http.server
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SHOTS = ROOT / "tests" / "screenshots"
PAGES = ["index", "overview", "supply-demand", "simulator", "recommendations", "ask", "bus-times", "tracker"]
SIZES = {"desktop": (1366, 900), "phone": (390, 844)}


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def interact(page, name):
    """Click the main buttons so their code paths run too."""
    if name == "simulator":
        page.click("#sim-preset")
        page.wait_for_selector("#sim-note b")
    elif name == "recommendations":
        page.evaluate("window.print = () => {}")   # no print dialog in tests
        page.click("#report-btn")
        assert "Management report" in page.text_content("#report")
    elif name == "ask":
        for chip in page.query_selector_all("#chips button"):
            chip.click()
        page.fill("#ask-input", "what is the price of a ticket?")
        page.press("#ask-input", "Enter")
        page.wait_for_function("document.querySelectorAll('.msg.bot').length >= 6")
        assert "can't answer" in page.inner_text(".msg.bot:last-child")
    elif name == "bus-times":
        page.click("#bt-tabs [data-s=Sunday]")
        page.select_option("#bt-controls [name=from]", "Mosque")
        page.wait_for_selector("text=No shuttle on Sunday")
        page.click("#bt-tabs [data-s='Mon - Fri']")
    elif name == "tracker":
        page.click("#tk-play")
        page.wait_for_timeout(1500)
        assert page.query_selector_all("#eta-board tbody tr"), "empty arrivals board"
        page.click("#tk-play")


def main():
    SHOTS.mkdir(parents=True, exist_ok=True)
    handler = functools.partial(QuietHandler, directory=str(ROOT / "web"))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_port}"
    failures = []

    with sync_playwright() as p:
        browser = p.chromium.launch()
        for size, (w, h) in SIZES.items():
            ctx = browser.new_context(viewport={"width": w, "height": h})
            for name in PAGES:
                page = ctx.new_page()
                errors = []
                # /api/config only exists on Vercel; its 404 locally is expected (that's the fallback path)
                page.on("console", lambda m: m.type == "error" and "/api/config" not in (m.location.get("url") or "")
                        and "404" not in m.text and errors.append(m.text))
                page.on("pageerror", lambda e: errors.append(str(e)))
                page.on("response", lambda r: r.status >= 400 and "/api/config" not in r.url
                        and errors.append(f"HTTP {r.status} {r.url}"))
                page.goto(f"{base}/{name}.html", wait_until="networkidle")
                page.wait_for_function("document.body.dataset.source")
                try:
                    interact(page, name)
                except Exception as e:  # noqa: BLE001
                    errors.append(f"interaction failed: {e}")
                page.wait_for_timeout(400)
                badge = page.evaluate("document.body.dataset.source")
                overflow = page.evaluate("document.documentElement.scrollWidth - window.innerWidth")
                if overflow > 1:
                    errors.append(f"horizontal scroll of {overflow}px")
                page.screenshot(path=str(SHOTS / f"{name}-{size}.png"), full_page=True)
                status = "OK " if not errors else "FAIL"
                print(f"{status} {size:7s} {name:16s} [{badge}]" + "".join(f"\n      {e}" for e in errors))
                if errors:
                    failures.append((size, name))
                page.close()
            ctx.close()
        browser.close()
    server.shutdown()
    if failures:
        sys.exit(f"{len(failures)} page(s) failed")
    print(f"All pages OK. Screenshots in {SHOTS}")


if __name__ == "__main__":
    main()
