import asyncio
import os
from pathlib import Path
from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:5173"
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
OUT_DIR = PROJECT_ROOT
WORKSPACE = PROJECT_ROOT / "test_workspace"

IPHONE_13_PRO_MAX = {
    "width": 428,
    "height": 926,
    "device_scale_factor": 3,
}
USER_AGENT = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 "
    "Mobile/15E148 Safari/604.1"
)


def workspace_files():
    return [p.name for p in WORKSPACE.iterdir() if p.is_file()]


async def wait_for_streaming_stop(page, timeout: float = 60.0):
    """Wait until chatStore.isStreaming becomes false."""
    start = asyncio.get_event_loop().time()
    while True:
        streaming = await page.evaluate(
            "() => { const s = window.__Dionysus_CHAT_STORE__; return s ? s.getState().isStreaming : false; }"
        )
        if not streaming:
            return True
        if asyncio.get_event_loop().time() - start > timeout:
            return False
        await asyncio.sleep(0.5)


async def screenshot(page, name: str):
    path = OUT_DIR / f"mobile_{name}.png"
    await page.screenshot(path=str(path), full_page=False)
    print(f"screenshot saved: {path}")


async def send_message(page, text: str):
    await page.fill('[placeholder="输入消息…"]', text)
    await page.click('[aria-label="发送"]')


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            viewport=IPHONE_13_PRO_MAX,
            user_agent=USER_AGENT,
        )
        page = await context.new_page()
        page.on("pageerror", lambda e: print(f"pageerror: {e}"))
        page.on("console", lambda msg: print(f"console {msg.type}: {msg.text}") if msg.type in ("error", "warn") else None)

        await page.goto(BASE, wait_until="networkidle")
        await page.evaluate("localStorage.clear(); location.reload();")
        await asyncio.sleep(3)
        await screenshot(page, "01_initial")

        # Open mobile companion drawer
        try:
            await page.click('[aria-label="角色陪伴"]')
            await asyncio.sleep(1)
            await screenshot(page, "02_companion_drawer")
            await page.click('[aria-label="关闭角色陪伴"]')
            await asyncio.sleep(0.5)
        except Exception as e:
            print("companion drawer skipped", e)

        # Question 1
        print("sending question 1")
        await send_message(page, "你好，你的工作目录是什么")
        ok = await wait_for_streaming_stop(page, timeout=45)
        print("question 1 streaming stopped:", ok)
        await asyncio.sleep(1)
        await screenshot(page, "03_q1_response")

        # Question 2
        print("sending question 2")
        await send_message(page, "进入 planmode，基于 python tkinter，构建一个简单的 gui 计算器程序")
        # Wait a bit for streaming to start
        await asyncio.sleep(5)
        await screenshot(page, "04_q2_streaming")

        # Open companion drawer during streaming to inspect tool panel
        try:
            await page.click('[aria-label="角色陪伴"]')
            await asyncio.sleep(2)
            await screenshot(page, "05_q2_companion_tools")
        except Exception as e:
            print("companion tools screenshot skipped", e)

        ok = await wait_for_streaming_stop(page, timeout=120)
        print("question 2 streaming stopped:", ok)
        await asyncio.sleep(2)
        await screenshot(page, "06_q2_complete")

        print("workspace files:", workspace_files())

        await browser.close()
        print("done")


if __name__ == "__main__":
    asyncio.run(main())
