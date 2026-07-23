/**
 * Playwright 截图脚本 —— 移动端视觉验收（A-2 步骤 1「取景」）。
 *
 * 前置：mock-server.mjs 已在 PORT（默认 8791）运行。
 * 输出：scripts/qa-mobile-visual/out/*.png（iPhone 尺寸 390×844）。
 *
 * 截图清单：
 *   a-list-light.png       会话列表首屏（浅色，摘要卡已关闭）
 *   b-chat-option-chips.png 对话页（chip 计数条 + option 确认条）
 *   c-character-drawer.png  角色唤起抽屉（顶部露出对话流）
 *   d-status-fullscreen.png 工作状态全屏页（sess-auth：todo 3/7 + 时间线 + 汇报流）
 *   e-list-dark.png        深色模式首屏
 *   f-pair.png             配对页
 *   g-return-summary.png   归来摘要卡（首屏顶部）
 */
import { createRequire } from 'node:module'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)

function loadPlaywright() {
  const candidates = [
    'playwright',
    process.env.PLAYWRIGHT_PATH,
    '/Users/fuyuuku/.npm/_npx/e41f203b7505f1fb/node_modules/playwright',
  ].filter(Boolean)
  for (const c of candidates) {
    try {
      return require(c)
    } catch {
      /* 下一个候选 */
    }
  }
  throw new Error('playwright 不可用（尝试 npm i playwright 或设 PLAYWRIGHT_PATH）')
}

const { chromium, devices } = loadPlaywright()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(__dirname, 'out')
const PORT = Number(process.env.PORT ?? 8791)
const BASE = `http://localhost:${PORT}`
const PAIR_TOKEN = 'QA-PAIR-2026'

mkdirSync(OUT, { recursive: true })

async function shot(page, name) {
  const file = path.join(OUT, name)
  await page.screenshot({ path: file, animations: 'disabled' })
  console.log(`[shot] ${name}`)
}

async function dismissSummaryIfVisible(page) {
  const btn = page.locator('[data-testid="return-summary-dismiss"]')
  if (await btn.isVisible().catch(() => false)) await btn.click()
}

const browser = await chromium.launch()
const context = await browser.newContext({ ...devices['iPhone 13'] })
const page = await context.newPage()
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[console.error]', m.text())
})
page.on('pageerror', (e) => console.log('[pageerror]', e.message))

// f) 配对页（无 token 首访）
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
await page.waitForSelector('[data-testid="pair-screen"]')
await shot(page, 'f-pair.png')

// 扫码直达配对 → 首屏列表；mock 推送「你离开期间…」→ 归来摘要卡
await page.goto(`${BASE}/#/pair/${PAIR_TOKEN}`, { waitUntil: 'networkidle' })
await page.waitForSelector('[data-testid="session-list-screen"]')
await page.waitForSelector('[data-testid="return-summary-card"]', { timeout: 10_000 })
// 等列表三项 digest 到齐
await page.waitForSelector('[data-testid="session-item-sess-docs"]')
await page.waitForTimeout(400)

// g) 归来摘要卡
await shot(page, 'g-return-summary.png')

// a) 会话列表首屏（浅色）：关掉摘要卡后的纯净列表
await dismissSummaryIfVisible(page)
await page.waitForTimeout(200)
await shot(page, 'a-list-light.png')

// b) 对话页（sess-mobile：option 确认条 + chip 计数条）
await page.click('[data-testid="session-item-sess-mobile"]')
await page.waitForSelector('[data-testid="chat-screen"]')
await page.waitForSelector('[data-testid="option-confirm-bar"]')
await page.waitForSelector('[data-testid="tool-call-chips"]')
await page.waitForTimeout(400)
await shot(page, 'b-chat-option-chips.png')

// c) 角色唤起抽屉（顶部露出对话流）
await page.click('[data-testid="summon-character-button"]')
await page.waitForSelector('[data-testid="character-drawer"][data-open="true"]')
await page.waitForTimeout(500) // 抽屉扫入动画 + 立绘加载
await shot(page, 'c-character-drawer.png')
await page.click('[data-testid="drawer-close"]')

// d) 工作状态全屏页（sess-auth：todo 进度 3/7 + 操作时间线 + 汇报流）
await page.goto(`${BASE}/#/status/sess-auth`)
await page.waitForSelector('[data-testid="status-screen"]')
await page.waitForSelector('[data-testid="todo-progress-bar"]')
await page.waitForTimeout(400)
await shot(page, 'd-status-fullscreen.png')

// e) 深色模式首屏（三态主题：localStorage 持久化后整页重载，新 WS 连接会重推场景）
await page.evaluate(() => window.localStorage.setItem('dionysus.mobile.theme', 'dark'))
await page.goto(`${BASE}/#/list`)
await page.reload({ waitUntil: 'networkidle' })
await page.waitForSelector('[data-testid="session-list-screen"]')
await page.waitForSelector('[data-testid="session-item-sess-docs"]')
await page.waitForSelector('[data-testid="return-summary-card"]', { timeout: 10_000 })
await dismissSummaryIfVisible(page)
await page.waitForTimeout(400)
await shot(page, 'e-list-dark.png')

await browser.close()
console.log('[done] 7 张截图已写入', OUT)
