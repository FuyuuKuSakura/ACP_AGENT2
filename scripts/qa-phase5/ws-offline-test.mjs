import { createRequire } from 'node:module'
import { chromium } from 'playwright'
const require = createRequire('/Users/fuyuuku/ACP_AGENT2/package.json')
const { WebSocketServer } = require('ws')
const wss = new WebSocketServer({ port: 19301 })
wss.on('connection', (ws) => { ws.on('message', (d) => console.log('server got:', String(d))); ws.send('hi') })
const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext()
const page = await ctx.newPage()
await page.goto('http://127.0.0.1:19301', { waitUntil: 'domcontentloaded' }).catch(() => {})
// 需要一个 http 页面才能跑 JS；19301 只有 ws。用 data: URL
await page.goto('data:text/html,<html></html>')
await page.evaluate(() => {
  window._ws = new WebSocket('ws://127.0.0.1:19301')
  window._closed = false
  window._ws.onclose = () => { window._closed = true }
  window._ws.onopen = () => { window._open = true }
})
await page.waitForFunction(() => window._open === true, null, { timeout: 5000 })
console.log('ws open OK')
await ctx.setOffline(true)
let closed = false
for (let i = 0; i < 20; i++) {
  closed = await page.evaluate(() => window._closed)
  if (closed) break
  await new Promise((r) => setTimeout(r, 500))
}
console.log('after setOffline(true): ws closed =', closed)
await browser.close()
process.exit(0)
