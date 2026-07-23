import asyncio
from pathlib import Path
from playwright.async_api import async_playwright

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page(viewport={"width": 1280, "height": 800})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        async def log(resp):
            if resp.status >= 400:
                body = await resp.text()
                print(f"response {resp.status}: {resp.url}\n{body[:500]}")
        page.on("response", lambda resp: asyncio.create_task(log(resp)))
        await page.goto("http://127.0.0.1:5173/", wait_until="networkidle")
        await page.wait_for_timeout(3000)
        await page.screenshot(path=str(PROJECT_ROOT / "frontend_screenshot_playwright.png"), full_page=False)
        print("errors:", errors)
        await browser.close()
        print("ok")

asyncio.run(main())
