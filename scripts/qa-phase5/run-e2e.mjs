/**
 * Phase 5 集成 E2E 主控（QA 专用，非产品代码）：
 * 真 VS Code extension host（code --extensionDevelopmentPath）+ Playwright chromium。
 *
 * 流程：
 *  a. driver 捕获 pair token（见 driver-ext/driver.js 头部说明）；
 *  b. Playwright 打开 #/pair/<token> 自动配对 → 首屏会话列表；
 *  c. 移动 UI 新建会话 + 发「只回复两个字：你好」（真实 kimi 回合）→ 消息流 + agent_complete；
 *  d. 锁屏追赶模拟：setOffline(true) 断移动 WS → 影子 WS 再跑一回合 → 恢复网络
 *     → 移动端重连 sync 补拉 → 断言断线期间消息可见 + 归来摘要卡；
 *  e. 负例：/ws?token=wrong 拒连；/assets/ 无 token 401（有 token 200 对照）。
 *
 * 影子 WS（node 端、用同一 device token 的第二条连接）全程记录 S→C 消息到
 * out/shadow-ws.jsonl，作为协议级断言依据（agent_complete / sync 内容）。
 *
 * 用法：node scripts/qa-phase5/run-e2e.mjs
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'

const require = createRequire('/Users/fuyuuku/ACP_AGENT2/package.json')
const WebSocket = require('ws')

const QA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)))
const REPO = path.resolve(QA_DIR, '..', '..')
const OUT = path.join(QA_DIR, 'out')
const SIGNALS = path.join(QA_DIR, 'signals')
const USER_DATA = '/tmp/dionysus-phase5-userdata'
const EXT_DIR = '/tmp/dionysus-phase5-exts'
const WS_DIR = '/tmp/dionysus-phase5-ws'
const BASE_PORT = 8876
const KIMI_TURN_TIMEOUT_MS = 240_000

const report = { steps: [], bugs: [], startedAt: new Date().toISOString() }
function record(step, ok, detail) {
  report.steps.push({ step, ok, detail, at: new Date().toISOString() })
  console.log(`${ok ? 'PASS' : 'FAIL'} [${step}] ${detail}`)
  flushReport()
}
function flushReport() {
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2), 'utf8')
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitFor(fn, { timeout = 30_000, interval = 500, label = 'condition' } = {}) {
  const deadline = Date.now() + timeout
  let lastErr
  while (Date.now() < deadline) {
    try {
      const v = await fn()
      if (v) return v
    } catch (err) {
      lastErr = err
    }
    await sleep(interval)
  }
  throw new Error(`等待超时（${label}）${lastErr ? `：${lastErr.message}` : ''}`)
}

async function httpJson(port, urlPath, options) {
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, options)
  const text = await res.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    body = text
  }
  return { status: res.status, body }
}

// ── 影子 WS：协议级记录 ──────────────────────────────────────────────────────
const shadowLog = path.join(OUT, 'shadow-ws.jsonl')
const shadow = {
  ws: null,
  messages: [],
  waiters: [],
  connect(port, deviceToken) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(deviceToken)}`)
      const timer = setTimeout(() => reject(new Error('影子 WS 连接超时')), 10_000)
      ws.on('open', () => {
        clearTimeout(timer)
        ws.send(JSON.stringify({ v: 1, type: 'hello', ts: Date.now(), payload: { minVersion: 1, maxVersion: 1 } }))
        this.ws = ws
        resolve()
      })
      ws.on('message', (data) => {
        let msg
        try {
          msg = JSON.parse(data.toString('utf8'))
        } catch {
          return
        }
        this.messages.push(msg)
        fs.appendFileSync(shadowLog, `${JSON.stringify(msg)}\n`)
        this.waiters = this.waiters.filter((w) => !w(msg))
      })
      ws.on('error', (err) => {
        clearTimeout(timer)
        reject(err)
      })
    })
  },
  send(msg) {
    this.ws.send(JSON.stringify({ ts: Date.now(), ...msg }))
  },
  /** 等一条满足 pred 的消息（含已收到的历史）。 */
  waitMessage(pred, timeout, label) {
    for (const m of this.messages) {
      if (pred(m)) return Promise.resolve(m)
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`影子 WS 等消息超时（${label}）`)), timeout)
      this.waiters.push((m) => {
        if (!pred(m)) return false
        clearTimeout(timer)
        resolve(m)
        return true
      })
    })
  },
}

