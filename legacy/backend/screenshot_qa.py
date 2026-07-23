"""Quick visual QA screenshots for desktop and iPhone 13 Pro Max."""

import asyncio
from pathlib import Path

from playwright.async_api import async_playwright

URL = "http://localhost:5173/"
OUT = Path(__file__).parent.parent / "frontend" / "tests" / "screenshots"
OUT.mkdir(parents=True, exist_ok=True)


async def main() -> None:
    async with async_playwright() as p:
        browser = await p.chromium.launch()

        # Desktop
        page = await browser.new_page(viewport={"width": 1440, "height": 900})
        await page.goto(URL)
        await page.wait_for_timeout(3000)
        await page.screenshot(path=str(OUT / "desktop_overview.png"), full_page=False)

        # Open settings
        await page.click('button[aria-label="设置"]')
        await page.wait_for_timeout(500)
        await page.screenshot(path=str(OUT / "desktop_settings.png"), full_page=False)

        # Open theme studio from appearance tab
        await page.click('button:has-text("打开调色盘")')
        await page.wait_for_timeout(500)
        await page.screenshot(path=str(OUT / "desktop_theme_studio.png"), full_page=False)
        await page.click('button[aria-label="关闭"]')

        # Send a greeting and capture agent response state
        await page.fill('textarea[placeholder="输入消息… 支持 / 快捷指令"]', '你好，你的工作目录是什么？')
        await page.click('button[aria-label="发送"]')
        await page.wait_for_timeout(12000)
        await page.screenshot(path=str(OUT / "desktop_greeting_response.png"), full_page=False)

        # Mobile iPhone 13 Pro Max
        mobile = await browser.new_page(
            viewport={"width": 428, "height": 926},
            user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        )
        await mobile.goto(URL)
        await mobile.wait_for_timeout(3000)
        await mobile.screenshot(path=str(OUT / "mobile_overview.png"), full_page=False)

        # Open companion drawer
        await mobile.click('button[aria-label="角色陪伴"]')
        await mobile.wait_for_timeout(500)
        await mobile.screenshot(path=str(OUT / "mobile_companion.png"), full_page=False)

        await browser.close()
        print(f"Screenshots saved to {OUT}")


if __name__ == "__main__":
    asyncio.run(main())
