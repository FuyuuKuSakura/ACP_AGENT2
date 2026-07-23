import asyncio
from pathlib import Path
from playwright.async_api import async_playwright

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page(viewport={"width": 1280, "height": 800})
        page.on("pageerror", lambda e: print(f"pageerror: {e}"))
        await page.goto("http://127.0.0.1:5173/", wait_until="networkidle")
        await page.wait_for_timeout(2000)

        # Send a user message via the real input.
        await page.fill('[placeholder="输入消息…"]', "帮我写一个 hello.py")
        await page.click('[aria-label="发送"]')
        await page.wait_for_timeout(500)

        # Simulate incoming agent stream with tool-call metadata.
        await page.evaluate("""
            const store = window.__Dionysus_CHAT_STORE__;
            store.getState().setStreaming(true);
            store.getState().setStreamingStatus({ status: 'thinking', detail: '正在思考' });
            store.getState().addAgentChunk('好的，我来帮你创建文件。\\n');
            store.getState().addAgentChunk('🔧 调用工具: Write(path="hello.py", content="print(\\"Hello\\")")\\n');
            store.getState().addAgentChunk('文件已写入。\\n');
            store.getState().updateActiveToolResult('写入成功', 'success');
            store.getState().finalizeAgentMessage('complete');
            store.getState().finalizeToolCalls('success');
            store.getState().setStreaming(false);
        """)
        await page.wait_for_timeout(800)
        await page.screenshot(path=str(PROJECT_ROOT / "frontend_screenshot_hud.png"), full_page=False)
        await browser.close()
        print("ok")

asyncio.run(main())