async function main() {
  // ── 0. 环境准备 ──────────────────────────────────────────────────────────
  fs.rmSync(OUT, { recursive: true, force: true })
  fs.mkdirSync(OUT, { recursive: true })
  fs.mkdirSync(SIGNALS, { recursive: true })
  for (const f of fs.readdirSync(SIGNALS)) fs.unlinkSync(path.join(SIGNALS, f))
  fs.rmSync(USER_DATA, { recursive: true, force: true })
  fs.rmSync(EXT_DIR, { recursive: true, force: true })
  fs.rmSync(WS_DIR, { recursive: true, force: true })
  fs.mkdirSync(path.join(USER_DATA, 'User'), { recursive: true })
  fs.mkdirSync(EXT_DIR, { recursive: true })
  fs.mkdirSync(WS_DIR, { recursive: true })
  fs.writeFileSync(
    path.join(USER_DATA, 'User', 'settings.json'),
    JSON.stringify(
      {
        'dionysus.lan.enabled': true,
        'dionysus.lan.port': BASE_PORT,
        'dionysus.supervisor.mode': 'template',
        // 本机 kimi print 模式在默认模型（moonshot-cn/kimi-k2.6）下挂起（环境问题，
        // 详见 REPORT.md）；经包装器显式指定 kimi-code/kimi-for-coding 模型跑 QA 回合
        'dionysus.adapters': {
          kimi_qa: {
            type: 'kimi_code_cli',
            command: path.join(QA_DIR, 'kimi-with-model.sh'),
            model: null,
          },
        },
        'dionysus.adapter.default': 'kimi_qa',
      },
      null,
      2,
    ),
  )

  // ── 1. 启动真实 VS Code（锁屏下进程可运行；全部交互走命令与网络）─────────
  const codeProc = spawn(
    'code',
    [
      '--new-window',
      '--user-data-dir',
      USER_DATA,
      '--extensions-dir',
      EXT_DIR,
      '--disable-workspace-trust',
      '--extensionDevelopmentPath',
      path.join(REPO, 'packages', 'extension'),
      '--extensionDevelopmentPath',
      path.join(QA_DIR, 'driver-ext'),
      WS_DIR,
    ],
    { env: { ...process.env, DIONYSUS_QA_DIR: QA_DIR }, stdio: 'ignore', detached: true },
  )
  codeProc.unref()
  console.log('VS Code 已启动（独立 user-data-dir / extensions-dir）')

  await waitFor(() => fs.existsSync(path.join(OUT, 'driver.log')), { timeout: 60_000, label: 'driver 激活' })
  const port = await waitFor(
    async () => {
      for (let p = BASE_PORT; p <= BASE_PORT + 10; p += 1) {
        try {
          const r = await httpJson(p, '/api/health')
          if (r.status === 200 && r.body?.ok === true) return p
        } catch {
          /* 端口未开 */
        }
      }
      return null
    },
    { timeout: 90_000, label: 'lan-server /api/health' },
  )
  record('启动', true, `lan-server running，实际端口 ${port}`)

  // ── a. 取 pair token ─────────────────────────────────────────────────────
  fs.writeFileSync(path.join(SIGNALS, '001.cmd'), 'capture-pair-token')
  const pairTokenFile = path.join(OUT, 'pair-token.json')
  await waitFor(() => fs.existsSync(pairTokenFile), { timeout: 30_000, label: 'pair token 捕获' })
  const captured = JSON.parse(fs.readFileSync(pairTokenFile, 'utf8'))
  const issueHits = captured.candidates.filter((c) => c.fromIssueToken)
  let pairToken = issueHits[0]?.token ?? null
  let pairApiCrossChecked = false
  if (!pairToken) {
    // 调用栈过滤失效的兜底：逐个 POST /api/pair 验证（成功即作废，仅作交叉验证），
    // 然后让 driver 重新签发一枚直接采用。
    for (const c of captured.candidates) {
      const r = await httpJson(port, '/api/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pair_token: c.token }),
      })
      if (r.status === 200 && r.body?.device_token) {
        pairApiCrossChecked = true
        break
      }
    }
    fs.writeFileSync(path.join(SIGNALS, '002.cmd'), 'capture-pair-token')
    await waitFor(
      () => fs.existsSync(pairTokenFile) && JSON.parse(fs.readFileSync(pairTokenFile, 'utf8')).capturedAt !== captured.capturedAt,
      { timeout: 30_000, label: 'pair token 二次捕获' },
    )
    const second = JSON.parse(fs.readFileSync(pairTokenFile, 'utf8'))
    pairToken = (second.candidates.find((c) => c.fromIssueToken) ?? second.candidates[0])?.token
  }
  if (!pairToken) throw new Error('未能捕获 pair token')
  record(
    'a-取pairToken',
    true,
    `捕获候选 ${captured.candidates.length} 个（issueToken 栈命中 ${issueHits.length}），采用 token=${pairToken.slice(0, 6)}…${pairApiCrossChecked ? '（POST /api/pair 交叉验证 200）' : ''}`,
  )
  // 负例顺手验证：错误 pair token 应 401
  const badPair = await httpJson(port, '/api/pair', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pair_token: 'wrong-token-00000000' }),
  })
  record('a-错误pairToken401', badPair.status === 401, `POST /api/pair wrong → ${badPair.status} ${JSON.stringify(badPair.body)}`)

  // ── b. Playwright 配对 → 首屏 ────────────────────────────────────────────
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await context.newPage()
  page.on('console', (m) => {
    if (m.type() === 'error') fs.appendFileSync(path.join(OUT, 'page-console.log'), `[error] ${m.text()}\n`)
  })
  page.on('pageerror', (e) => fs.appendFileSync(path.join(OUT, 'page-console.log'), `[pageerror] ${e.message}\n`))

  // 锁屏模拟的 WS 代理（前置实验 ws-offline-test.mjs 已证实：Chromium
  // setOffline 不会断开已建立的 WebSocket，故改用 routeWebSocket 代理）。
  // locked=true 时：拒绝一切新 WS（立即 close，模拟手机锁屏后网络不可达），
  // 并主动掐断在网连接；locked=false 时：双向透传。
  let locked = false
  const liveSockets = new Set()
  await page.routeWebSocket(/.*/, async (ws) => {
    if (locked) {
      ws.close()
      return
    }
    const server = await ws.connectToServer()
    const pair = { ws, server }
    liveSockets.add(pair)
    ws.onMessage((m) => server.send(m))
    server.onMessage((m) => ws.send(m))
    ws.onClose(() => {
      liveSockets.delete(pair)
      server.close()
    })
    server.onClose(() => {
      liveSockets.delete(pair)
      ws.close()
    })
  })

  await page.goto(`http://127.0.0.1:${port}/#/pair/${pairToken}`, { waitUntil: 'domcontentloaded' })
  await page.screenshot({ path: path.join(OUT, 'b1-pair-screen.png') })
  await page.waitForSelector('[data-testid="session-list-screen"]', { timeout: 30_000 })
  const deviceToken = await page.evaluate(() => window.localStorage.getItem('dionysus.mobile.deviceToken'))
  const hashAfterPair = await page.evaluate(() => window.location.hash)
  await page.screenshot({ path: path.join(OUT, 'b2-first-screen.png') })
  record(
    'b-配对首屏',
    Boolean(deviceToken) && !hashAfterPair.includes(pairToken),
    `自动配对成功（device token 已存 localStorage，hash 已抹除 pair token：${hashAfterPair || '(空)'}），首屏会话列表渲染`,
  )

  // 影子 WS 上线（同 device token 的第二连接，协议级记录）
  await shadow.connect(port, deviceToken)
  await shadow.waitMessage((m) => m.type === 'handshake', 10_000, 'handshake')
  record('b-影子WS握手', true, '影子 WS 以 device token 连接并收到 handshake（WS 鉴权正例）')

  // ── c. 移动 UI 新建会话 + 真实 kimi 回合 ─────────────────────────────────
  await page.click('[data-testid="new-session-button"]')
  await page.waitForSelector('[data-testid="chat-screen"]', { timeout: 20_000 })
  const sessionId = decodeURIComponent((await page.evaluate(() => window.location.hash)).replace(/^#\/chat\//, ''))
  record('c-新建会话', sessionId.length > 0, `移动 UI 新建会话并自动切入 chat：sessionId=${sessionId}`)

  await page.fill('[data-testid="command-input"]', '只回复两个字：你好')
  const turn1Start = shadow.messages.length
  await page.click('[data-testid="command-send"]')
  const complete1 = await shadow.waitMessage(
    (m) => m.type === 'agent_complete' && m.sessionId === sessionId,
    KIMI_TURN_TIMEOUT_MS,
    'agent_complete(回合1)',
  )
  await page.waitForFunction(
    () => (document.querySelector('[data-testid="chat-scroll"]')?.textContent ?? '').includes('你好'),
    null,
    { timeout: 30_000 },
  )
  await page.screenshot({ path: path.join(OUT, 'c1-chat-turn1.png') })
  const turn1Types = shadow.messages.slice(turn1Start).map((m) => m.type)
  record(
    'c-真实kimi回合',
    complete1.payload.status === 'success',
    `agent_complete status=${complete1.payload.status}（${Math.round((complete1.payload.durationMs ?? 0) / 1000)}s）；移动端消息流渲染出「你好」；回合内消息类型：${[...new Set(turn1Types)].join(',')}`,
  )

  // ── d. 锁屏追赶模拟 ──────────────────────────────────────────────────────
  locked = true // 新 WS 一律拒建（锁屏后网络不可达）
  for (const pair of [...liveSockets]) pair.ws.close() // 掐断在网连接 → 移动端 onclose → 退避重连（被 locked 拦截）
  await page.waitForSelector('[data-testid="reconnect-banner"]', { timeout: 20_000 })
  await page.screenshot({ path: path.join(OUT, 'd1-offline-banner.png') })
  record('d-断线', true, 'WS 代理进入 locked 态：移动端 WS 断开且重连被拦截，重连横幅出现（锁屏模拟）')

  // 断线期间：影子 WS 代桌面端再跑一回合
  shadow.send({ v: 1, type: 'user_input', sessionId, payload: { text: '只回复两个字：收到', attachments: [], mode: 'normal' } })
  const complete2 = await shadow.waitMessage(
    (m) => m.type === 'agent_complete' && m.sessionId === sessionId && m !== complete1,
    KIMI_TURN_TIMEOUT_MS,
    'agent_complete(回合2/断线期间)',
  )
  record('d-断线期回合', complete2.payload.status === 'success', `断线期间第二回合完成 status=${complete2.payload.status}`)

  // 归来（解锁）：放开 WS 代理 → 移动端退避重连成功 → handshake → sync 补拉
  locked = false
  // 退避可能已走远（甚至 10 次耗尽停摆）：补一发 visibilitychange 触发立即重连
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await page.waitForSelector('[data-testid="reconnect-banner"]', { state: 'hidden', timeout: 60_000 })
  let syncOk = true
  let syncDetail = ''
  try {
    await page.waitForFunction(
      () => (document.querySelector('[data-testid="chat-scroll"]')?.textContent ?? '').includes('收到'),
      null,
      { timeout: 60_000 },
    )
    syncDetail = '重连后 sync 补拉：断线期间回合的回复「收到」已在移动端消息流渲染'
  } catch (err) {
    syncOk = false
    syncDetail = `重连后 60s 内未在消息流看到「收到」：${err.message}`
  }
  await page.screenshot({ path: path.join(OUT, 'd2-reconnected-chat.png') })
  record('d-sync补拉', syncOk, syncDetail)

  // 回首屏查归来摘要卡
  await page.evaluate(() => {
    window.location.hash = '#/list'
  })
  await sleep(1500)
  await page.screenshot({ path: path.join(OUT, 'd3-list-after-return.png') })
  const card = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="return-summary-card"]')
    return el ? el.textContent : null
  })
  if (card && card.includes('你离开期间')) {
    record('d-归来摘要卡', true, `摘要卡出现：${card.slice(0, 80)}`)
  } else {
    report.bugs.push({
      id: 'BUG-P5-1',
      title: '归来摘要未接线：BroadcastHub.maybeSendReturnSummary 在生产链路无调用方',
      location: 'packages/extension/src/core-host.ts sync_request 分支（仅 handleSyncRequest）；全仓仅 broadcast.ts 定义与 broadcast.test.ts 调用',
      evidence: '重连回首屏后 [data-testid=return-summary-card] 不存在；影子 WS 全程未收到「你离开期间」前缀的 companion_message',
    })
    record('d-归来摘要卡', false, `摘要卡未出现（card=${card ? JSON.stringify(card.slice(0, 60)) : 'null'}）→ 记 BUG-P5-1`)
  }

  // ── e. 负例 ──────────────────────────────────────────────────────────────
  // e1: 未配对设备直连 /ws?token=wrong → upgrade 前拒绝（无 WS 连接）
  const wrongWsResult = await new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=wrong-token-00000000`)
    ws.on('open', () => resolve('OPENED(不应发生)'))
    ws.on('unexpected-response', (req, res) => resolve(`unexpected-response HTTP ${res.statusCode}`))
    ws.on('error', (err) => resolve(`error: ${err.message}`))
    setTimeout(() => resolve('timeout(无响应)'), 8_000)
  })
  record('e-错误token拒连', wrongWsResult.includes('401'), `/ws?token=wrong → ${wrongWsResult}`)

  // e2: /assets/ 无 token → 401；错误 token → 401；正确 token → 200（对照）
  const assetPath = "/assets/personas/builtin/kal'tsit.yaml"
  const noToken = await httpJson(port, assetPath)
  const wrongToken = await httpJson(port, `${assetPath}?token=wrong-token-00000000`)
  const goodToken = await httpJson(port, `${assetPath}?token=${encodeURIComponent(deviceToken)}`)
  record(
    'e-assets鉴权',
    noToken.status === 401 && wrongToken.status === 401 && goodToken.status === 200,
    `无 token → ${noToken.status}；错误 token → ${wrongToken.status}；正确 device token → ${goodToken.status}（对照）`,
  )

  // ── 收尾 ─────────────────────────────────────────────────────────────────
  report.finishedAt = new Date().toISOString()
  flushReport()
  await browser.close()
  console.log(`\nE2E 完成。报告：${path.join(OUT, 'report.json')}`)
  const failed = report.steps.filter((s) => !s.ok)
  process.exit(failed.length > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('E2E 主流程异常：', err)
  report.fatal = err.message
  flushReport()
  process.exit(2)
})
