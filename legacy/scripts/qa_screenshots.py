import asyncio
import json
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'frontend_screenshot_qa.png'

TODOS = [
    {"id": "1", "text": "分析项目结构", "done": True},
    {"id": "2", "text": "读取相关文件", "done": True},
    {"id": "3", "text": "设计实现方案", "done": True},
    {"id": "4", "text": "修改前端 Live2D 组件", "done": False},
    {"id": "5", "text": "修改后端 CompanionEngine", "done": False},
    {"id": "6", "text": "扩展角色对话框", "done": False},
    {"id": "7", "text": "运行构建与类型检查", "done": False},
    {"id": "8", "text": "启动前后端服务", "done": False},
    {"id": "9", "text": "Playwright 截图", "done": False},
    {"id": "10", "text": "视觉模型审阅", "done": False},
    {"id": "11", "text": "修复审阅发现的问题", "done": False},
]

def js_obj(obj):
    return json.dumps(obj, ensure_ascii=False)

async def capture():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page(viewport={'width': 1440, 'height': 900})
        await page.goto('http://127.0.0.1:5173/')
        await page.wait_for_timeout(2000)
        await page.evaluate(f'''async () => {{
            const store = window.__Dionysus_CHAT_STORE__?.getState?.();
            if (store) {{
                store.setTodos({js_obj(TODOS)});
                store.setStreaming(true);
                store.setStreamingStatus({js_obj({"status": "executing", "detail": "运行中", "progress": 45})});
                store.setSessionStatus('streaming');
                store.setCompanionLine('搞定啦！老板看看怎么样？');
            }}
            try {{
                const mod = await import('/src/stores/live2dStore.ts');
                const live = mod.useLive2DStore.getState();
                live.setCurrentEmotion('happy');
                live.requestExpression('爱心眼');
                live.setPresenceState('working');
            }} catch (e) {{}}
        }}''')
        await page.wait_for_timeout(2000)
        await page.screenshot(path=str(OUT), full_page=False)
        print('desktop screenshot saved', OUT)
        await browser.close()

asyncio.run(capture())
