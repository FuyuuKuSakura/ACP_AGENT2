import asyncio
from pathlib import Path
from playwright.async_api import async_playwright

OUT = Path(__file__).resolve().parent.parent / 'frontend_screenshot_live2d_test.png'

async def capture():
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-features=VaapiVideoDecoder'],
        )
        page = await browser.new_page(viewport={'width': 1440, 'height': 900})
        logs = []
        page.on('console', lambda msg: logs.append(f'{msg.type}: {msg.text}'))
        page.on('pageerror', lambda err: logs.append(f'pageerror: {err}'))
        await page.goto('http://127.0.0.1:5173/')
        await page.wait_for_timeout(4000)
        await page.screenshot(path=str(OUT), full_page=False)
        print('screenshot saved', OUT)
        print('--- logs ---')
        for l in logs[-50:]:
            print(l)
        await browser.close()

asyncio.run(capture())
